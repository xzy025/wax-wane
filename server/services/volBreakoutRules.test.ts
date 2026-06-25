import { describe, it, expect } from 'vitest'
import { classifyVolBreakout } from './volBreakoutRules'
import { VOLBREAK } from '../config/screener'
import type { Bar } from './screenerRules'

// 合成 130 根日线:0..(N-rampDays-1) 平盘低量(基准),最后 rampDays 天按 rampPct 逐日上行;
// 最近 12 日窗口里 nBurst 天给高量(burstVol),其余基准量。默认=典型「资金驱动放量突破」命中样本。
function mkBars(o: {
  rampDays?: number
  rampPct?: number
  baseVol?: number
  burstVol?: number
  nBurst?: number // 最近 12 日里"高量"的天数(从最新往回数)
  weakClose?: boolean // 今日收盘弱(收在当日区间低位)
  todayClose?: number // 覆盖今日收盘
} = {}): Bar[] {
  const N = 280
  const base = 10
  const rampDays = o.rampDays ?? 14
  const rampPct = o.rampPct ?? 3
  const baseVol = o.baseVol ?? 1000
  const burstVol = o.burstVol ?? 3000
  const nBurst = o.nBurst ?? 12
  const rampStart = N - rampDays
  const bars: Bar[] = []
  for (let i = 0; i < N; i++) {
    const close = i < rampStart ? base : base * Math.pow(1 + rampPct / 100, i - rampStart + 1)
    const high = close * 1.01
    const low = close * 0.985
    const open = low + (high - low) * 0.3
    const inWin = i >= N - 12
    const isBurst = i >= N - nBurst
    const volume = inWin && isBurst ? burstVol : baseVol
    bars.push({ date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, open, close, high, low, volume })
  }
  const last = N - 1
  if (o.todayClose != null) {
    const c = o.todayClose
    const b = bars[last]
    bars[last] = { ...b, close: c, high: Math.max(b.high, c * 1.005), low: Math.min(b.low, c * 0.985) }
  }
  if (o.weakClose) {
    const b = bars[last]
    bars[last] = { ...b, high: b.close * 1.05, low: b.close * 0.99, open: b.close * 1.045 }
  }
  return bars
}

describe('classifyVolBreakout', () => {
  it('命中:持续放量 + 短期多头 + 创中期新高', () => {
    const c = classifyVolBreakout(mkBars(), '600141', VOLBREAK)
    expect(c).not.toBeNull()
    expect(c!.group).toBe('volbreak')
    expect(c!.volBurstDays).toBe(12) // 近12日全部≥2×基准
    expect(c!.volAvgRatio).toBeGreaterThanOrEqual(VOLBREAK.VOL_MULT)
    // 交易计划自洽:止损 < 进场 < 目标,进场=今日收盘
    expect(c!.stop).toBeLessThan(c!.entry)
    expect(c!.target).toBeGreaterThan(c!.entry)
    expect(c!.price).toBeCloseTo(c!.entry, 5)
  })

  it('放量不足(全程 1.5×)→ null', () => {
    expect(classifyVolBreakout(mkBars({ burstVol: 1500 }), '600141', VOLBREAK)).toBeNull()
  })

  it('放量天数不够(近12日仅6日达标)→ null', () => {
    expect(classifyVolBreakout(mkBars({ nBurst: 6 }), '600141', VOLBREAK)).toBeNull()
  })

  it('刚好够 8 日达标(宽松口径)→ 命中', () => {
    const c = classifyVolBreakout(mkBars({ nBurst: 8 }), '600141', VOLBREAK)
    // 近10日均量 = 8×3000 不足以独立判断,但 volBurstDays=8≥下限;avg10=(8*3000+2*1000)/10=2600≥2000
    expect(c).not.toBeNull()
    expect(c!.volBurstDays).toBe(8)
  })

  it('均线不是多头排列(平盘)→ null', () => {
    expect(classifyVolBreakout(mkBars({ rampDays: 0 }), '600141', VOLBREAK)).toBeNull()
  })

  it('今日未创中期新高(收盘低于前高)→ null', () => {
    expect(classifyVolBreakout(mkBars({ todayClose: 14.5 }), '600141', VOLBREAK)).toBeNull()
  })

  it('今日收盘弱(收在区间低位)→ null', () => {
    expect(classifyVolBreakout(mkBars({ weakClose: true }), '600141', VOLBREAK)).toBeNull()
  })

  it('K线不足 MIN_BARS → null', () => {
    expect(classifyVolBreakout(mkBars().slice(-100), '600141', VOLBREAK)).toBeNull()
  })
})
