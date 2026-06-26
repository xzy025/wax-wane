import { describe, it, expect } from 'vitest'
import { classifyBreakoutPullback } from './breakoutPullbackRules'
import { PBREAK } from '../config/screener'
import type { Bar } from './screenerRules'

const dt = (i: number) => `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`

// 合成 100 根:平盘低量基底(前高≈base*1.01)→ daysAgo 日前放量突破日 → (中间守住)→ 今日回踩(下跌日,收站MA5上)。
function mkBars(o: {
  daysAgo?: number // 突破日距今日(1=昨日突破今日回踩)
  breakVol?: number
  baseVol?: number
  noBreak?: boolean // 突破日未过前高
  todayClose?: number
  todayLow?: number
  upDay?: boolean // 今日为上涨日(违反 REQUIRE_DOWN_DAY)
} = {}): Bar[] {
  const N = 100
  const base = 10
  const priorHigh = base * 1.01
  const breakVol = o.breakVol ?? 2500
  const baseVol = o.baseVol ?? 1000
  const daysAgo = o.daysAgo ?? 1
  const bars: Bar[] = []
  for (let i = 0; i < N; i++) bars.push({ date: dt(i), open: base, close: base, high: base * 1.01, low: base * 0.99, volume: baseVol })
  const pIdx = N - 1 - daysAgo
  if (o.noBreak) for (let i = pIdx - 20; i < pIdx; i++) bars[i] = { ...bars[i], high: base * 1.3 } // 前高抬到突破日之上
  // 放量突破日
  bars[pIdx] = { date: dt(pIdx), open: base, close: base * 1.1, high: base * 1.11, low: base * 0.995, volume: breakVol }
  // 中间守住日(daysAgo>1):站在前高之上小幅整理
  for (let k = pIdx + 1; k < N - 1; k++) bars[k] = { date: dt(k), open: 11, close: 11, high: 11.1, low: 10.5, volume: baseVol * 0.8 }
  // 今日:回踩日
  const last = N - 1
  const prevClose = bars[last - 1].close
  const close = o.todayClose ?? 10.7
  const open = o.upDay ? prevClose * 0.999 : prevClose * 0.99 // upDay 时让 close>prevClose
  const tClose = o.upDay ? prevClose + 0.2 : close
  const low = o.todayLow ?? 10.4
  const high = Math.max(11.0, tClose, open)
  bars[last] = { date: dt(last), open, close: tClose, high, low: Math.min(low, tClose, open), volume: baseVol * 0.9 }
  return bars
}

describe('classifyBreakoutPullback', () => {
  it('命中:昨日放量突破 + 今日回踩到MA5且收站MA5上', () => {
    const c = classifyBreakoutPullback(mkBars(), '300567', PBREAK)
    expect(c).not.toBeNull()
    expect(c!.group).toBe('breakpull')
    expect(c!.daysSinceBreak).toBe(1)
    expect(c!.breakVolRatio).toBeGreaterThanOrEqual(PBREAK.VOL_MULT)
    expect(c!.stop).toBeLessThan(c!.entry)
    expect(c!.target).toBeGreaterThan(c!.entry)
    expect(c!.price).toBeCloseTo(c!.entry, 5)
  })

  it('命中:突破2日前 + 今日回踩', () => {
    const c = classifyBreakoutPullback(mkBars({ daysAgo: 2 }), '300567', PBREAK)
    expect(c).not.toBeNull()
    expect(c!.daysSinceBreak).toBe(2)
  })

  it('突破日放量不足 → null', () => {
    expect(classifyBreakoutPullback(mkBars({ breakVol: 1200 }), '300567', PBREAK)).toBeNull()
  })

  it('突破日未过前高 → null', () => {
    expect(classifyBreakoutPullback(mkBars({ noBreak: true }), '300567', PBREAK)).toBeNull()
  })

  it('今日为上涨日(非回踩)→ null', () => {
    expect(classifyBreakoutPullback(mkBars({ upDay: true }), '300567', PBREAK)).toBeNull()
  })

  it('今日收盘跌破MA5 → null', () => {
    expect(classifyBreakoutPullback(mkBars({ todayClose: 9.9 }), '300567', PBREAK)).toBeNull()
  })

  it('回踩跌破突破位(不守)→ null', () => {
    expect(classifyBreakoutPullback(mkBars({ todayLow: 9.5 }), '300567', PBREAK)).toBeNull()
  })

  it('K线不足 MIN_BARS → null', () => {
    expect(classifyBreakoutPullback(mkBars().slice(-50), '300567', PBREAK)).toBeNull()
  })
})
