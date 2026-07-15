// Resolve a user-typed query (6-digit code OR Chinese stock name) to an A-share
// {code, name} via East Money's suggest API. Used by the fundamental-analysis
// endpoint so the Agent-tab chat accepts either a code or a name.

import { emFetch } from '../lib/emFetch'
import { EM_HEADERS } from '../lib/emHeaders'

export interface StockMatch {
  code: string
  name: string
}

interface SuggestRow {
  Code?: string
  Name?: string
  Classify?: string
  SecurityTypeName?: string
  MarketType?: string
}

const EXCLUDE_CLASSIFY = /Index|Fund|Bond|HKStock|USStock|Block|Plate/i
const EXCLUDE_TYPENAME = /指数|债|ETF|LOF|基金|港股|美股|板块|期货|外汇/

/**
 * Pick the best A-share match from East Money suggest rows
 * (`QuotationCodeTable.Data`). Two passes: prefer rows explicitly flagged as
 * A-shares; otherwise fall back to the first 6-digit code that isn't an
 * index/fund/HK/US security. Pure (no network) so it can be unit-tested.
 */
export function pickBestStockMatch(rows: unknown): StockMatch | null {
  if (!Array.isArray(rows)) return null
  const candidates = rows as SuggestRow[]

  const isExcluded = (r: SuggestRow) =>
    EXCLUDE_CLASSIFY.test(String(r?.Classify ?? '')) ||
    EXCLUDE_TYPENAME.test(String(r?.SecurityTypeName ?? ''))

  const validCode = (r: SuggestRow) => /^\d{6}$/.test(String(r?.Code ?? '').trim())

  // Pass 1: explicit A-share flag.
  for (const r of candidates) {
    if (!validCode(r) || isExcluded(r)) continue
    const classify = String(r?.Classify ?? '')
    const typeName = String(r?.SecurityTypeName ?? '')
    if (classify === 'AStock' || /^(沪A|深A|京A)$/.test(typeName) || /A股/.test(typeName)) {
      return { code: String(r.Code).trim(), name: String(r?.Name ?? '').trim() }
    }
  }

  // Pass 2: any non-excluded 6-digit code (handles responses without Classify).
  for (const r of candidates) {
    if (!validCode(r) || isExcluded(r)) continue
    return { code: String(r.Code).trim(), name: String(r?.Name ?? '').trim() }
  }

  return null
}

/** Resolve a code or name to {code, name}, or null if it can't be resolved. */
export async function resolveStock(query: string): Promise<StockMatch | null> {
  const q = (query ?? '').trim()
  if (!q) return null
  // 6-digit code → use directly; name filled later by fetchStockFundamentals.
  if (/^\d{6}$/.test(q)) return { code: q, name: '' }

  try {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(
      q,
    )}&type=14&count=8&token=D43BF722C8E33BDC906FB84D85E326E8`
    const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 5000 })
    if (!res.ok) return null
    const json = (await res.json()) as any
    return pickBestStockMatch(json?.QuotationCodeTable?.Data)
  } catch {
    return null
  }
}
