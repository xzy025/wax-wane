// US Market Data Fetcher

import { createCache } from '../lib/cache'
import {
  fetchIndexQuotes,
  fetchQuotesByCodes,
  type IndexQuote,
  type IndexSpec,
} from './emQuotes'

export interface USData {
  indices: IndexQuote[]
}

// Fixed banner indices. secids verified against the live API (f14 names:
// 道琼斯 / 纳斯达克 / 标普500); codes are the stable keys the frontend uses.
const US_INDICES: IndexSpec[] = [
  { secid: '100.DJIA', code: 'DJI' },
  { secid: '100.NDX', code: 'IXIC' },
  { secid: '100.SPX', code: 'SPX' },
]

const usCache = createCache<USData>({
  name: 'US',
  ttl: 60_000,
  fetcher: async () => ({ indices: await fetchIndexQuotes(US_INDICES) }),
})

export function clearUSCache() {
  usCache.clear()
}

export async function fetchUSData(): Promise<USData> {
  return usCache.get()
}

export async function fetchUSStockQuotes(codes: string[]): Promise<IndexQuote[]> {
  return fetchQuotesByCodes(codes)
}
