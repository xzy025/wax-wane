// Hong Kong Market Data Fetcher

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

export interface HKData {
  indices: IndexQuote[]
}

// HK indices are not yet wired to a live upstream (returns mock); cache long.
const hkCache = createCache<HKData>({
  name: 'HK',
  ttl: 5 * 60_000,
  fetcher: async () => {
    // TODO: When API is accessible, fetch from East Money
    console.log('[HK] Using mock data')
    return getMockHKData()
  },
})

export function clearHKCache() {
  hkCache.clear()
}

export async function fetchHKData(): Promise<HKData> {
  return hkCache.get()
}

export async function fetchHKStockQuotes(codes: string[]): Promise<IndexQuote[]> {
  const secids = codes.map((code) => `116.${code}`).join(',')
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

function getMockHKData(): HKData {
  return {
    indices: [
      { code: 'HSI', name: '恒生指数', price: 18258.65, changePct: 1.23, changeAmt: 221.98, volume: 1234567890, turnover: 98765432100, high: 18320.0, low: 18100.0, open: 18150.0, prevClose: 18036.67 },
      { code: 'HSTECH', name: '恒生科技', price: 3856.42, changePct: 2.56, changeAmt: 96.14, volume: 987654321, turnover: 76543210000, high: 3880.0, low: 3800.0, open: 3810.0, prevClose: 3760.28 },
      { code: 'HCINT', name: '中概互联', price: 6542.18, changePct: -0.82, changeAmt: -54.12, volume: 567890123, turnover: 45678901234, high: 6600.0, low: 6520.0, open: 6580.0, prevClose: 6596.3 },
    ],
  }
}
