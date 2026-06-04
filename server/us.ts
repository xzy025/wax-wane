// US Market Data Fetcher

interface IndexQuote {
  code: string
  name: string
  price: number
  changePct: number
  changeAmt: number
  volume: number
  turnover: number
  high: number
  low: number
  open: number
  prevClose: number
}

export interface USData {
  indices: IndexQuote[]
}

let cachedData: USData | null = null
let cacheTime = 0
const CACHE_TTL = 30_000

export function clearUSCache() {
  cachedData = null
  cacheTime = 0
}

export async function fetchUSData(): Promise<USData> {
  const now = Date.now()
  if (cachedData && now - cacheTime < CACHE_TTL) {
    return cachedData
  }

  // TODO: When API is accessible, fetch from East Money
  // const res = await fetch(`http://push2.eastmoney.com/api/qt/stock/get?secid=105.NVDA&fields=...`)
  console.log('[US] Using cached/mock data')
  cachedData = getMockUSData()
  cacheTime = now
  return cachedData
}

function getMockUSData(): USData {
  return {
    indices: [
      { code: 'NVDA', name: '英伟达', price: 125.38, changePct: 3.21, changeAmt: 3.90, volume: 45678901234, turnover: 5678901234567, high: 126.5, low: 122.0, open: 122.5, prevClose: 121.48 },
      { code: 'LITE', name: 'Lumentum', price: 38.65, changePct: -1.52, changeAmt: -0.60, volume: 2345678901, turnover: 98765432100, high: 39.8, low: 38.2, open: 39.5, prevClose: 39.25 },
      { code: 'AMD', name: 'AMD', price: 162.45, changePct: 2.14, changeAmt: 3.40, volume: 34567890123, turnover: 4567890123456, high: 163.0, low: 159.5, open: 160.0, prevClose: 159.05 },
      { code: 'TSM', name: '台积电', price: 178.92, changePct: 0.85, changeAmt: 1.50, volume: 12345678901, turnover: 2345678901234, high: 179.5, low: 177.0, open: 177.5, prevClose: 177.42 },
    ],
  }
}
