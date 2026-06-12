const STORAGE_KEY = 'custom-stocks'

export interface CustomStocks {
  hk: string[]
  us: string[]
}

// First-run defaults, shown until the user edits the list for that market.
// The HK banner accepts mixed codes: 5-digit HK stocks and 6-digit A-shares
// (the backend infers the market from the code format).
export const DEFAULT_STOCKS: CustomStocks = {
  hk: ['00700', '09988', '300476'],
  us: ['NVDA', 'AMD', 'TSM', 'LITE'],
}

/** Uppercase; zero-pad short numeric HK codes to 5 digits (700 → 00700). */
export function normalizeStockCode(market: 'hk' | 'us', code: string): string {
  const c = code.trim().toUpperCase()
  if (market === 'hk' && /^\d{1,5}$/.test(c)) return c.padStart(5, '0')
  return c
}

function readCustomStocks(): CustomStocks {
  const defaults = () => ({ hk: [...DEFAULT_STOCKS.hk], us: [...DEFAULT_STOCKS.us] })
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults()
    const parsed = JSON.parse(raw)
    // A market the user has never edited falls back to its default list;
    // an edited market keeps the stored value (including an emptied list).
    return {
      hk: Array.isArray(parsed.hk) ? parsed.hk : [...DEFAULT_STOCKS.hk],
      us: Array.isArray(parsed.us) ? parsed.us : [...DEFAULT_STOCKS.us],
    }
  } catch {
    return defaults()
  }
}

function writeCustomStocks(stocks: CustomStocks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stocks))
  } catch {
    // quota exceeded, ignore
  }
}

export function getCustomStocks(market: 'hk' | 'us'): string[] {
  return readCustomStocks()[market]
}

export function addCustomStock(market: 'hk' | 'us', code: string): boolean {
  const stocks = readCustomStocks()
  const normalizedCode = normalizeStockCode(market, code)
  if (!normalizedCode) return false
  if (stocks[market].includes(normalizedCode)) return false
  stocks[market].push(normalizedCode)
  writeCustomStocks(stocks)
  return true
}

export function removeCustomStock(market: 'hk' | 'us', code: string): void {
  const stocks = readCustomStocks()
  stocks[market] = stocks[market].filter((c) => c !== code)
  writeCustomStocks(stocks)
}
