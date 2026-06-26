import { describe, it, expect } from 'vitest'
import { classifyBreakoutHold } from './breakoutHoldRules'
import { BHOLD } from '../config/screener'
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
