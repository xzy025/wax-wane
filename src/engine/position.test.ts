import { describe, it, expect } from 'vitest'
import {
  validateTrades,
  getPositionQuantities,
  reconstructPositions,
  PositionState,
} from './position'
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
    commission: 1,
    stampTax: 0,
    transferFee: 0.1,
    otherFee: 0,
    netAmount: 998.9,
    raw: {},
    ...overrides,
  }
}

describe('validateTrades', () => {
  it('marks buy trades as valid', () => {
    const trades = [makeTrade({ side: 'buy', quantity: 100 })]
    const result = validateTrades(trades)
    expect(result[0].validationStatus).toBe('valid')
  })

  it('marks sell as error when exceeding position', () => {
    const trades = [
      makeTrade({ side: 'buy', quantity: 100, tradeDate: '2026-05-01' }),
      makeTrade({ side: 'sell', quantity: 200, tradeDate: '2026-05-02' }),
    ]
    const result = validateTrades(trades)
    expect(result[0].validationStatus).toBe('valid')
    expect(result[1].validationStatus).toBe('error')
    expect(result[1].validationMessage).toContain('超')
  })

  it('marks sell as valid when within position', () => {
    const trades = [
      makeTrade({ side: 'buy', quantity: 200, tradeDate: '2026-05-01' }),
      makeTrade({ side: 'sell', quantity: 100, tradeDate: '2026-05-02' }),
    ]
    const result = validateTrades(trades)
    expect(result[1].validationStatus).toBe('valid')
  })

  it('sorts trades by date before validating', () => {
    const trades = [
      makeTrade({ side: 'sell', quantity: 50, tradeDate: '2026-05-02' }),
      makeTrade({ side: 'buy', quantity: 100, tradeDate: '2026-05-01' }),
    ]
    const result = validateTrades(trades)
    // After sorting: buy first, then sell — should be valid
    expect(result.every((t) => t.validationStatus === 'valid')).toBe(true)
  })
})

describe('getPositionQuantities', () => {
  it('returns correct net position', () => {
    const trades = [
      makeTrade({ side: 'buy', quantity: 100, stockCode: 'A', tradeDate: '2026-05-01' }),
      makeTrade({ side: 'buy', quantity: 50, stockCode: 'A', tradeDate: '2026-05-02' }),
      makeTrade({ side: 'sell', quantity: 30, stockCode: 'A', tradeDate: '2026-05-03' }),
    ]
    const positions = getPositionQuantities(trades)
    expect(positions.get('A')).toBe(120)
  })

  it('handles multiple stocks', () => {
    const trades = [
      makeTrade({ side: 'buy', quantity: 100, stockCode: 'A', tradeDate: '2026-05-01' }),
      makeTrade({ side: 'buy', quantity: 200, stockCode: 'B', tradeDate: '2026-05-01' }),
    ]
    const positions = getPositionQuantities(trades)
    expect(positions.get('A')).toBe(100)
    expect(positions.get('B')).toBe(200)
  })
})

describe('reconstructPositions', () => {
  it('calculates avg cost for buys', () => {
    const trades = [
      makeTrade({
        side: 'buy',
        quantity: 100,
        price: 10,
        grossAmount: 1000,
        commission: 1,
        stampTax: 0,
        transferFee: 0,
        otherFee: 0,
        tradeDate: '2026-05-01',
      }),
      makeTrade({
        side: 'buy',
        quantity: 100,
        price: 12,
        grossAmount: 1200,
        commission: 1,
        stampTax: 0,
        transferFee: 0,
        otherFee: 0,
        tradeDate: '2026-05-02',
      }),
    ]
    const positions = reconstructPositions(trades)
    const pos = positions.get('600519')!
    expect(pos.quantity).toBe(200)
    // costBasis = 1000+1 + 1200+1 = 2202, avgCost = 2202/200 = 11.01
    expect(pos.avgCost).toBeCloseTo(11.01, 1)
  })

  it('calculates realized PnL on sell', () => {
    const trades = [
      makeTrade({
        side: 'buy',
        quantity: 100,
        price: 10,
        grossAmount: 1000,
        commission: 1,
        stampTax: 0,
        transferFee: 0,
        otherFee: 0,
        tradeDate: '2026-05-01',
      }),
      makeTrade({
        side: 'sell',
        quantity: 100,
        price: 15,
        grossAmount: 1500,
        commission: 1.5,
        stampTax: 1.5,
        transferFee: 0,
        otherFee: 0,
        tradeDate: '2026-05-02',
      }),
    ]
    const positions = reconstructPositions(trades)
    const pos = positions.get('600519')!
    expect(pos.quantity).toBe(0)
    // avgCost = 1001/100 = 10.01, costRemoved = 10.01 * 100 = 1001
    // sellProceeds = 1500 - 1.5 - 1.5 = 1497, realizedPnl = 1497 - 1001 = 496
    expect(pos.realizedPnl).toBeCloseTo(496, 0)
  })

  it('tracks total fees', () => {
    const trades = [
      makeTrade({
        side: 'buy',
        quantity: 100,
        commission: 5,
        stampTax: 0,
        transferFee: 1,
        otherFee: 0,
        tradeDate: '2026-05-01',
      }),
    ]
    const positions = reconstructPositions(trades)
    expect(positions.get('600519')!.totalFees).toBe(6)
  })
})
