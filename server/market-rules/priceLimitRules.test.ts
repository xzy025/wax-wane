import { describe, expect, it } from 'vitest'
import { priceLimitRules } from './priceLimitRules'

describe('dated A-share price-limit rules', () => {
  it('covers main, 20cm, 30cm and 689 board mappings', () => {
    expect(priceLimitRules({ code: '600001', asOfDate: '2026-08-27', previousClose: 10 }).upperPrice).toBe(11)
    expect(priceLimitRules({ code: '300001', asOfDate: '2026-08-27', previousClose: 10 }).upperPrice).toBe(12)
    expect(priceLimitRules({ code: '688001', asOfDate: '2026-08-27', previousClose: 10 }).upperPrice).toBe(12)
    expect(priceLimitRules({ code: '689001', asOfDate: '2026-08-27', previousClose: 10 }).upperPrice).toBe(12)
    expect(priceLimitRules({ code: '830001', asOfDate: '2026-08-27', previousClose: 10 }).upperPrice).toBe(13)
  })

  it('applies the historical ST main-board change date', () => {
    const security = { riskWarning: true, riskWarningEffectiveFrom: '2020-01-01' as const }
    expect(priceLimitRules({ code: '600001', asOfDate: '2026-07-05', previousClose: 10, security }).upperPrice).toBe(10.5)
    expect(priceLimitRules({ code: '600001', asOfDate: '2026-07-06', previousClose: 10, security }).upperPrice).toBe(11)
  })

  it('fails closed for the first no-limit listing sessions and suspension', () => {
    const newStock = priceLimitRules({
      code: '600001',
      asOfDate: '2026-08-27',
      previousClose: 10,
      security: { listingDate: null },
      listedTradingDays: 3,
    })
    expect(newStock.unrestricted).toBe(true)
    expect(newStock.upperPrice).toBeNull()

    const suspended = priceLimitRules({
      code: '600001',
      asOfDate: '2026-08-27',
      previousClose: 10,
      security: { suspended: true },
    })
    expect(suspended.suspended).toBe(true)
    expect(suspended.upperPrice).toBeNull()
  })

  it('rounds the limit to the security tick size before comparison', () => {
    const result = priceLimitRules({
      code: '600001',
      asOfDate: '2026-08-27',
      previousClose: 10.03,
      security: { tickSize: 0.05 },
    })
    expect(result.upperPrice).toBe(11.05)
    expect(result.lowerPrice).toBe(9.05)
  })
})
