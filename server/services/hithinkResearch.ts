import { createHash } from 'node:crypto'
import { getHithinkProvider } from '../market-data/providers/ths/hithink'
import type { ThsRuntime } from '../market-data/providers/ths/runtime'
import type { HithinkClient } from '../market-data/hithinkFinanceClient'
import { validateHithinkStockPayload } from '../market-data/providers/ths/schemas'
import type { ThsResponseCapture } from '../market-data/providers/ths/evidence'

export const HITHINK_RESEARCH_DATASETS = ['anomaly', 'valuation', 'income', 'balance', 'cashflow'] as const
type Dataset = typeof HITHINK_RESEARCH_DATASETS[number]
type Row = Record<string, unknown>
const endpoints: Record<Dataset, string> = {
  anomaly: 'special-data/anomaly-analysis-stock', valuation: 'valuations/snapshot',
  income: 'financials/income-statements', balance: 'financials/balance-sheets', cashflow: 'financials/cash-flow-statements',
}

export class HithinkResearchInputError extends Error {}

export function normalizeResearchCode(input: string): string {
  const code = input.trim().toUpperCase()
  if (!/^\d{6}\.(SH|SZ|BJ)$/.test(code)) throw new HithinkResearchInputError('Use a complete A-share thscode, e.g. 600519.SH')
  return code
}

function object(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Preserve upstream field values, especially nulls, negative valuations and report dates.
export function createHithinkResearchService(
  client: HithinkClient,
  options: number | { gapMs?: number; runtime?: ThsRuntime; captureResponse?: (capture: ThsResponseCapture) => void } = 350,
) {
  const runtime = typeof options === 'number' ? undefined : options.runtime
  const gapMs = typeof options === 'number' ? options : options.gapMs ?? (runtime ? 0 : 350)
  const captureResponse = typeof options === 'number' ? undefined : options.captureResponse
  const cache = new Map<string, { expires: number; value: Awaited<ReturnType<typeof collect>> }>()
  const pending = new Map<string, Promise<Awaited<ReturnType<typeof collect>>>>()
  let busy = false

  async function collect(code: string) {
    const datasets = []
    for (const dataset of HITHINK_RESEARCH_DATASETS) {
      const base = { dataset, source: 'hithink-finance-api', sourceTier: 'research-only', eligibleAsTradeGate: false,
        coverage: null, asOf: null, warnings: ['Not validated for historical point-in-time use',
          dataset === 'valuation' ? 'Upstream timestamp is the newest metric timestamp, not a common valuation time' : 'Provider timestamp is not proof of original publication time'] }
      if (!client.isConfigured) {
        datasets.push({ ...base, status: 'unavailable', reason: 'not-configured', data: null })
        continue
      }
      try {
        const params = dataset === 'anomaly' || dataset === 'valuation'
          ? { thscodes: code } : { thscode: code, period: 'quarterly', limit: 4 }
        const response = await client.get(`/api/a-share/${endpoints[dataset]}`, params)
        captureResponse?.({
          adapter: 'stock-research', dataset, endpoint: `/api/a-share/${endpoints[dataset]}`, params,
          requestId: response.requestId, receivedAt: response.receivedAt, rawBytes: response.rawBytes,
        })
        const payload = response.data
        const items = object(payload) && Array.isArray(payload.item) ? payload.item : null
        const validation = validateHithinkStockPayload(dataset, payload, code)
        const valid = validation.ok
        const usable = response.ok && valid
        datasets.push({ ...base, status: !usable ? 'unavailable' : items?.length ? 'unverified' : 'empty',
          reason: !response.ok ? 'upstream-error' : !valid ? validation.reason ?? 'invalid-response-shape-or-code' : null,
          apiCode: response.code, requestId: response.requestId, receivedAt: response.receivedAt,
          providerTimestamp: object(payload) ? payload.timestamp ?? null : null,
          rawHash: createHash('sha256').update(response.rawText).digest('hex'),
          data: usable ? payload : null })
      } catch {
        datasets.push({ ...base, status: 'unavailable', reason: 'request-failed', data: null })
      }
      if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs))
    }
    return { thscode: code, status: 'research-only', eligibleAsTradeGate: false, collectedAt: new Date().toISOString(), datasets }
  }

  const getLocal = async (code: string) => {
    const cached = cache.get(code)
    if (cached && cached.expires > Date.now()) return cached.value
    const existing = pending.get(code)
    if (existing) return existing
    if (busy) throw new Error('research-busy')
    busy = true
    const task = collect(code)
    pending.set(code, task)
    try {
      const value = await task
      const oldest = cache.keys().next().value
      if (cache.size >= 100 && oldest !== undefined) cache.delete(oldest)
      cache.set(code, { value, expires: Date.now() + (value.datasets.some((row) => row.status === 'unavailable') ? 10_000 : 60_000) })
      return value
    } finally { pending.delete(code); busy = false }
  }

  return async (input: string) => {
    const code = normalizeResearchCode(input)
    if (!runtime) return getLocal(code)
    return runtime.memoize('hithink-research', code, () => collect(code), {
      ttlMs: (value) => value.datasets.some((row) => row.status === 'unavailable') ? 10_000 : 60_000,
    })
  }
}

let service: ReturnType<typeof createHithinkResearchService> | undefined
export function getHithinkResearch(code: string) {
  normalizeResearchCode(code)
  const provider = getHithinkProvider()
  service ??= createHithinkResearchService(provider.client, { runtime: provider.runtime })
  return service(code)
}
