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

/** 同日快照择优:新扫描结果是否允许覆盖已存档的同日快照。
 *  防「部分降级覆盖」:scanHealthy 只拦全挂(取K ≥60% 即算健康),一次 89% 覆盖率的扫描
 *  会静默覆盖早前 97% 的优质快照(2026-07-06 实发,隆达/海鸥/申联生物一度从榜单丢失)。
 *  规则(优先级从高到低):
 *   1. 无旧档 / 旧档非同日(防御,按日存不应发生)→ 写
 *   2. 盘后档(closed)优先于盘中档——收盘定盘数据是终态
 *   3. 同盘态按取K成功数(fetched)不倒退;旧档缺 fetched(本字段引入前的旧版)→ 允许覆盖
 *      (无从比较;新档带上 fetched 后即受保护),新档缺 fetched(异常)→ 保旧。
 *  已知可接受边界:开盘前扫描会存成 closed=true,同日盘中(closed=false)不覆盖它——
 *  实际不发生(盘前命中前一晚的 12h 缓存,不触发重扫)。 */
export function shouldReplaceArchive(prev: ScreenerResult | null, next: ScreenerResult): boolean {
  if (!prev || prev.asof !== next.asof) return true
  const prevClosed = prev.closed === true
  const nextClosed = next.closed === true
  if (nextClosed !== prevClosed) return nextClosed
  if (typeof prev.fetched !== 'number') return true
  if (typeof next.fetched !== 'number') return false
  return next.fetched >= prev.fetched
}
