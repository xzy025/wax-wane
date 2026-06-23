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
