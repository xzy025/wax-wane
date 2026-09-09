import { createHash } from 'node:crypto'
import { dateToShanghaiMs, type HithinkClient, type HithinkParams } from '../market-data/hithinkFinanceClient'
import { getHithinkProvider } from '../market-data/providers/ths/hithink'
import type { ThsRuntime } from '../market-data/providers/ths/runtime'
import type { ThsResponseCapture } from '../market-data/providers/ths/evidence'
import { HithinkResearchInputError } from './hithinkResearch'

type RecordData = Record<string, unknown>
function record(value: unknown): value is RecordData {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export type MarketResearchRequest =
  | { dataset: 'hotlist'; period: 'day' | 'hour' }
  | { dataset: 'boards'; tag: 'cn_concept' | 'industry' | 'region' | 'tszs' }
  | { dataset: 'constituents'; thscode: string }
  | { dataset: 'limit-up-pool'; date: string }

export function parseMarketResearchRequest(query: Record<string, unknown>): MarketResearchRequest {
  const { dataset } = query
  const parameter = dataset === 'hotlist' ? 'period' : dataset === 'boards' ? 'tag' : dataset === 'constituents' ? 'thscode' : dataset === 'limit-up-pool' ? 'date' : null
  if (!parameter || Object.keys(query).some((key) => key !== 'dataset' && key !== parameter)) throw new HithinkResearchInputError('Unsupported research dataset or parameter')
  if (dataset === 'hotlist' && (query.period === 'day' || query.period === 'hour')) return { dataset, period: query.period }
  if (dataset === 'boards' && ['cn_concept', 'industry', 'region', 'tszs'].includes(String(query.tag)) && typeof query.tag === 'string') return { dataset, tag: query.tag as 'cn_concept' | 'industry' | 'region' | 'tszs' }
  if (dataset === 'constituents' && typeof query.thscode === 'string' && /^\d{6}\.(TI|SH|SZ)$/.test(query.thscode)) return { dataset, thscode: query.thscode }
  if (dataset === 'limit-up-pool' && typeof query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
    const parsed = new Date(`${query.date}T00:00:00Z`)
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === query.date) return { dataset, date: query.date }
  }
  throw new HithinkResearchInputError('Missing or invalid research parameter')
}

export function createHithinkMarketResearch(
  client: HithinkClient,
  options: number | { gapMs?: number; runtime?: ThsRuntime; captureResponse?: (capture: ThsResponseCapture) => void } = 350,
) {
  const runtime = typeof options === 'number' ? undefined : options.runtime
  const gapMs = typeof options === 'number' ? options : options.gapMs ?? (runtime ? 0 : 350)
  const captureResponse = typeof options === 'number' ? undefined : options.captureResponse
  const cache = new Map<string, { until: number; result: Awaited<ReturnType<typeof collect>> }>()
  const pending = new Map<string, Promise<Awaited<ReturnType<typeof collect>>>>()
  let busy = false
  async function collect(request: MarketResearchRequest) {
    const base = { ...request, source: 'hithink-finance-api', sourceTier: 'research-only', eligibleAsTradeGate: false,
      asOf: null, coverage: null, historicalEligibilityVerified: false,
      warnings: ['Current membership and rolling hotlists are not historical snapshots', 'Complete pagination is not independent market coverage verification'] }
    const captures: Array<{ requestId: string | null; receivedAt: string; rawHash: string; apiCode: number | string | null; providerTimestamp: unknown }> = []
    const rows: RecordData[] = []
    const seen = new Set<string>()
    let total: number | undefined
    let pages: number | undefined
    if (!client.isConfigured) return { ...base, status: 'unavailable', reason: 'not-configured', data: null, captures }
    try {
      for (let page = 1; page <= 30; page++) {
        let endpoint: string
        let params: HithinkParams
        switch (request.dataset) {
          case 'hotlist': endpoint = '/api/a-share/special-data/hot-stock-list'; params = { period: request.period }; break
          case 'boards': endpoint = '/api/a-share-index/catalog/ths-index-list'; params = { tag: request.tag }; break
          case 'constituents': endpoint = '/api/a-share-index/constituents/ths-stock-list'; params = { thscode: request.thscode }; break
          case 'limit-up-pool': endpoint = '/api/a-share/special-data/limit-up-pool'; params = { date_ms: dateToShanghaiMs(request.date), page, size: 200 }; break
        }
        const response = await client.get(endpoint, params)
        captureResponse?.({
          adapter: 'market-research', dataset: request.dataset, endpoint, params,
          requestId: response.requestId, receivedAt: response.receivedAt, rawBytes: response.rawBytes,
        })
        const payload = response.data
        captures.push({ requestId: response.requestId, receivedAt: response.receivedAt, apiCode: response.code,
          rawHash: createHash('sha256').update(response.rawText).digest('hex'), providerTimestamp: record(payload) ? payload.timestamp ?? null : null })
        if (!response.ok) throw new Error('upstream-error')
        if (!record(payload) || !Array.isArray(payload.item)) throw new Error('invalid-response')
        for (const item of payload.item) {
          const codePattern = request.dataset === 'boards' ? /^\d{6}\.(TI|SH|SZ)$/ : /^\d{6}\.(SH|SZ|BJ)$/
          if (!record(item) || typeof item.thscode !== 'string' || !codePattern.test(item.thscode) || typeof item.name !== 'string' || seen.has(item.thscode)) throw new Error('invalid-or-duplicate-row')
          if (request.dataset === 'hotlist' && (!Number.isInteger(item.rank) || Number(item.rank) < 1)) throw new Error('invalid-rank')
          seen.add(item.thscode)
          rows.push(item)
        }
        if (request.dataset !== 'limit-up-pool') return { ...base, status: rows.length ? 'unverified' : 'empty', reason: null, data: { item: rows }, paginationComplete: null, captures }
        const p = payload.pagination
        if (!record(p) || !Number.isInteger(p.total) || Number(p.total) < 0 || !Number.isInteger(p.pages) || Number(p.pages) < 0 || Number(p.pages) > 30 || p.page !== page || p.size !== 200) throw new Error('invalid-pagination')
        if (Number(p.pages) !== Math.ceil(Number(p.total) / 200) && !(p.total === 0 && p.pages === 1)) throw new Error('inconsistent-pagination')
        if (total !== undefined && (p.total !== total || p.pages !== pages)) throw new Error('pagination-changed')
        total = Number(p.total); pages = Number(p.pages)
        if (payload.item.length !== Math.min(200, Math.max(0, total - (page - 1) * 200))) throw new Error('incomplete-page')
        if (page >= pages) {
          if (rows.length !== total) throw new Error('incomplete-pagination')
          return { ...base, status: rows.length ? 'unverified' : 'empty', reason: null, data: { item: rows }, paginationComplete: true, captures }
        }
        if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs))
      }
      throw new Error('page-limit')
    } catch {
      // Do not expose raw upstream messages or quietly serve a truncated pool.
      return { ...base, status: 'unavailable', reason: 'request-or-validation-failed', data: null, paginationComplete: false, captures }
    }
  }
  const getLocal = async (request: MarketResearchRequest) => {
    const key = JSON.stringify(request)
    const saved = cache.get(key)
    if (saved && saved.until > Date.now()) return saved.result
    const active = pending.get(key)
    if (active) return active
    if (busy) throw new Error('research-busy')
    busy = true
    const task = collect(request)
    pending.set(key, task)
    try {
      const result = await task
      const oldest = cache.keys().next().value
      if (cache.size >= 100 && oldest !== undefined) cache.delete(oldest)
      cache.set(key, { result, until: Date.now() + (result.status === 'unavailable' ? 10_000 : 60_000) })
      return result
    } finally { busy = false; pending.delete(key) }
  }

  return async (input: Record<string, unknown>) => {
    const request = parseMarketResearchRequest(input)
    if (!runtime) return getLocal(request)
    return runtime.memoize('hithink-market-research', JSON.stringify(request), () => collect(request), {
      ttlMs: (value) => value.status === 'unavailable' ? 10_000 : 60_000,
    })
  }
}

let service: ReturnType<typeof createHithinkMarketResearch> | undefined
export function getHithinkMarketResearch(query: Record<string, unknown>) {
  parseMarketResearchRequest(query)
  const provider = getHithinkProvider()
  service ??= createHithinkMarketResearch(provider.client, { runtime: provider.runtime })
  return service(query)
}
