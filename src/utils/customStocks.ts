const STORAGE_KEY = 'custom-stocks'

export interface CustomStocks {
  hk: string[]
  us: string[]
}

function readCustomStocks(): CustomStocks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { hk: [], us: [] }
    return JSON.parse(raw)
  } catch {
    return { hk: [], us: [] }
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
  const normalizedCode = code.trim().toUpperCase()
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
