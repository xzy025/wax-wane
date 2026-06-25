// Pure helpers for reading the per-day screener snapshots back out of
// docs/screener/. Zero IO — screener.ts does the fs work. Mirrors the
// parse-regex + lexicographic-max pattern of routes/fundamentalArchive.ts.
//
// Trap: docs/screener/ also holds backtest-YYYY-MM-DD.json and dot-prefixed
// scratch caches (.bars-*, .lhb-*, .stock-boards-*, .board-closes-*). The
// strict ^YYYY-MM-DD.json$ regex is what keeps those out of the latest pick.
import type { ScreenerResult } from './screener'

export interface ScreenerArchiveRef {
  filename: string
  /** YYYY-MM-DD, taken from the filename (Asia/Shanghai date at archive time) */
  date: string
}

const SCREENER_DATE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/

/** Parse a `YYYY-MM-DD.json` snapshot filename; anything else → null. */
export function parseScreenerArchiveName(filename: string): ScreenerArchiveRef | null {
  const m = SCREENER_DATE_RE.exec(filename)
  if (!m) return null
  return { filename, date: m[1] }
}

/** Pick the newest snapshot from a directory listing (order-independent). */
export function pickLatestArchiveName(filenames: string[]): ScreenerArchiveRef | null {
  let latest: ScreenerArchiveRef | null = null
  for (const filename of filenames) {
    const ref = parseScreenerArchiveName(filename)
    if (!ref) continue
    // ISO dates sort lexicographically in chronological order.
    if (!latest || ref.date > latest.date) latest = ref
  }
  return latest
}

/** Minimal shape guard so a corrupt/foreign JSON can't be served as a result. */
export function isScreenerResult(v: unknown): v is ScreenerResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.asof === 'string' &&
    Array.isArray(r.breakout) &&
    Array.isArray(r.trigger) &&
    Array.isArray(r.pullback)
  )
}
