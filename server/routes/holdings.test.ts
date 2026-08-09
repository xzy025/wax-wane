import { describe, expect, it } from 'vitest'
import { parseHoldingPosition } from './holdings'

describe('parseHoldingPosition', () => {
  it.each(['HK2476', 'HK02476', '2476', '02476'])('accepts HK alias %s', (code) => {
    expect(parseHoldingPosition({ code, avgCost: 380 })).toEqual({
      code: 'HK2476',
      market: 'HK',
      symbol: '02476',
      avgCost: 380,
    })
  })

  it('accepts explicit market and preserves A-share behavior', () => {
    expect(parseHoldingPosition({ code: '2476', market: 'HK' })?.symbol).toBe('02476')
    expect(parseHoldingPosition({ code: '300476', market: 'A' })).toEqual({
      code: '300476',
      market: 'A',
      symbol: '300476',
      avgCost: undefined,
    })
  })

  it('rejects conflicting and unsupported inputs', () => {
    expect(parseHoldingPosition({ code: '2476', market: 'A' })).toBeNull()
    expect(parseHoldingPosition({ code: '300476', market: 'HK' })).toBeNull()
    expect(parseHoldingPosition({ code: 'NVDA' })).toBeNull()
    expect(parseHoldingPosition(null)).toBeNull()
  })
})
