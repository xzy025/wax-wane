import { describe, it, expect } from 'vitest'
import { dedupeLhbByCode, groupLhbByDate, aggregateLhb, parseFundFlowWindow, type LhbDay, type LhbRow } from './moneyflow'

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

function day(date: string, rows: LhbRow[]): LhbDay {
  return { date, rows }
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

describe('groupLhbByDate', () => {
  it('groups raw billboard rows by trade date (desc), dedupes per day', () => {
    const data = [
      { SECURITY_CODE: 'A', SECURITY_NAME_ABBR: 'aa', TRADE_DATE: '2026-06-17 00:00:00', CLOSE_PRICE: 10, CHANGE_RATE: 5, TURNOVERRATE: 3, BILLBOARD_BUY_AMT: 150, BILLBOARD_SELL_AMT: 50, BILLBOARD_NET_AMT: 100, EXPLANATION: '涨幅', EXPLAIN: '机构' },
      { SECURITY_CODE: 'A', SECURITY_NAME_ABBR: 'aa', TRADE_DATE: '2026-06-17 00:00:00', CLOSE_PRICE: 10, CHANGE_RATE: 5, TURNOVERRATE: 3, BILLBOARD_BUY_AMT: 80, BILLBOARD_SELL_AMT: 20, BILLBOARD_NET_AMT: 60, EXPLANATION: '换手', EXPLAIN: '游资' },
      { SECURITY_CODE: 'B', SECURITY_NAME_ABBR: 'bb', TRADE_DATE: '2026-06-16 00:00:00', CLOSE_PRICE: 20, CHANGE_RATE: 2, TURNOVERRATE: 1, BILLBOARD_BUY_AMT: 500, BILLBOARD_SELL_AMT: 0, BILLBOARD_NET_AMT: 500, EXPLANATION: '', EXPLAIN: '' },
    ]
    const out = groupLhbByDate(data)
    expect(out.map((d) => d.date)).toEqual(['2026-06-17', '2026-06-16']) // 降序
    expect(out[0].rows).toHaveLength(1) // A 当日两条聚合为一
    expect(out[0].rows[0].netAmt).toBe(160)
    expect(out[1].rows[0].code).toBe('B')
  })
})

describe('aggregateLhb', () => {
  it('sums net across days, counts board days, takes latest change from most-recent day, sorts desc', () => {
    // days passed descending (most recent first)
    const days = [
      day('2026-06-17', [lhb({ code: 'A', netAmt: 100, changePct: 9 }), lhb({ code: 'B', netAmt: 80, changePct: 3 })]),
      day('2026-06-16', [lhb({ code: 'A', netAmt: 50, changePct: -2 })]),
    ]
    const out = aggregateLhb(days)
    expect(out.map((r) => r.code)).toEqual(['A', 'B']) // 150 vs 80
    const a = out[0]
    expect(a.totalNet).toBe(150)
    expect(a.days).toBe(2)
    expect(a.latestChangePct).toBe(9) // from 06-17 (first/most-recent)
    expect(out[1].days).toBe(1)
  })

  it('returns empty for no days', () => {
    expect(aggregateLhb([])).toEqual([])
  })
})

describe('parseFundFlowWindow', () => {
  it('maps window net/change keys to RankEntry, sorts by net desc, days=0, missing→0', () => {
    const diff = [
      { f12: 'A', f14: 'aa', f2: 10, f267: 3e8, f127: 12 },
      { f12: 'B', f14: 'bb', f2: 20, f267: 5e8, f127: -3 },
      { f12: 'C', f14: 'cc', f2: 5, f267: '-', f127: '-' }, // 缺失 → 0
    ]
    const out = parseFundFlowWindow(diff, 'f267', 'f127')
    expect(out.map((r) => r.code)).toEqual(['B', 'A', 'C']) // 5e8 > 3e8 > 0
    expect(out[0].totalNet).toBe(5e8)
    expect(out[0].latestChangePct).toBe(-3)
    expect(out[0].days).toBe(0)
    expect(out[2].totalNet).toBe(0)
  })
})
