import { describe, it, expect } from 'vitest'
import { deriveAutoHoldings, mergeHoldings, type Holding, type ManualHolding } from './holdings'
import type { ParsedTrade } from '../types'

function makeTrade(overrides: Partial<ParsedTrade> = {}): ParsedTrade {
  return {
    tradeDate: '2026-05-01',
    stockCode: '600519',
    stockName: '贵州茅台',
    side: 'buy',
    quantity: 100,
    price: 10,
    grossAmount: 1000,
    commission: 0,
    stampTax: 0,
    transferFee: 0,
    otherFee: 0,
    netAmount: 1000,
    raw: {},
    ...overrides,
  }
}

describe('deriveAutoHoldings', () => {
  it('returns only codes with a positive net position', () => {
    const trades = [
      makeTrade({ stockCode: '600519', side: 'buy', quantity: 100 }),
      makeTrade({ stockCode: '000001', side: 'buy', quantity: 200, tradeDate: '2026-05-02' }),
      makeTrade({ stockCode: '000001', side: 'sell', quantity: 200, tradeDate: '2026-05-03' }),
    ]
    const holdings = deriveAutoHoldings(trades)
    expect(holdings.map((h) => h.code)).toEqual(['600519'])
    expect(holdings[0].quantity).toBe(100)
    expect(holdings[0].source).toBe('auto')
  })

  it('attaches the latest known name and average cost', () => {
    const trades = [
      makeTrade({ stockCode: '600519', stockName: '茅台', side: 'buy', quantity: 100, grossAmount: 1000 }),
      makeTrade({ stockCode: '600519', stockName: '贵州茅台', side: 'buy', quantity: 100, grossAmount: 3000, tradeDate: '2026-05-02' }),
    ]
    const [h] = deriveAutoHoldings(trades)
    expect(h.name).toBe('贵州茅台')
    expect(h.quantity).toBe(200)
    expect(h.avgCost).toBeCloseTo(20, 5) // (1000 + 3000) / 200
  })

  it('returns empty when there are no trades', () => {
    expect(deriveAutoHoldings([])).toEqual([])
  })
})

describe('mergeHoldings', () => {
  const auto: Holding[] = [
    { code: '600519', name: '贵州茅台', quantity: 100, avgCost: 1500, costBasis: 150000, source: 'auto' },
    { code: '000001', name: '平安银行', quantity: 200, avgCost: 10, costBasis: 2000, source: 'auto' },
  ]

  it('overrides an auto holding with a manual entry of the same code', () => {
    const manual: ManualHolding[] = [{ code: '600519', name: '贵州茅台', quantity: 50, avgCost: 1600 }]
    const merged = mergeHoldings(auto, manual)
    const moutai = merged.find((h) => h.code === '600519')!
    expect(moutai.quantity).toBe(50)
    expect(moutai.avgCost).toBe(1600)
    expect(moutai.costBasis).toBe(80000)
    expect(moutai.source).toBe('manual')
  })

  it('hides an auto holding when manual entry is marked hidden', () => {
    const manual: ManualHolding[] = [{ code: '000001', name: '平安银行', quantity: 0, avgCost: 0, hidden: true }]
    const merged = mergeHoldings(auto, manual)
    expect(merged.map((h) => h.code)).toEqual(['600519'])
  })

  it('adds a brand-new manual position not present in auto', () => {
    const manual: ManualHolding[] = [{ code: '300750', name: '宁德时代', quantity: 10, avgCost: 200 }]
    const merged = mergeHoldings(auto, manual)
    expect(merged.map((h) => h.code)).toContain('300750')
    expect(merged).toHaveLength(3)
  })
})
