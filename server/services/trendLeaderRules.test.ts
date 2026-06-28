import { describe, it, expect } from 'vitest'
import { classifyTrendLeader, consecutiveAboveMA5 } from './trendLeaderRules'
import { classifyTrendNewHigh } from './trendNewHighRules'
import { TRENDWATCH, TRENDNEW } from '../config/screener'
import type { Bar } from './screenerRules'

const dt = (i: number) => `20${24 + Math.floor(i / 360)}-${String(1 + (Math.floor(i / 28) % 12)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`

// 一根 OHLC 围绕收盘价 c(收在振幅上半区,收强≈0.67),日量 1000。
const wrap = (c: number, o: Partial<Bar> = {}, i = 0): Bar => ({
  date: dt(i),
  open: c * 0.997,
  close: c,
  high: c * 1.005,
  low: c * 0.99,
  volume: 1000,
  ...o,
})

// 平稳上行斜坡 → 完整多头排列 + 持续创新高 + 连续站上 MA5。
function rampBars(N = 300, daily = 1.004, base = 10): Bar[] {
  const bars: Bar[] = []
  for (let i = 0; i < N; i++) bars.push(wrap(base * Math.pow(daily, i), {}, i))
  return bars
}

describe('classifyTrendLeader（趋势中军·监控）', () => {
  it('命中:稳步上行的趋势中军(多头排列+持续新高+连续站上MA5)', () => {
    const c = classifyTrendLeader(rampBars(), '600176', TRENDWATCH)
    expect(c).not.toBeNull()
    expect(c!.group).toBe('trendwatch')
    expect(c!.nhDays).toBeGreaterThanOrEqual(TRENDWATCH.MIN_NH_DAYS)
    expect(c!.ma5HoldDays).toBeGreaterThanOrEqual(TRENDWATCH.MA5_HOLD_MIN)
    expect(c!.price).toBeCloseTo(c!.maRef * (1 + c!.extPct / 100), 1) // extPct 自洽
  })

  it('K线不足 MIN_BARS → null', () => {
    expect(classifyTrendLeader(rampBars().slice(-200), '600176', TRENDWATCH)).toBeNull()
  })

  it('横盘(非多头排列)→ null', () => {
    const bars = Array.from({ length: 300 }, (_, i) => wrap(10, {}, i))
    expect(classifyTrendLeader(bars, '600176', TRENDWATCH)).toBeNull()
  })

  it('放宽收强:今日弱收盘(收强≈0.2)仍命中——而趋势新高同输入被挡(交叉证明放宽了买点门槛)', () => {
    const bars = rampBars()
    const last = bars.length - 1
    const c = bars[last].close
    bars[last] = { ...bars[last], high: c * 1.04, low: c * 0.99, close: c, open: c * 1.02 } // 收强≈0.2
    expect(classifyTrendLeader(bars, '600176', TRENDWATCH)).not.toBeNull() // 监控清单收它
    expect(classifyTrendNewHigh(bars, '600176', TRENDNEW)).toBeNull() // 买点战法不收(收强不够)
  })

  it('跌破 MA5(连续站上MA5天数=0)→ null', () => {
    const bars = rampBars()
    const last = bars.length - 1
    const c = bars[last - 1].close * 0.985 // 今日小幅回落到 MA5 下方(仍 > MA20,趋势模板不破)
    bars[last] = { ...bars[last], open: c, close: c, high: c * 1.002, low: c * 0.99 }
    expect(consecutiveAboveMA5(bars.map((b) => b.close), last)).toBe(0)
    expect(classifyTrendLeader(bars, '600176', TRENDWATCH)).toBeNull()
  })

  it('追高 guard 仍滤垂直顶:单日暴涨过度脱离 MA20(>EXT_MAX_PCT)→ null', () => {
    const bars = rampBars()
    const last = bars.length - 1
    const base = bars[last - 1].close
    const jump = base * 1.45 // 单日 +45%,远超 40% 上限
    bars[last] = { ...bars[last], open: base * 1.2, close: jump, high: jump * 1.001, low: base, volume: 4000 }
    expect(classifyTrendLeader(bars, '600176', TRENDWATCH)).toBeNull()
  })

  it('consecutiveAboveMA5 计数正确', () => {
    const closes = rampBars().map((b) => b.close)
    const last = closes.length - 1
    expect(consecutiveAboveMA5(closes, last)).toBeGreaterThanOrEqual(TRENDWATCH.MA5_HOLD_MIN)
    // 末根压到 MA5 下方 → 归零
    const ma5 = (closes.slice(last - 4, last + 1).reduce((s, x) => s + x, 0)) / 5
    closes[last] = ma5 * 0.9
    expect(consecutiveAboveMA5(closes, last)).toBe(0)
  })
})
