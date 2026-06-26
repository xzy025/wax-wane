import { describe, it, expect } from 'vitest'
import { classifyFundResonance } from './fundResonanceRules'
import { FUNDRES } from '../config/screener'
import type { Bar } from './screenerRules'

// 合成 100 根日线:前段平盘低量(基准),最后 rampDays 天按 rampPct 逐日上行(令 C>MA5>MA20、MA5 上行);
// 今日成交量 = todayVol(放量),收盘强(收在区间上沿)。默认=典型「资金流共振」命中样本。
function mkBars(o: {
  rampDays?: number
  rampPct?: number
  baseVol?: number
  todayVol?: number
  weakClose?: boolean
  todayClose?: number
  gapUpPct?: number // 今日相对昨收的高开幅度%(默认 1)
} = {}): Bar[] {
  const N = 100
  const base = 10
  const rampDays = o.rampDays ?? 20
  const rampPct = o.rampPct ?? 1
  const baseVol = o.baseVol ?? 1000
  const todayVol = o.todayVol ?? 2500
  const rampStart = N - rampDays
  const bars: Bar[] = []
  for (let i = 0; i < N; i++) {
    const close = i < rampStart ? base : base * Math.pow(1 + rampPct / 100, i - rampStart + 1)
    const high = close * 1.015
    const low = close * 0.99
    const open = low + (high - low) * 0.4
    bars.push({
      date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      open,
      close,
      high,
      low,
      volume: baseVol,
    })
  }
  const last = N - 1
  const b = bars[last]
  const prevClose = bars[last - 1].close
  const mid = o.todayClose ?? b.close
  const open = prevClose * (1 + (o.gapUpPct ?? 1) / 100)
  const high = Math.max(mid, open) * 1.02
  const low = Math.min(mid, open) * 0.98
  // 收盘位置:默认强(收在上沿 92%),weakClose 时弱(收在下沿 8%)
  const close = o.weakClose ? low + (high - low) * 0.08 : low + (high - low) * 0.92
  bars[last] = { ...b, open, close, high, low, volume: todayVol }
  return bars
}

describe('classifyFundResonance', () => {
  it('命中:放量 + 短期多头强势 + 有机构调研', () => {
    const c = classifyFundResonance(mkBars(), '600141', 3, FUNDRES)
    expect(c).not.toBeNull()
    expect(c!.group).toBe('fundres')
    expect(c!.surveyOrgs).toBe(3)
    expect(c!.volRatio).toBeGreaterThanOrEqual(FUNDRES.VOL_MULT)
    // 交易计划自洽
    expect(c!.stop).toBeLessThan(c!.entry)
    expect(c!.target).toBeGreaterThan(c!.entry)
    expect(c!.price).toBeCloseTo(c!.entry, 5)
    expect(c!.holdHint).toBe(FUNDRES.HOLD)
  })

  it('放量不足(1.2×)→ null', () => {
    expect(classifyFundResonance(mkBars({ todayVol: 1200 }), '600141', 3, FUNDRES)).toBeNull()
  })

  it('无机构调研(0 家,默认要求≥1)→ null', () => {
    expect(classifyFundResonance(mkBars(), '600141', 0, FUNDRES)).toBeNull()
  })

  it('SURVEY_MIN_ORGS=0 时无调研也可命中(纯放量强势)', () => {
    const c = classifyFundResonance(mkBars(), '600141', 0, { ...FUNDRES, SURVEY_MIN_ORGS: 0 })
    expect(c).not.toBeNull()
    expect(c!.riskNote).toContain('无机构调研背书')
  })

  it('均线空头(下行,MA5<MA20)→ null', () => {
    expect(classifyFundResonance(mkBars({ rampPct: -1 }), '600141', 3, FUNDRES)).toBeNull()
  })

  it('收盘弱(收在区间低位)→ null', () => {
    expect(classifyFundResonance(mkBars({ weakClose: true }), '600141', 3, FUNDRES)).toBeNull()
  })

  it('要求高开但低开 → null', () => {
    const bars = mkBars({ gapUpPct: -1 })
    expect(classifyFundResonance(bars, '600141', 3, { ...FUNDRES, REQUIRE_GAP_UP: true, GAP_MIN_PCT: 1 })).toBeNull()
  })

  it('K线不足 MIN_BARS → null', () => {
    expect(classifyFundResonance(mkBars().slice(-50), '600141', 3, FUNDRES)).toBeNull()
  })
})
