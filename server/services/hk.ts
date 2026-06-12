// Hong Kong Market Data Fetcher

import { createCache } from '../lib/cache'
import {
  fetchIndexQuotes,
  fetchQuotesByCodes,
  type IndexQuote,
  type IndexSpec,
} from './emQuotes'

export interface HKData {
  indices: IndexQuote[]
}

// Fixed banner indices. secids verified against the live API (f14 names:
// 恒生指数 / 恒生科技指数 / 中概互联网ETF易方达). HCINT intentionally maps to
// the A-share ETF 513050 — the banner has always shown it as 中概互联.
const HK_INDICES: IndexSpec[] = [
  { secid: '100.HSI', code: 'HSI' },
  { secid: '124.HSTECH', code: 'HSTECH' },
  { secid: '1.513050', code: 'HCINT' },
]

const hkCache = createCache<HKData>({
  name: 'HK',
  ttl: 60_000,
  fetcher: async () => ({ indices: await fetchIndexQuotes(HK_INDICES) }),
})

export function clearHKCache() {
  hkCache.clear()
}

export async function fetchHKData(): Promise<HKData> {
  return hkCache.get()
}

export async function fetchHKStockQuotes(codes: string[]): Promise<IndexQuote[]> {
  return fetchQuotesByCodes(codes)
}
