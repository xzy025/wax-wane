import { describe, expect, it } from 'vitest'
import { normalizeSecurityCode } from './securityCode'

describe('normalizeSecurityCode', () => {
  it('normalizes A shares', () => {
    expect(normalizeSecurityCode('300476')).toEqual({
      market: 'A',
      symbol: '300476',
      canonicalCode: '300476',
      key: 'A:300476',
    })
  })

  it.each(['HK2476', 'hk02476', '2476', '02476'])('normalizes HK alias %s', (input) => {
    expect(normalizeSecurityCode(input)).toEqual({
      market: 'HK',
      symbol: '02476',
      canonicalCode: 'HK2476',
      key: 'HK:02476',
    })
  })

  it('honors an explicit HK market and rejects conflicting or invalid inputs', () => {
    expect(normalizeSecurityCode('2476', 'HK')?.symbol).toBe('02476')
    expect(normalizeSecurityCode('300476', 'HK')).toBeNull()
    expect(normalizeSecurityCode('2476', 'A')).toBeNull()
    expect(normalizeSecurityCode('HK0')).toBeNull()
    expect(normalizeSecurityCode('USNVDA')).toBeNull()
    expect(normalizeSecurityCode('2476', 'US')).toBeNull()
  })
})
