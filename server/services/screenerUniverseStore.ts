import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCREENER_UNIVERSE_VERSION = 1

export interface StoredScreenerUniverse {
  version: number
  savedAt: string
  tradeDate: string
  expectedTotal: number
  validCount: number
  /** 唯一有效股票数 / 上游 total；旧格式缓存无法验证，标记 legacy 后归 0。 */
  coverage: number
  sources: string[]
  validatedAt: string
  /** 旧格式(缺 version/tradeDate/expectedTotal)缓存只能读，完成一次合格全量抓取前不能当正式 fallback。 */
  legacy: boolean
  rows: Record<string, unknown>[]
}

export interface PersistScreenerUniverseArgs {
  rows: Record<string, unknown>[]
  tradeDate: string
  expectedTotal: number
  sources: string[]
  validatedAt?: string
}

const DEFAULT_STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'screener-universe.json')

/** Runtime-resolved path so tests can point the store at a temp file. */
function storePath(): string {
  return process.env.SCREENER_UNIVERSE_STORE ?? DEFAULT_STORE_PATH
}

export function loadScreenerUniverse(): StoredScreenerUniverse | null {
  try {
    const raw = JSON.parse(readFileSync(storePath(), 'utf8')) as Partial<StoredScreenerUniverse> & {
      rows?: Record<string, unknown>[]
    }
    if (!raw || !Array.isArray(raw.rows) || raw.rows.length === 0 || typeof raw.savedAt !== 'string') {
      return null
    }
    const legacy =
      raw.version !== SCREENER_UNIVERSE_VERSION ||
      typeof raw.tradeDate !== 'string' ||
      typeof raw.expectedTotal !== 'number'
    return {
      version: legacy ? 0 : SCREENER_UNIVERSE_VERSION,
      savedAt: raw.savedAt,
      tradeDate: legacy ? 'legacy' : (raw.tradeDate as string),
      expectedTotal: legacy ? raw.rows.length : (raw.expectedTotal as number),
      validCount: legacy ? raw.rows.length : (raw.validCount ?? raw.rows.length),
      coverage: legacy ? 0 : (raw.coverage ?? 0),
      sources: legacy ? [] : (raw.sources ?? []),
      validatedAt: legacy ? raw.savedAt : (raw.validatedAt ?? raw.savedAt),
      legacy,
      rows: raw.rows,
    }
  } catch {
    return null
  }
}

/**
 * Full-market quote pool cache with a verified completeness watermark.
 * Only a candidate whose coverage does NOT drop below the stored last-good may
 * replace it; a partial/duplicated crawl can never degrade the fallback pool.
 * Returns true when the store was replaced.
 */
export function persistScreenerUniverse(args: PersistScreenerUniverseArgs): boolean {
  if (!args.rows.length || !Number.isFinite(args.expectedTotal) || args.expectedTotal <= 0) {
    return false
  }
  const uniqueByCode = new Map<string, Record<string, unknown>>()
  for (const row of args.rows) {
    const code = String(row.f12 ?? '').trim()
    if (/^\d{6}$/.test(code) && !uniqueByCode.has(code)) uniqueByCode.set(code, row)
  }
  if (uniqueByCode.size === 0) return false
  const validCount = [...uniqueByCode].filter(
    ([, row]) => Number(row.f2) > 0 && String(row.f14 ?? '').trim().length > 0,
  ).length
  const coverage = validCount / args.expectedTotal

  const existing = loadScreenerUniverse()
  if (existing && !existing.legacy && Math.round(existing.coverage * 1e4) > Math.round(coverage * 1e4)) {
    return false
  }

  mkdirSync(dirname(storePath()), { recursive: true })
  const tmp = `${storePath()}.${process.pid}.tmp`
  const clean = args.rows.map(({ __clistHost: _host, __quoteSource: _source, __expectedActive: _active, ...row }) => row)
  const now = args.validatedAt ?? new Date().toISOString()
  writeFileSync(
    tmp,
    JSON.stringify(
      {
        version: SCREENER_UNIVERSE_VERSION,
        savedAt: now,
        tradeDate: args.tradeDate,
        expectedTotal: args.expectedTotal,
        validCount,
        coverage,
        sources: args.sources,
        validatedAt: now,
        rows: clean,
      },
      null,
      2,
    ),
    'utf8',
  )
  renameSync(tmp, storePath())
  return true
}