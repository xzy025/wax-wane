import { describe, it, expect } from 'vitest'
import { classifyTrendNewHigh } from './trendNewHighRules'
import { TRENDNEW } from '../config/screener'
import type { Bar } from './screenerRules'

const dt = (i: number) => `20${24 + Math.floor(i / 360)}-${String(1 + (Math.floor(i / 28) % 12)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`

// 默认包装:一根 OHLC 围绕收盘价 c(收在振幅上半区,收强≈0.67),日量 1000。
const wrap = (c: number, o: Partial<Bar> = {}, i = 0): Bar => ({
  date: dt(i),
  open: c * 0.997,
  close: c,
  high: c * 1.005,
  low: c * 0.99,
  volume: 1000,
  ...o,
})

// 平稳上行斜坡:close[i]=base·daily^i(月历级温和上涨)→ 完整多头排列 + 每日创新高 + 贴 52 周高。
function rampBars(N = 300, daily = 1.004, base = 10): Bar[] {
  const bars: Bar[] = []
  for (let i = 0; i < N; i++) bars.push(wrap(base * Math.pow(daily, i), {}, i))
  return bars
}

describe('classifyTrendNewHigh', () => {
  it('命中:稳步上行的趋势中军(多头排列+持续新高+贴52周高)', () => {
    const c = classifyTrendNewHigh(rampBars(), '600176', TRENDNEW)
    expect(c).not.toBeNull()
    expect(c!.group).toBe('trendnew')
    expect(c!.nhDays).toBeGreaterThanOrEqual(TRENDNEW.MIN_NH_DAYS)
    expect(c!.stop).toBeLessThan(c!.entry)
    expect(c!.target).toBeGreaterThan(c!.entry)
    expect(c!.riskReward).toBe(TRENDNEW.R_MULT)
    expect(c!.price).toBeCloseTo(c!.entry, 5)
    // 目标 = 进场 + R_MULT×风险(各值已 r2 取整,容差放到 0.05)
    expect(c!.target).toBeCloseTo(c!.entry + TRENDNEW.R_MULT * (c!.entry - c!.stop), 1)
  })

  it('K线不足 MIN_BARS → null', () => {
    expect(classifyTrendNewHigh(rampBars().slice(-200), '600176', TRENDNEW)).toBeNull()
  })

  it('横盘(非多头排列)→ null', () => {
    const bars = Array.from({ length: 300 }, (_, i) => wrap(10, {}, i))
    expect(classifyTrendNewHigh(bars, '600176', TRENDNEW)).toBeNull()
  })

  it('信号日收盘乏力(收在振幅下半区)→ null', () => {
    const bars = rampBars()
    const last = bars.length - 1
    const c = bars[last].close
    bars[last] = { ...bars[last], high: c * 1.04, low: c * 0.99, close: c, open: c * 1.02 } // 收强≈0.2
    expect(classifyTrendNewHigh(bars, '600176', TRENDNEW)).toBeNull()
  })

  it('近期未持续创新高(高点封顶在窗外)→ null', () => {
    const bars = rampBars()
    const last = bars.length - 1
    const peak = bars[last - TRENDNEW.RECENT_WIN].close // 窗口前一根=52周高所在
    // 把最近 RECENT_WIN 根压成"略低于峰值高点"的温和平台:不再创 60 日新高,但仍贴近 52 周高、维持多头。
    for (let k = 1; k <= TRENDNEW.RECENT_WIN; k++) {
      const idx = last - TRENDNEW.RECENT_WIN + k
      const cc = peak * (0.99 + 0.01 * (k / TRENDNEW.RECENT_WIN)) // peak·0.99..1.00
      bars[idx] = { ...bars[idx], close: cc, open: cc * 0.998, high: cc * 1.001, low: cc * 0.995 }
    }
    const c = classifyTrendNewHigh(bars, '600176', TRENDNEW)
    expect(c).toBeNull()
  })

  it('信号日暴涨过度脱离 MA20(追高 guard)→ null', () => {
    const bars = rampBars()
    const last = bars.length - 1
    const base = bars[last - 1].close
    const jump = base * 1.45 // 单日 +45%,远离 MA20
    bars[last] = { ...bars[last], open: base * 1.2, close: jump, high: jump * 1.001, low: base, volume: 4000 }
    expect(classifyTrendNewHigh(bars, '600176', TRENDNEW)).toBeNull()
  })
})
