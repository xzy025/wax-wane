import { describe, it, expect } from 'vitest'
import { classifyBreakoutHold } from './breakoutHoldRules'
import { BHOLD, BHOLD_WATCH } from '../config/screener'
import type { Bar } from './screenerRules'

const dt = (i: number) => `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`

// 合成 100 根:平盘低量基底(前高≈base*1.01)→ pole 放量大阳过前高 → consolN 根小实体整理(高低点抬升、守突破位)。
function mkBars(o: {
  baseVol?: number
  poleVol?: number
  poleBody?: number // %
  consolN?: number
  bigConsolBody?: boolean // 整理日大实体(非十字星)
  lowerHigh?: boolean // 整理日高点没抬高
  fallBack?: boolean // 整理日跌回前高下方(不守)
  noBreak?: boolean // pole 未过前高
} = {}): Bar[] {
  const N = 100
  const base = 10
  const baseVol = o.baseVol ?? 1000
  const poleVol = o.poleVol ?? 2500
  const poleBody = o.poleBody ?? 8
  const consolN = o.consolN ?? 1
  const priorHigh = base * 1.01
  const bars: Bar[] = []
  for (let i = 0; i < N; i++) bars.push({ date: dt(i), open: base, close: base, high: base * 1.01, low: base * 0.99, volume: baseVol })
  const poleIdx = N - 1 - consolN
  if (o.noBreak) for (let i = poleIdx - 20; i < poleIdx; i++) bars[i] = { ...bars[i], high: base * 1.3 } // 前高抬到 pole 之上
  const pOpen = base
  const pClose = base * (1 + poleBody / 100)
  bars[poleIdx] = { date: dt(poleIdx), open: pOpen, close: pClose, high: pClose * 1.01, low: pOpen * 0.99, volume: poleVol }
  let pH = bars[poleIdx].high
  let pL = bars[poleIdx].low
  for (let k = 1; k <= consolN; k++) {
    const idx = poleIdx + k
    let high = pH * 1.01
    let low = pL + (pH - pL) * 0.4
    if (o.lowerHigh && k === consolN) high = pH * 0.985 // 高点没抬高
    if (o.fallBack && k === consolN) low = priorHigh * 0.97 // 跌回前高下方
    const bodyHi = o.bigConsolBody && k === consolN ? 0.99 : 0.6
    const bodyLo = o.bigConsolBody && k === consolN ? 0.01 : 0.5
    const close = low + (high - low) * bodyHi
    const open = low + (high - low) * bodyLo
    bars[idx] = { date: dt(idx), open, close, high, low, volume: baseVol * 0.8 }
    pH = high
    pL = low
  }
  return bars
}

describe('classifyBreakoutHold', () => {
  it('命中:放量大阳过前高 + 1根十字星整理 + 高低点双抬', () => {
    const c = classifyBreakoutHold(mkBars(), '300567', BHOLD)
    expect(c).not.toBeNull()
    expect(c!.group).toBe('bhold')
    expect(c!.consolDays).toBe(1)
    expect(c!.higherHigh).toBe(true)
    expect(c!.higherLow).toBe(true)
    expect(c!.poleVolRatio).toBeGreaterThanOrEqual(BHOLD.POLE_VOL_MULT)
    expect(c!.stop).toBeLessThan(c!.entry)
    expect(c!.target).toBeGreaterThan(c!.entry)
    expect(c!.price).toBeCloseTo(c!.entry, 5)
  })

  it('命中:2根整理也可', () => {
    const c = classifyBreakoutHold(mkBars({ consolN: 2 }), '300567', BHOLD)
    expect(c).not.toBeNull()
    expect(c!.consolDays).toBe(2)
  })

  it('pole 放量不足(1.2×)→ null', () => {
    expect(classifyBreakoutHold(mkBars({ poleVol: 1200 }), '300567', BHOLD)).toBeNull()
  })

  it('pole 实体太小(2%)→ null', () => {
    expect(classifyBreakoutHold(mkBars({ poleBody: 2 }), '300567', BHOLD)).toBeNull()
  })

  it('整理日大实体(非十字星)→ null', () => {
    expect(classifyBreakoutHold(mkBars({ bigConsolBody: true }), '300567', BHOLD)).toBeNull()
  })

  it('整理跌回前高下方(不守突破位)→ null', () => {
    expect(classifyBreakoutHold(mkBars({ fallBack: true }), '300567', BHOLD)).toBeNull()
  })

  it('高点没抬高 → null', () => {
    expect(classifyBreakoutHold(mkBars({ lowerHigh: true }), '300567', BHOLD)).toBeNull()
  })

  it('pole 未过前高 → null', () => {
    expect(classifyBreakoutHold(mkBars({ noBreak: true }), '300567', BHOLD)).toBeNull()
  })

  it('K线不足 MIN_BARS → null', () => {
    expect(classifyBreakoutHold(mkBars().slice(-50), '300567', BHOLD)).toBeNull()
  })
})

describe('classifyBreakoutHold · 突破整理观察层(BHOLD_WATCH,精测电子300567真实案例)', () => {
  // 真实前复权K线(东财 secid=0.300567,fqt=1,klt=101),pole=2026-06-24、整理=2026-06-25。
  // 诊断结论:pole 实体+18.73%✓/突破前高223.62✓,量比152900/93997.9=1.627×——
  // 唯一不过 BHOLD 严格门槛(POLE_VOL_MULT=2.2);6/25 整理日十字星(实体率7.5%)+高低点双抬+
  // EXT_MAX_PCT(4.73%≤8%)全部吻合 → BHOLD_WATCH(仅放宽量比到1.5×)应命中。
  // 注:若把整理窗延到 6/26(consolN=2),6/26 收盘较 pole 已 +9.5%,超过 EXT_MAX_PCT=8%——
  // 即"两天整理"的后一天已脱离该门槛保护的"不追高"范围,故本用例锁定 consolN=1(6/25)这个真实吻合的窗口。
  const REAL_300567: Bar[] = [
    { date: '2026-06-09', open: 183, close: 188.88, high: 191, low: 179, volume: 67427 },
    { date: '2026-06-10', open: 186.62, close: 188.79, high: 199.5, low: 184, volume: 72569 },
    { date: '2026-06-11', open: 188.7, close: 192.9, high: 199.1, low: 187.1, volume: 72558 },
    { date: '2026-06-12', open: 205, close: 196.3, high: 212, low: 195, volume: 110748 },
    { date: '2026-06-15', open: 200, close: 208.46, high: 210, low: 192.15, volume: 106073 },
    { date: '2026-06-16', open: 210, close: 204.83, high: 213, low: 198.01, volume: 107252 },
    { date: '2026-06-17', open: 200, close: 215.76, high: 217.99, low: 197.01, volume: 105320 },
    { date: '2026-06-18', open: 211.59, close: 213.86, high: 218.35, low: 209, volume: 102249 },
    { date: '2026-06-22', open: 218.14, close: 213.8, high: 222.2, low: 204.5, volume: 106788 },
    { date: '2026-06-23', open: 210, close: 212.6, high: 223.62, low: 205.36, volume: 88995 },
    { date: '2026-06-24', open: 211.52, close: 251.13, high: 255.1, low: 210.02, volume: 152900 }, // pole
    { date: '2026-06-25', open: 261.58, close: 263, high: 269.5, low: 250.53, volume: 121143 }, // 整理(consolN=1)
  ]

  function real300567Bars(): Bar[] {
    const padCount = BHOLD.MIN_BARS - REAL_300567.length
    const pad: Bar[] = Array.from({ length: padCount }, (_, i) => ({
      date: `2025-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      open: 150, close: 150, high: 151.5, low: 148.5, volume: 50000,
    }))
    return [...pad, ...REAL_300567]
  }

  it('严格版 BHOLD:量比1.63×<2.2×门槛 → null', () => {
    expect(classifyBreakoutHold(real300567Bars(), '300567', BHOLD)).toBeNull()
  })

  it('观察版 BHOLD_WATCH(量比门槛放宽到1.5×):命中,且整理形态(十字星/高低点双抬)与严格版一致', () => {
    const c = classifyBreakoutHold(real300567Bars(), '300567', BHOLD_WATCH)
    expect(c).not.toBeNull()
    expect(c!.consolDays).toBe(1)
    expect(c!.higherHigh).toBe(true)
    expect(c!.higherLow).toBe(true)
    expect(c!.poleVolRatio).toBeCloseTo(1.63, 1)
    expect(c!.poleBodyPct).toBeCloseTo(18.73, 1)
  })
})
