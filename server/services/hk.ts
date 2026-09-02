// Hong Kong Market Data Fetcher

import { createCache } from '../lib/cache'
import { SINA_HEADERS } from '../lib/emHeaders'
import {
  fetchIndexQuotes,
  fetchQuotesByCodes,
  type IndexQuote,
  type IndexSpec,
} from './emQuotes'
import type { KlineBar } from './ashare'

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

/** Tencent row order: date, open, close, high, low, volume. */
export function mapTencentHKRows(rows: unknown[][]): KlineBar[] {
  const bars: KlineBar[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue
    const date = String(row[0] ?? '')
    const open = Number(row[1])
    const close = Number(row[2])
    const high = Number(row[3])
    const low = Number(row[4])
    const volume = Number(row[5])
    if (!date || ![open, close, high, low, volume].every(Number.isFinite) || close <= 0) continue
    const prevClose = bars.at(-1)?.close ?? open
    bars.push({
      date,
      open,
      close,
      high,
      low,
      volume,
      // Tencent's public HK history omits turnover. Keep it unknown rather than fabricating.
      turnover: null,
      amplitude: prevClose > 0 ? ((high - low) / prevClose) * 100 : 0,
      changePct: prevClose > 0 ? (close / prevClose - 1) * 100 : 0,
    })
  }
  return bars
}

/** HK daily/weekly/monthly history. Uses qfq when Tencent exposes it, otherwise raw listed prices. */
export async function fetchHKStockKline(
  code: string,
  period: number = 101,
  count: number = 280,
): Promise<{ name: string; klines: KlineBar[] }> {
  const symbol = code.replace(/^HK/i, '').padStart(5, '0')
  if (!/^\d{5}$/.test(symbol) || Number(symbol) <= 0) throw new Error(`Invalid HK code: ${code}`)
  const periodName = period === 102 ? 'week' : period === 103 ? 'month' : 'day'
  const nodeKey = `hk${symbol}`
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${nodeKey},${periodName},,,${count},qfq`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await fetch(url, {
      headers: { ...SINA_HEADERS, Referer: 'https://gu.qq.com/' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Tencent HK kline HTTP ${res.status}`)
    const json = (await res.json()) as {
      data?: Record<string, {
        qt?: Record<string, unknown[]>
        day?: unknown[][]
        week?: unknown[][]
        month?: unknown[][]
        qfqday?: unknown[][]
        qfqweek?: unknown[][]
        qfqmonth?: unknown[][]
      }>
    }
    const node = json.data?.[nodeKey]
    const rows = node?.[`qfq${periodName}` as 'qfqday' | 'qfqweek' | 'qfqmonth'] ??
      node?.[periodName as 'day' | 'week' | 'month'] ??
      []
    const klines = mapTencentHKRows(rows)
    if (klines.length === 0) throw new Error(`Tencent returned no HK kline for ${symbol}`)
    const quoteName = node?.qt?.[nodeKey]?.[1]
    const name = typeof quoteName === 'string' && quoteName ? quoteName : (await fetchHKStockQuotes([symbol]))[0]?.name ?? ''
    return { name, klines }
  } finally {
    clearTimeout(timer)
  }
}
