// Shared EastMoney quote fetcher (push2 ulist.np/get) for the US/HK banners.
//
// One endpoint serves every market; the market is encoded in the secid prefix:
//   1. / 0.   A-share (Shanghai / Shenzhen)
//   116.      Hong Kong
//   105/106/107.  US (NASDAQ / NYSE / AMEX)
//   100. / 124.   global & HK index feeds

import { EM_HEADERS } from '../lib/emHeaders'

export interface IndexQuote {
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

interface EMUlistItem {
  f2?: number
  f3?: number
  f4?: number
  f5?: number
  f6?: number
  f12?: string
  f14?: string
  f15?: number
  f16?: number
  f17?: number
  f18?: number
}

const FIELDS = 'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18'

/** Fetch quotes for explicit secids. Throws on network/HTTP failure. */
export async function fetchQuotesBySecids(secids: string[]): Promise<IndexQuote[]> {
  if (secids.length === 0) return []
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids.join(',')}&fields=${FIELDS}`
  const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`EastMoney ulist HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { diff?: EMUlistItem[] } }
  const diff = json.data?.diff ?? []
  return diff.map((d) => ({
    code: d.f12 ?? '',
    name: d.f14 ?? '',
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
}

/**
 * Infer the candidate secid(s) for a user-entered stock code:
 *   6-digit number  → A-share (6xxxxx Shanghai, otherwise Shenzhen)
 *   1-5 digit number → Hong Kong (zero-padded to 5)
 *   letters          → US; the exchange isn't knowable from the ticker, so fan
 *                      out to NASDAQ/NYSE/AMEX — ulist silently drops secids
 *                      that don't exist on that market.
 */
export function toSecids(code: string): string[] {
  const c = code.trim().toUpperCase()
  if (/^\d{6}$/.test(c)) return [c.startsWith('6') ? `1.${c}` : `0.${c}`]
  if (/^\d{1,5}$/.test(c)) return [`116.${c.padStart(5, '0')}`]
  return [`105.${c}`, `106.${c}`, `107.${c}`]
}

/** Fetch quotes for user-entered codes (mixed markets). Returns [] on failure. */
export async function fetchQuotesByCodes(codes: string[]): Promise<IndexQuote[]> {
  try {
    const quotes = await fetchQuotesBySecids(codes.flatMap(toSecids))
    // The US fan-out could in principle match one ticker on several exchanges; keep the first.
    const seen = new Set<string>()
    return quotes.filter((q) => {
      if (seen.has(q.code)) return false
      seen.add(q.code)
      return true
    })
  } catch {
    return []
  }
}

export interface IndexSpec {
  secid: string
  /** Stable key the frontend INDEX_CONFIG / i18n use (e.g. 'DJI', 'HCINT'). */
  code: string
}

/** Fetch a fixed set of indices, remapping EastMoney codes to stable keys. */
export async function fetchIndexQuotes(specs: IndexSpec[]): Promise<IndexQuote[]> {
  const quotes = await fetchQuotesBySecids(specs.map((s) => s.secid))
  const byEmCode = new Map(quotes.map((q) => [q.code, q]))
  const out: IndexQuote[] = []
  for (const spec of specs) {
    const q = byEmCode.get(spec.secid.split('.')[1])
    if (q) out.push({ ...q, code: spec.code })
  }
  if (out.length === 0) throw new Error('EastMoney returned no index data')
  return out
}

// --- Theme/sector comparison quotes ---------------------------------------
// Richer field set than fetchQuotesBySecids (adds PE / PB / 总市值 / 趋势) for
// the 题材 view. Kept separate so the HK/US banners' fetcher is untouched.

export interface ThemeQuote {
  code: string
  name: string
  price: number
  changePct: number
  pe: number | null // f9 动态市盈率（亏损为 null）
  pb: number | null // f23 市净率
  marketCap: number // f20 总市值（元）
  chg60: number | null // f24 60 日涨跌%
  chgYtd: number | null // f25 年初至今%
}

interface EMThemeItem {
  f2?: number | string
  f3?: number | string
  f9?: number | string
  f12?: string
  f14?: string
  f20?: number | string
  f23?: number | string
  f24?: number | string
  f25?: number | string
}

const THEME_FIELDS = 'f2,f3,f9,f12,f14,f20,f23,f24,f25'

/** EastMoney returns '-' for unavailable numerics (e.g. PE of a loss-maker). */
const emNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** Batch-fetch valuation+trend quotes for theme constituents. Throws on failure. */
export async function fetchThemeQuotes(secids: string[]): Promise<ThemeQuote[]> {
  if (secids.length === 0) return []
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids.join(',')}&fields=${THEME_FIELDS}`
  const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(6000) })
  if (!res.ok) throw new Error(`EastMoney ulist HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { diff?: EMThemeItem[] } }
  const diff = json.data?.diff ?? []
  return diff.map((d) => ({
    code: d.f12 ?? '',
    name: typeof d.f14 === 'string' ? d.f14 : String(d.f14 ?? ''),
    price: emNum(d.f2) ?? 0,
    changePct: emNum(d.f3) ?? 0,
    pe: emNum(d.f9),
    pb: emNum(d.f23),
    marketCap: emNum(d.f20) ?? 0,
    chg60: emNum(d.f24),
    chgYtd: emNum(d.f25),
  }))
}
