import { describe, expect, it } from 'vitest'
import { normalizeSecurityCode, securityKey } from './securityCode'

describe('securityCode', () => {
  it('normalizes the supported HK spellings to one identity', () => {
    for (const code of ['HK2476', 'HK02476', '2476', '02476']) {
      expect(normalizeSecurityCode(code)).toMatchObject({
        market: 'HK',
        symbol: '02476',
        canonicalCode: 'HK2476',
      })
      expect(securityKey(code)).toBe('HK:02476')
    }
  })

  it('keeps six-digit A-share codes separate', () => {
    expect(normalizeSecurityCode('300476')).toEqual({
      market: 'A',
      symbol: '300476',
      canonicalCode: '300476',
      key: 'A:300476',
    })
  })

  it('rejects unsupported formats', () => {
    expect(normalizeSecurityCode('HK0')).toBeNull()
    expect(normalizeSecurityCode('NVDA')).toBeNull()
  })
})
