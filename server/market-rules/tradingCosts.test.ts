import { describe, expect, it } from 'vitest'
import { orderSharesForCash, tradingCostsForDate, transactionCostCny } from './tradingCosts'

describe('date-effective trading costs', () => {
  it('changes statutory fees by effective date while keeping commission configurable', () => {
    expect(tradingCostsForDate('2022-06-30').stampDutyBps).toBe(10)
    expect(tradingCostsForDate('2023-08-28', { buyCommissionBps: 1 }).buyCommissionBps).toBe(1)
    expect(tradingCostsForDate('2023-08-28').stampDutyBps).toBe(5)
    expect(tradingCostsForDate('2022-06-30').transferFeeBps).toBe(0.2)
    expect(tradingCostsForDate('2022-07-01').transferFeeBps).toBe(0.1)
  })

  it('rounds buy quantity down to 100-share lots and applies minimum commission', () => {
    const costs = tradingCostsForDate('2026-08-27')
    expect(orderSharesForCash(10.03, 1_000, 100)).toBe(0)
    expect(orderSharesForCash(10.03, 10_100, 100)).toBe(1_000)
    expect(transactionCostCny({ side: 'buy', price: 10, shares: 100 }, costs)).toBeGreaterThanOrEqual(5)
    expect(transactionCostCny({ side: 'sell', price: 10, shares: 100 }, costs)).toBeGreaterThan(
      transactionCostCny({ side: 'buy', price: 10, shares: 100 }, costs),
    )
  })
})
