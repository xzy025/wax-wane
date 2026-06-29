import { describe, it, expect } from 'vitest'
import { trendTemplate, classify, finalScore, marketRegime, targetRMultFor, type Bar, type Candidate } from './screenerRules'
import { SCREENER, type ScreenerConfig } from '../config/screener'

/**
 * Build a 300-bar uptrend → rejection-ceiling at 40 (pivot) → tightening,
 * low-volume coil, then a configurable `today` bar. Lets us assert each
 * breakout/trigger/extended branch against a known pivot (=40).
 */
function makeBars(today: Bar): Bar[] {
  const bars: Bar[] = []
  // rise 0..238: close 10 → 37
  for (let i = 0; i < 239; i++) {
    const close = 10 + (37 - 10) * (i / 238)
    bars.push({ date: `r${i}`, open: close, close, high: close * 1.005, low: close * 0.995, volume: 1000 })
  }
  // early base 239..258: upper-wick rejections to 40 → sets prior pivot = 40
  for (let i = 239; i < 259; i++) {
    bars.push({ date: `e${i}`, open: 37.8, close: 37.8, high: 40.0, low: 37.5, volume: 1200 })
  }
  // coil 259..288: close 37.8 → 38.6, wider range (feeds ATR50)
  for (let i = 259; i < 289; i++) {
    const close = 37.8 + (38.6 - 37.8) * ((i - 259) / 29)
    bars.push({ date: `c${i}`, open: close, close, high: close + 0.6, low: close - 0.6, volume: 1000 })
  }
  // tight 289..298: close 38.6 → 38.8, tiny range; last 4 low volume (dry-up)
  for (let i = 289; i < 299; i++) {
    const close = 38.6 + (38.8 - 38.6) * ((i - 289) / 9)
    bars.push({ date: `t${i}`, open: close, close, high: close + 0.04, low: close - 0.04, volume: i >= 295 ? 300 : 1000 })
  }
  bars.push(today) // idx 299 = today
  return bars
}

// 收盘需在当日振幅高位(close-strength ≥ CLOSE_STRENGTH=0.75):(40.5-40.0)/(40.6-40.0)=0.83。
const breakoutToday: Bar = { date: 'today', open: 40.0, close: 40.5, high: 40.6, low: 40.0, volume: 3000 }
const extendedToday: Bar = { date: 'today', open: 42.0, close: 43.2, high: 43.5, low: 42.8, volume: 3000 }
const triggerToday: Bar = { date: 'today', open: 39.6, close: 39.6, high: 39.7, low: 39.5, volume: 300 }

describe('trendTemplate', () => {
  it('passes a clean Stage-2 uptrend', () => {
    const tt = trendTemplate(makeBars(breakoutToday))
    expect(tt).not.toBeNull()
    expect(tt!.pass).toBe(true)
  })

  it('returns null when there are too few bars', () => {
    expect(trendTemplate([{ date: 'a', open: 1, close: 1, high: 1, low: 1, volume: 1 }])).toBeNull()
  })

  it('fails a downtrend (price below the moving averages)', () => {
    const bars: Bar[] = []
    for (let i = 0; i < 300; i++) {
      const close = 40 - 30 * (i / 299)
      bars.push({ date: `d${i}`, open: close, close, high: close * 1.005, low: close * 0.995, volume: 1000 })
    }
    expect(trendTemplate(bars)!.pass).toBe(false)
  })
})

describe('classify', () => {
  it('flags a clean breakout above the prior pivot on volume', () => {
    const c = classify(makeBars(breakoutToday))
    expect(c?.group).toBe('breakout')
    expect(c!.pivot).toBeCloseTo(40, 1)
    expect(c!.signals.breakoutVol).toBe(true)
  })

  it('firstBreakout=true：昨日仍在前高之下,今日才是真·首次突破', () => {
    // makeBars 的昨日(idx 298)收 38.8 < 昨日pivot 40 → 今日首次站上。
    const c = classify(makeBars(breakoutToday))!
    expect(c.group).toBe('breakout')
    expect(c.firstBreakout).toBe(true)
  })

  it('firstBreakout=false：昨日已站上前高(连续新高)→ 不再判「首次突破」', () => {
    // 复现 太极实业/中晶科技:昨日已突破前高,今日续创新高仍在突破组,但非首次。
    // 旧逻辑(昨收≤含昨高的pivot)会恒判 true;修正后用昨日视角pivot=40 → 昨收41.2>40 → false。
    const bars = makeBars(breakoutToday)
    bars[298] = { date: 'y', open: 40.2, close: 41.2, high: 41.5, low: 40.0, volume: 1000 } // 昨日已突破
    bars[299] = { date: 'today', open: 41.2, close: 41.8, high: 42.0, low: 41.0, volume: 3000 } // 今日续新高
    const c = classify(bars)!
    expect(c.group).toBe('breakout') // 今收 41.8 > pivot(=昨高 41.5)
    expect(c.firstBreakout).toBe(false)
  })

  it('rejects an extended (chased) breakout > pivot×1.05 — the 追高 guard', () => {
    expect(classify(makeBars(extendedToday))).toBeNull()
  })

  it('flags an about-to-break (trigger) on contraction + volume dry-up', () => {
    const c = classify(makeBars(triggerToday))
    expect(c?.group).toBe('trigger')
    expect(c!.distToPivotPct).toBeGreaterThan(0)
    expect(c!.distToPivotPct).toBeLessThanOrEqual(5)
    expect(c!.signals.volDry).toBe(true)
    expect(c!.signals.atrContract).toBe(true)
  })

  it('sets a stop no more than STOP_MAX% below entry', () => {
    const c = classify(makeBars(breakoutToday))!
    expect(c.stopLoss).toBeGreaterThanOrEqual(c.price * (1 - SCREENER.STOP_MAX_PCT / 100) - 0.01)
    expect(c.stopLoss).toBeLessThan(c.price)
  })

  it('breakout: entry = close, pyramid add = entry + ADD_R_MULT×risk (higher than entry)', () => {
    const c = classify(makeBars(breakoutToday))!
    expect(c.group).toBe('breakout')
    expect(c.entry).toBeCloseTo(c.price, 2) // 介入=突破日收盘
    const risk = c.entry - c.stopLoss
    expect(c.add).toBeCloseTo(c.entry + SCREENER.ADD_R_MULT * risk, 2)
    expect(c.add).toBeGreaterThan(c.entry) // 金字塔:加仓高于介入
  })

  it('trigger: probe entry = close, add-core = pivot (breakout trigger, above probe)', () => {
    const c = classify(makeBars(triggerToday))!
    expect(c.group).toBe('trigger')
    expect(c.entry).toBeCloseTo(c.price, 2) // 试探=现价
    expect(c.add).toBeCloseTo(c.pivot, 2) // 加主仓=突破位
    expect(c.add).toBeGreaterThan(c.entry) // 突破位在现价之上
  })

  it('trigger uses a tighter starter stop (≤ STARTER_STOP% below close)', () => {
    const c = classify(makeBars(triggerToday))!
    expect(c.stopLoss).toBeGreaterThanOrEqual(c.price * (1 - SCREENER.STARTER_STOP_PCT / 100) - 0.01)
    expect(c.stopLoss).toBeLessThan(c.price)
  })
})

describe('classify · 相对大盘自适应收强 (Part B, RS_ADAPTIVE_CLOSE)', () => {
  // 弱收盘突破:close 40.2>pivot40 + 放量,但收强 (40.2−39.8)/(41.0−39.8)=0.33<0.75 → 默认落 watch。
  const weakBreakoutToday: Bar = { date: 'today', open: 40.0, close: 40.2, high: 41.0, low: 39.8, volume: 3000 }

  it('默认(flag off):弱收盘突破 → watch「放量突破·收盘弱」,不升突破', () => {
    const c = classify(makeBars(weakBreakoutToday))!
    expect(c.group).toBe('watch')
    expect(c.signals.pattern).toBe('放量突破·收盘弱')
  })

  it('大盘暴跌日 + flag on:逆势红盘+站上MA5 视同收强 → 升 breakout', () => {
    const cfg: ScreenerConfig = { ...SCREENER, RS_ADAPTIVE_CLOSE: true, MARKET_CHG_PCT: -3 }
    const c = classify(makeBars(weakBreakoutToday), cfg)!
    expect(c.group).toBe('breakout')
  })

  it('非暴跌日 + flag on:大盘没明显跌则不自适应 → 仍 watch', () => {
    const cfg: ScreenerConfig = { ...SCREENER, RS_ADAPTIVE_CLOSE: true, MARKET_CHG_PCT: 0 }
    expect(classify(makeBars(weakBreakoutToday), cfg)!.group).toBe('watch')
  })
})

describe('computeTarget modes (#2)', () => {
  it('rmult mode sets target = entry + R_MULT × risk, with no min-pct floor', () => {
    const cfg: ScreenerConfig = { ...SCREENER, TARGET_MODE: 'rmult', TARGET_R_MULT: 2.5 }
    const c = classify(makeBars(breakoutToday), cfg)!
    expect(c.target).toBeCloseTo(c.price + 2.5 * (c.price - c.stopLoss), 2)
    // 风险很小时 rmult 目标不应被 +TARGET_MIN_PCT 地板抬高(这正是修复 payoff<1 的关键)
    expect(c.target).toBeLessThan(c.price * (1 + SCREENER.TARGET_MIN_PCT / 100))
  })

  it('measured mode projects the base height above the pivot', () => {
    const cfg: ScreenerConfig = { ...SCREENER, TARGET_MODE: 'measured', BASE_LOOKBACK: 40 }
    const c = classify(makeBars(breakoutToday), cfg)!
    expect(c.target).toBeGreaterThan(c.pivot)
  })

  it('resistance mode keeps the original nearest-resistance target above entry', () => {
    const cfg: ScreenerConfig = { ...SCREENER, TARGET_MODE: 'resistance' }
    const c = classify(makeBars(breakoutToday), cfg)!
    expect(c.target).toBeGreaterThan(c.price)
  })

  it('default config (rmult) gives a reward target ≥ 1.5× the risk', () => {
    const c = classify(makeBars(breakoutToday))! // 默认 TARGET_MODE='rmult'
    const reward = c.target - c.price
    const risk = c.price - c.stopLoss
    expect(reward / risk).toBeGreaterThanOrEqual(1.5)
  })
})

describe('finalScore', () => {
  const base: Candidate = {
    group: 'breakout',
    price: 40,
    changePct: 1,
    pivot: 40,
    entry: 40,
    add: 42,
    stopLoss: 38,
    target: 44,
    rsRaw: 0.5,
    coil: 0.5,
    trendStrength: 0.5,
    volRatio: 0.6,
    atrRatio: 0.5,
    volScore: 0.5,
    distToPivotPct: 0,
    dist52Pct: 0,
    signals: { trendOk: true, volDry: false, atrContract: true, breakoutVol: true, pattern: '' },
  }

  it('rises monotonically with RS rank', () => {
    expect(finalScore(base, 0.9, 0.5)).toBeGreaterThan(finalScore(base, 0.1, 0.5))
  })
})

describe('marketRegime + targetRMultFor (动态目标位)', () => {
  it('flags a steady uptrend as strong (close > MA20 > MA50)', () => {
    const up = Array.from({ length: 60 }, (_, i) => 10 + i * 0.5)
    expect(marketRegime(up)).toBe('strong')
  })

  it('flags a steady downtrend as weak (close < MA50)', () => {
    const down = Array.from({ length: 60 }, (_, i) => 40 - i * 0.5)
    expect(marketRegime(down)).toBe('weak')
  })

  it('flags a pullback-in-uptrend (close below MA20 but above MA50) as neutral', () => {
    const rise = Array.from({ length: 40 }, (_, i) => 10 + i) // 10..49
    const flat = [...Array(19).fill(47), 46] // 顶部走平、末根微回落
    expect(marketRegime([...rise, ...flat])).toBe('neutral')
  })

  it('returns neutral when history is shorter than MA_SLOW', () => {
    expect(marketRegime([1, 2, 3])).toBe('neutral')
  })

  it('targetRMultFor returns the scalar TARGET_R_MULT when dynamic is off', () => {
    const cfg: ScreenerConfig = { ...SCREENER, TARGET_R_DYNAMIC: false }
    expect(targetRMultFor('strong', cfg)).toBe(SCREENER.TARGET_R_MULT)
    expect(targetRMultFor('weak', cfg)).toBe(SCREENER.TARGET_R_MULT)
  })

  it('targetRMultFor maps regime → R when dynamic is on (default config is the inverse map)', () => {
    // 默认 config 已开启动态 + 逆向映射:弱市目标更远、强市更近。
    expect(targetRMultFor('strong')).toBe(SCREENER.TARGET_R_BY_REGIME.strong)
    expect(targetRMultFor('weak')).toBe(SCREENER.TARGET_R_BY_REGIME.weak)
    expect(targetRMultFor('weak')).toBeGreaterThan(targetRMultFor('strong'))
  })
})
