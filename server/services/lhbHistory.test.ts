import { describe, it, expect } from 'vitest'
import {
  lhbFactorFor,
  serializeLhbIndex,
  deserializeLhbIndex,
  type LhbIndex,
} from './lhbHistory'
import { boardStrengthAsOf } from './rotationRules'

// 构造合成索引:600000 在 3/10(纯净买+游资)、3/11(机构单日)、3/12(机构多日第2天)上榜。
function sampleIndex(): LhbIndex {
  return new Map([
    ['2026-03-10', new Map([['600000', { net: 5e7, instNet: 0, instBuy: false, hotNet: 4e7, hotBuy: true }]])],
    ['2026-03-11', new Map([['600000', { net: 8e7, instNet: 3e7, instBuy: true, hotNet: 0, hotBuy: false }]])],
    ['2026-03-12', new Map([['600000', { net: 9e7, instNet: 5e7, instBuy: true, hotNet: 0, hotBuy: false }]])],
  ])
}
const WIN = ['2026-03-10', '2026-03-11', '2026-03-12']

describe('lhbFactorFor', () => {
  it('aggregates net + institutional days/sum over the window', () => {
    const f = lhbFactorFor('600000', WIN, sampleIndex())
    expect(f.onDays).toBe(3)
    expect(f.netSum).toBeCloseTo(2.2e8, 0) // 5e7+8e7+9e7
    expect(f.instDays).toBe(2)
    expect(f.instNetSum).toBeCloseTo(8e7, 0) // 3e7+5e7
    expect(f.hotDays).toBe(1) // 仅 3/10 游资净买
    expect(f.hotNetSum).toBeCloseTo(4e7, 0)
  })

  it('scores institutional multi-day highest (>0.8)', () => {
    const f = lhbFactorFor('600000', WIN, sampleIndex())
    expect(f.score01).toBeGreaterThan(0.8)
    expect(f.score01).toBeLessThanOrEqual(1)
  })

  it('institutional single-day scores in 0.5..0.8', () => {
    const idx: LhbIndex = new Map([
      ['2026-03-11', new Map([['600000', { net: 8e7, instNet: 3e7, instBuy: true, hotNet: 0, hotBuy: false }]])],
    ])
    const f = lhbFactorFor('600000', WIN, idx)
    expect(f.instDays).toBe(1)
    expect(f.score01).toBeGreaterThanOrEqual(0.5)
    expect(f.score01).toBeLessThanOrEqual(0.8)
  })

  it('generic net-buy only (no institution) scores in 0.2..0.4', () => {
    const idx: LhbIndex = new Map([
      ['2026-03-10', new Map([['600000', { net: 5e7, instNet: 0, instBuy: false, hotNet: 0, hotBuy: false }]])],
    ])
    const f = lhbFactorFor('600000', WIN, idx)
    expect(f.instDays).toBe(0)
    expect(f.score01).toBeGreaterThanOrEqual(0.2)
    expect(f.score01).toBeLessThanOrEqual(0.4)
  })

  it('returns zero factor when stock never appears in window', () => {
    const f = lhbFactorFor('300999', WIN, sampleIndex())
    expect(f).toEqual({ onDays: 0, netSum: 0, instDays: 0, instNetSum: 0, hotDays: 0, hotNetSum: 0, score01: 0 })
  })

  it('only counts dates inside the supplied window', () => {
    const f = lhbFactorFor('600000', ['2026-03-12'], sampleIndex())
    expect(f.onDays).toBe(1)
    expect(f.instDays).toBe(1) // 仅 3/12 在窗口内
  })

  it('net-sum can be negative (net sell) → no positive score', () => {
    const idx: LhbIndex = new Map([
      ['2026-03-10', new Map([['600000', { net: -6e7, instNet: 0, instBuy: false, hotNet: 0, hotBuy: false }]])],
    ])
    const f = lhbFactorFor('600000', WIN, idx)
    expect(f.netSum).toBeLessThan(0)
    expect(f.score01).toBe(0)
  })
})

describe('serializeLhbIndex / deserializeLhbIndex', () => {
  it('round-trips a Map-of-Maps through plain JSON', () => {
    const idx = sampleIndex()
    const round = deserializeLhbIndex(JSON.parse(JSON.stringify(serializeLhbIndex(idx))))
    expect(round.get('2026-03-12')?.get('600000')).toEqual({ net: 9e7, instNet: 5e7, instBuy: true, hotNet: 0, hotBuy: false })
    expect([...round.keys()]).toEqual([...idx.keys()])
  })
})

describe('boardStrengthAsOf', () => {
  // 单调上升序列:长短窗均为正 → hs(强势延续)。
  const rising = Array.from({ length: 70 }, (_, i) => 10 + i * 0.5)

  it('classifies a rising board as hs (strong) as of a late index', () => {
    const s = boardStrengthAsOf(rising, 65, 60, 5)
    expect(s).not.toBeNull()
    expect(s!.quadrant).toBe('hs')
    expect(s!.strong).toBe(true)
    expect(s!.longChg).toBeGreaterThan(0)
    expect(s!.score01).toBeGreaterThan(0.7) // hs base 0.8 ± 0.1
  })

  it('slices to dateIdx (no look-ahead): a late dip flips short axis to weak', () => {
    // 升到 64,再连跌 5 根 → 近5日为负 → hw(高弱)。
    const dip = [...rising.slice(0, 65), 44, 43, 42, 41, 40]
    const s = boardStrengthAsOf(dip, dip.length - 1, 60, 5)
    expect(s).not.toBeNull()
    expect(s!.strong).toBe(false)
    expect(s!.quadrant).toBe('hw')
  })

  it('returns null when history is insufficient for the long window', () => {
    expect(boardStrengthAsOf(rising, 3, 60, 5)).toBeNull()
  })

  it('returns null for out-of-range dateIdx', () => {
    expect(boardStrengthAsOf(rising, 999, 60, 5)).toBeNull()
  })
})
