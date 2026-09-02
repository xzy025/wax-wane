import { describe, expect, it } from 'vitest'
import { buildMacroIndicators } from './macro'

describe('macro market-data contract', () => {
  it('does not fabricate values when both upstream sources are unavailable', () => {
    const indicators = buildMacroIndicators({
      receivedAt: '2026-09-01T01:00:00.000Z',
      twelveError: 'Twelve Data unavailable',
      usdCnyError: 'ExchangeRate-API unavailable',
    })

    expect(indicators).toHaveLength(7)
    expect(indicators.every((item) => item.value == null && item.previousClose == null)).toBe(true)
    expect(indicators.every((item) => item.status === 'unavailable')).toBe(true)
  })

  it('marks a quote without previous close as degraded instead of inventing one', () => {
    const [indicator] = buildMacroIndicators({
      receivedAt: '2026-09-01T01:00:00.000Z',
      twelve: {
        receivedAt: '2026-09-01T01:00:00.000Z',
        data: [{ symbol: 'TNX', close: '4.25' }],
      },
      usdCnyError: 'not needed',
    })

    expect(indicator).toMatchObject({
      id: 'us10y',
      value: 4.25,
      previousClose: null,
      status: 'degraded',
    })
  })
})
