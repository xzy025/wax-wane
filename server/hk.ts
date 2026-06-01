// Hong Kong Market Data Fetcher

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

export interface HKData {
  indices: IndexQuote[]
}

let cachedData: HKData | null = null
let cacheTime = 0
const CACHE_TTL = 30_000

export async function fetchHKData(): Promise<HKData> {
  const now = Date.now()
  if (cachedData && now - cacheTime < CACHE_TTL) {
    return cachedData
  }

  // TODO: When API is accessible, fetch from East Money
  console.log('[HK] Using cached/mock data')
  cachedData = getMockHKData()
  cacheTime = now
  return cachedData
}

function getMockHKData(): HKData {
  return {
    indices: [
      { code: 'HSI', name: '恒生指数', price: 18258.65, changePct: 1.23, changeAmt: 221.98, volume: 1234567890, turnover: 98765432100, high: 18320.0, low: 18100.0, open: 18150.0, prevClose: 18036.67 },
      { code: 'HSTECH', name: '恒生科技', price: 3856.42, changePct: 2.56, changeAmt: 96.14, volume: 987654321, turnover: 76543210000, high: 3880.0, low: 3800.0, open: 3810.0, prevClose: 3760.28 },
      { code: 'HCINT', name: '中概互联', price: 6542.18, changePct: -0.82, changeAmt: -54.12, volume: 567890123, turnover: 45678901234, high: 6600.0, low: 6520.0, open: 6580.0, prevClose: 6596.3 },
    ],
  }
}
