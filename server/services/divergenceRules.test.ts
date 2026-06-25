import { describe, it, expect } from 'vitest'
import {
  boardLimitPct,
  dailyVWAP,
  isLimitUpDay,
  touchedLimitOpened,
  consecutiveLimitUps,
  classifyDivergence,
  classifyHighDivergence,
  consolidationDays,
  consolScore,
} from './divergenceRules'
import { type Bar } from './screenerRules'

/** 一根日 bar;turnover 默认设成"均价=close"(成交额 = close×手×100)。 */
function bar(date: string, o: number, h: number, l: number, c: number, vol = 1000, vwap = c): Bar {
  return { date, open: o, close: c, high: h, low: l, volume: vol, turnover: vwap * vol * 100 }
}

/** N 根 10.00 平台 + 2 连板(10→11→12.10) + 一个可配置的今日分歧 bar。 */
function makeBars(today: Bar, base = 67): Bar[] {
  const bars: Bar[] = []
  for (let i = 0; i < base; i++) bars.push(bar(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 10, 10.05, 9.95, 10))
  bars.push(bar('2026-06-22', 10.2, 11.0, 10.1, 11.0)) // 板1 +10%
  bars.push(bar('2026-06-23', 11.2, 12.1, 11.1, 12.1)) // 板2 +10%(昨收11→12.10)
  bars.push(today) // 06-24 分歧日,prevClose=12.10,涨停价=13.31
  return bars
}

describe('boardLimitPct', () => {
  it('20% for ChiNext/STAR, 10% for main board', () => {
    expect(boardLimitPct('300750')).toBe(20)
    expect(boardLimitPct('688981')).toBe(20)
    expect(boardLimitPct('600519')).toBe(10)
    expect(boardLimitPct('000783')).toBe(10)
  })
})

describe('dailyVWAP (unit-robust)', () => {
  it('computes amount/volume and lands inside [low,high]', () => {
    const b = bar('d', 10, 10.5, 9.8, 10.2, 2000, 10.1)
    expect(dailyVWAP(b)).toBeCloseTo(10.1, 2)
  })
  it('returns null when turnover missing (Tencent fallback)', () => {
    expect(dailyVWAP({ date: 'd', open: 10, close: 10, high: 10.1, low: 9.9, volume: 1000 })).toBeNull()
  })
})

describe('limit-up helpers', () => {
  it('isLimitUpDay detects a sealed +10% close', () => {
    expect(isLimitUpDay(bar('d', 10.2, 11, 10.1, 11), 10, '600000')).toBe(true)
    expect(isLimitUpDay(bar('d', 10.2, 10.9, 10.1, 10.8), 10, '600000')).toBe(false)
  })
  it('touchedLimitOpened: high hit limit but close below = 炸板/分歧', () => {
    expect(touchedLimitOpened(bar('d', 12.5, 13.31, 12.4, 13.0), 12.1, '600000')).toBe(true)
    expect(touchedLimitOpened(bar('d', 12.5, 13.0, 12.4, 12.9), 12.1, '600000')).toBe(false)
  })
  it('consecutiveLimitUps counts the 2-board run', () => {
    const bars = makeBars(bar('2026-06-24', 13, 13.31, 12.5, 13.0))
    expect(consecutiveLimitUps(bars, bars.length - 2, '600000')).toBe(2) // 数到昨日(板2)
  })
})

describe('classifyDivergence', () => {
  it('flags a 2-board first-divergence holding VWAP as lianban tier-3', () => {
    // 今日触板未封(高13.31=涨停、收13.0),均价12.9<收13.0=弱转强
    const today = bar('2026-06-24', 13.0, 13.31, 12.5, 13.0, 3000, 12.9)
    const c = classifyDivergence(makeBars(today), '600000')
    expect(c).not.toBeNull()
    expect(c!.group).toBe('lianban')
    expect(c!.boards).toBe(2)
    expect(c!.touchedLimit).toBe(true)
    expect(c!.weakToStrong).toBe(true)
    expect(c!.tier).toBe(3)
    expect(c!.target).toBeCloseTo(13.31, 1) // 反包目标=今日涨停价
    expect(c!.stop).toBeLessThan(c!.price) // 止损在下方
    expect(c!.riskReward).toBeGreaterThan(0)
  })

  it('downgrades to weak (tier-1) when close is below VWAP', () => {
    const today = bar('2026-06-24', 13.0, 13.31, 12.4, 12.6, 3000, 12.9) // 收12.6<均价12.9
    const c = classifyDivergence(makeBars(today), '600000')!
    expect(c.group).toBe('lianban')
    expect(c.weakToStrong).toBe(false)
    expect(c.tier).toBe(1)
    expect(c.riskNote).toContain('均价下方')
  })

  it('returns null when today is still sealed (一致, not 分歧)', () => {
    const today = bar('2026-06-24', 13.0, 13.31, 12.8, 13.31, 3000, 13.0) // 收=涨停价=封死
    expect(classifyDivergence(makeBars(today), '600000')).toBeNull()
  })

  it('returns null with too few boards and no pullback-restart', () => {
    // 今日高振幅分歧(14%),但之前无连板、无回调二波启动 → 不取
    const bars: Bar[] = []
    for (let i = 0; i < 70; i++) bars.push(bar(`2026-03-${String((i % 28) + 1).padStart(2, '0')}`, 10, 10.05, 9.95, 10))
    bars.push(bar('2026-06-24', 10.0, 10.9, 9.5, 10.4, 3000, 10.2))
    expect(classifyDivergence(bars, '600000')).toBeNull()
  })
})

describe('classifyHighDivergence (连续新高·缩量十字星·守MA5)', () => {
  /** 稳步上行 69 根(连创新高)+ 强势新高日(prev)+ 可配置今日。 */
  function makeHD(today: Bar): Bar[] {
    const bars: Bar[] = []
    for (let i = 0; i < 68; i++) {
      const c = 10 + i * 0.13 // 10 → ~18.71,逐日新高
      bars.push({ date: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`, open: c - 0.05, close: c, high: c + 0.12, low: c - 0.12, volume: 1000 })
    }
    // prev(idx 68):强势新高日,收 19.0、高 19.5(上影<0.5、量未巨)
    bars.push({ date: '2026-06-23', open: 18.5, close: 19.0, high: 19.5, low: 18.4, volume: 1200 })
    bars.push(today) // idx 69 = 今日分歧日
    return bars
  }
  // 今日:缩量(500/1200=0.42)十字星(实体0.1/振幅0.5=0.2)、收19.1≥MA5、回撤小、收在上半区
  const hit: Bar = { date: '2026-06-24', open: 19.0, close: 19.1, high: 19.25, low: 18.75, volume: 500 }

  it('flags a 缩量十字星 holding MA5 after consecutive new highs', () => {
    const c = classifyHighDivergence(makeHD(hit), '600000')
    expect(c).not.toBeNull()
    expect(c!.group).toBe('highdiv')
    expect(c!.dryRatio).toBeCloseTo(0.42, 1)
    expect(c!.bodyRatio).toBeLessThanOrEqual(0.3)
    expect(c!.entry).toBeCloseTo(19.1, 2)
    expect(c!.stop).toBeLessThan(c!.entry)
    expect(c!.target).toBeGreaterThan(c!.entry)
    expect(c!.tier).toBeGreaterThanOrEqual(1)
  })

  it('rejects when volume is NOT dried up (放量, ratio > DRY)', () => {
    const noDry: Bar = { ...hit, volume: 1100 } // 1100/1200=0.92 > 0.7
    expect(classifyHighDivergence(makeHD(noDry), '600000')).toBeNull()
  })

  it('rejects when close breaks below MA5', () => {
    const belowMa5: Bar = { date: '2026-06-24', open: 18.8, close: 18.5, high: 18.9, low: 18.3, volume: 500 }
    expect(classifyHighDivergence(makeHD(belowMa5), '600000')).toBeNull()
  })

  it('rejects a big-body (non-doji) day', () => {
    const bigBody: Bar = { date: '2026-06-24', open: 18.5, close: 19.1, high: 19.2, low: 18.45, volume: 500 }
    expect(classifyHighDivergence(makeHD(bigBody), '600000')).toBeNull()
  })

  it('rejects when retrace from the new high is too deep (> RETR)', () => {
    // 把新高抬到 21.5 → 距高回撤 (21.5−19.1)/21.5 ≈ 11% > 8%
    const bars = makeHD(hit)
    bars[bars.length - 2] = { date: '2026-06-23', open: 19.0, close: 19.05, high: 21.5, low: 18.9, volume: 1200 }
    expect(classifyHighDivergence(bars, '600000')).toBeNull()
  })

  it('exposes consolDays on the candidate', () => {
    const c = classifyHighDivergence(makeHD(hit), '600000')!
    expect(c.consolDays).toBeGreaterThanOrEqual(1)
  })
})

describe('highdiv factors', () => {
  it('consolScore favors day 1 and decays with more days (data-driven, floors at 0.2)', () => {
    expect(consolScore(0)).toBe(0)
    expect(consolScore(1)).toBe(1) // 第1天最优(回测 0.23R)
    expect(consolScore(2)).toBeCloseTo(0.5, 2)
    expect(consolScore(3)).toBeCloseTo(0.35, 2)
    expect(consolScore(8)).toBe(0.2) // floor
    expect(consolScore(1)).toBeGreaterThan(consolScore(2)) // 第1天 > 第2天
    expect(consolScore(2)).toBeGreaterThan(consolScore(4)) // 越久越降
  })

  it('consolidationDays counts consecutive dry-up days holding MA5', () => {
    const bars: Bar[] = []
    for (let i = 0; i < 25; i++) bars.push(bar(`f${i}`, 10, 10.1, 9.9, 10, 5000))
    bars.push(bar('u', 10.2, 10.6, 10.1, 10.5, 9000)) // 放量新高日(量↑ → 不算整理)
    bars.push(bar('c1', 10.5, 10.6, 10.3, 10.45, 6000)) // 缩量站MA5
    bars.push(bar('c2', 10.45, 10.5, 10.3, 10.42, 4000))
    bars.push(bar('c3', 10.42, 10.48, 10.3, 10.44, 3000))
    const closes = bars.map((b) => b.close)
    expect(consolidationDays(bars, closes, bars.length - 1)).toBe(3) // c1/c2/c3,放量新高日截断
  })
})
