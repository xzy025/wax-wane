export type SecurityMarket = 'A' | 'HK'

export interface NormalizedSecurityCode {
  market: SecurityMarket
  symbol: string
  canonicalCode: string
  key: string
}

export function normalizeSecurityCode(raw: string): NormalizedSecurityCode | null {
  const value = raw.trim().toUpperCase()
  const prefixedHK = /^HK(\d{1,5})$/.exec(value)
  if (/^\d{6}$/.test(value)) {
    return { market: 'A', symbol: value, canonicalCode: value, key: `A:${value}` }
  }
  const digits = prefixedHK?.[1] ?? (/^\d{1,5}$/.test(value) ? value : '')
  if (!digits || Number(digits) <= 0) return null
  const symbol = digits.padStart(5, '0')
  return { market: 'HK', symbol, canonicalCode: `HK${Number(symbol)}`, key: `HK:${symbol}` }
}

export const securityKey = (code: string): string =>
  normalizeSecurityCode(code)?.key ?? code.trim().toUpperCase()
