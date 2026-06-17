import { describe, it, expect } from 'vitest'
import {
  dedupeLhbByCode,
  aggregateLhb,
  aggregateFundFlow,
  type DailySnapshot,
  type LhbRow,
  type FundFlowRow,
} from './moneyflow'

function lhb(over: Partial<LhbRow>): LhbRow {
  return {
    code: '000001',
    name: 'stub',
    close: 10,
    changePct: 0,
    turnover: 0,
    netAmt: 0,
    buyAmt: 0,
    sellAmt: 0,
    reason: '',
    seat: '',
    ...over,
  }
}

function fund(over: Partial<FundFlowRow>): FundFlowRow {
  return { code: '000001', name: 'stub', price: 10, changePct: 0, mainNet: 0, mainNetPct: 0, superNet: 0, bigNet: 0, ...over }
}

function snap(date: string, lhbRows: LhbRow[], fundRows: FundFlowRow[]): DailySnapshot {
  return { date, fetchedAt: `${date}T08:00:00Z`, lhb: lhbRows, fundFlow: fundRows }
}

describe('dedupeLhbByCode', () => {
  it('sums buy/sell/net for repeated codes, joins distinct reasons, sorts by net desc', () => {
    const out = dedupeLhbByCode([
      { code: 'A', name: 'aa', close: 10, changePct: 5, turnover: 3, netAmt: 100, buyAmt: 150, sellAmt: 50, reason: '涨幅偏离', seat: '机构' },
      { code: 'A', name: 'aa', close: 10, changePct: 5, turnover: 3, netAmt: 60, buyAmt: 80, sellAmt: 20, reason: '换手率', seat: '游资' },
      { code: 'B', name: 'bb', close: 20, changePct: 2, turnover: 1, netAmt: 500, buyAmt: 500, sellAmt: 0, reason: '', seat: '' },
    ])
    expect(out.map((r) => r.code)).toEqual(['B', 'A']) // 500 before 160
    const a = out.find((r) => r.code === 'A')!
    expect(a.netAmt).toBe(160)
    expect(a.buyAmt).toBe(230)
    expect(a.sellAmt).toBe(70)
    expect(a.reason).toBe('涨幅偏离; 换手率')
    expect(a.seat).toBe('机构; 游资')
  })
})

describe('aggregateLhb', () => {
  it('sums net across days, counts board days, takes latest change from most-recent snapshot, sorts desc', () => {
    // snaps passed descending (most recent first)
    const snaps = [
      snap('2026-06-17', [lhb({ code: 'A', netAmt: 100, changePct: 9 }), lhb({ code: 'B', netAmt: 80, changePct: 3 })], []),
      snap('2026-06-16', [lhb({ code: 'A', netAmt: 50, changePct: -2 })], []),
    ]
    const out = aggregateLhb(snaps)
    expect(out.map((r) => r.code)).toEqual(['A', 'B']) // 150 vs 80
    const a = out[0]
    expect(a.totalNet).toBe(150)
    expect(a.days).toBe(2)
    expect(a.latestChangePct).toBe(9) // from 06-17 (first/most-recent)
    expect(out[1].days).toBe(1)
  })

  it('returns empty for no snapshots', () => {
    expect(aggregateLhb([])).toEqual([])
  })
})

describe('aggregateFundFlow', () => {
  it('sums main net inflow across days and counts appearance days', () => {
    const snaps = [
      snap('2026-06-17', [], [fund({ code: 'X', mainNet: 3e8, changePct: 10 })]),
      snap('2026-06-16', [], [fund({ code: 'X', mainNet: 1e8, changePct: 4 }), fund({ code: 'Y', mainNet: 2e8, changePct: 1 })]),
    ]
    const out = aggregateFundFlow(snaps)
    expect(out.map((r) => r.code)).toEqual(['X', 'Y']) // 4e8 vs 2e8
    expect(out[0].totalNet).toBe(4e8)
    expect(out[0].days).toBe(2)
    expect(out[0].latestChangePct).toBe(10)
    expect(out[1].days).toBe(1)
  })
})
