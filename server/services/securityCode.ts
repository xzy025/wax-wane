export type SecurityMarket = 'A' | 'HK'

export interface NormalizedSecurityCode {
  market: SecurityMarket
  /** Provider-facing symbol: six digits for A shares, five digits for HK. */
  symbol: string
  /** Stable user-facing representation used in TA results and new holdings. */
  canonicalCode: string
  /** Stable identity for cache and deduplication. */
  key: string
}

const normalizeMarket = (market: unknown): SecurityMarket | null => {
  if (typeof market !== 'string' || !market.trim()) return null
  const value = market.trim().toUpperCase()
  return value === 'A' || value === 'CN' || value === 'ASHARE'
    ? 'A'
    : value === 'HK' || value === 'HKG'
      ? 'HK'
      : null
}

/** Parse A-share and HK inputs without allowing a five-digit HK symbol to fall into A-share IO. */
export function normalizeSecurityCode(raw: unknown, marketHint?: unknown): NormalizedSecurityCode | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toUpperCase()
  if (!value) return null

  const hinted = normalizeMarket(marketHint)
  if (marketHint !== undefined && marketHint !== null && String(marketHint).trim() && !hinted) return null

  const prefixedHK = /^HK(\d{1,5})$/.exec(value)
  const inferred: SecurityMarket | null = prefixedHK ? 'HK' : /^\d{6}$/.test(value) ? 'A' : /^\d{1,5}$/.test(value) ? 'HK' : null
  const market = hinted ?? inferred
  if (!market) return null

  if (market === 'A') {
    if (!/^\d{6}$/.test(value)) return null
    return { market, symbol: value, canonicalCode: value, key: `A:${value}` }
  }

  const digits = prefixedHK?.[1] ?? (/^\d{1,5}$/.test(value) ? value : '')
  if (!digits || Number(digits) <= 0) return null
  const symbol = digits.padStart(5, '0')
  return { market, symbol, canonicalCode: `HK${Number(symbol)}`, key: `HK:${symbol}` }
}
