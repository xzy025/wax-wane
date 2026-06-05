// US Market Data Fetcher

import { EM_HEADERS } from '../lib/emHeaders'
import { createCache } from '../lib/cache'

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

// US indices are not yet wired to a live upstream (returns mock); cache long.
const usCache = createCache<USData>({
  name: 'US',
  ttl: 5 * 60_000,
  fetcher: async () => {
    // TODO: When API is accessible, fetch from East Money
    console.log('[US] Using mock data')
    return getMockUSData()
  },
})

export function clearUSCache() {
  usCache.clear()
}

export async function fetchUSData(): Promise<USData> {
  return usCache.get()
}

export async function fetchUSStockQuotes(codes: string[]): Promise<IndexQuote[]> {
  const secids = codes.map((code) => `105.${code}`).join(',')
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18`

  try {
    const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return []
    const json = await res.json() as any
    if (!json.data?.diff) return []

    return json.data.diff.map((d: any) => ({
      code: d.f12,
      name: d.f14,
      price: d.f2 ?? 0,
      changePct: d.f3 ?? 0,
      changeAmt: d.f4 ?? 0,
      volume: d.f5 ?? 0,
      turnover: d.f6 ?? 0,
      high: d.f15 ?? 0,
      low: d.f16 ?? 0,
      open: d.f17 ?? 0,
      prevClose: d.f18 ?? 0,
    }))
  } catch {
    return []
  }
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
