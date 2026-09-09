import { createHash } from 'node:crypto'

export const HITHINK_DEFAULT_BASE_URL = 'https://fuyao.aicubes.cn'
export const HITHINK_DEFAULT_TIMEOUT_MS = 12_000
export const HITHINK_DEFAULT_REQUEST_GAP_MS = 350
export const HITHINK_DEFAULT_MAX_RETRIES = 3

export type HithinkProbeStatus =
  | 'available'
  | 'permission-denied'
  | 'not-ready'
  | 'rate-limited'
  | 'unsupported'
  | 'empty'
  | 'error'
  | 'not-configured'

export type HithinkCapability =
  | 'historical-daily'
  | 'corporate-actions'
  | 'realtime-snapshot'
  | 'auction-live'
  | 'auction-final'
  | 'limit-up-pool'
  | 'limit-up-ladder'
  | 'dragon-tiger-list'
  | 'index-catalog'
  | 'index-constituents'
  | 'index-snapshot'
  | 'index-historical-daily'
  | 'market-dump-daily'
  | 'market-dump-daily-10d'
  | 'market-dump-adjustment-factors'

export type HithinkParams = Record<string, string | number | boolean | null | undefined>
export type HithinkFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface HithinkHistoricalItem {
  date_ms: number
  open_price: number
  high_price: number
  low_price: number
  close_price: number
  volume: number
  turnover: number
}

export interface HithinkHistoricalData {
  timestamp?: number | null
  item?: HithinkHistoricalItem[]
  adjust?: string | null
}

export interface HithinkResponse<T = unknown> {
  httpStatus: number
  ok: boolean
  code: number | string | null
  message: string | null
  requestId: string | null
  data: T | null
  body: unknown
  rawText: string
  rawBytes: Uint8Array
  jsonParsed: boolean
  attempts: number
  durationMs: number
  receivedAt: string
}

export interface HithinkConfig {
  baseUrl: string
  apiKey?: string
  codes: string[]
  indexCode: string
  tradeDate?: string
  startDate: string
  endDate: string
  timeoutMs: number
  requestGapMs: number
  maxRetries: number
}

export interface HithinkClient {
  readonly isConfigured: boolean
  get<T = unknown>(endpoint: string, params?: HithinkParams): Promise<HithinkResponse<T>>
}

export interface HithinkProbeRequest {
  id: string
  capability: HithinkCapability
  endpoint: string
  params: HithinkParams
  note?: string
  skipReason?: string
}

export interface HithinkProbeResult {
  id: string
  capability: HithinkCapability
  endpoint: string
  source: 'hithink-finance-api'
  sourceTier: 'shadow'
  status: HithinkProbeStatus
  startedAt: string
  finishedAt: string
  durationMs: number
  attempts: number
  httpStatus?: number
  apiCode?: number | string | null
  requestId?: string | null
  responseShape?: string
  fields: string[]
  sample?: unknown
  note?: string
}

export interface HithinkCapabilityMatrix {
  generatedAt: string
  source: 'hithink-finance-api'
  sourceTier: 'shadow'
  eligibleAsTradeGate: false
  configured: boolean
  codes: string[]
  tradeDate?: string
  results: HithinkProbeResult[]
  notes: string[]
}

export interface ComparableDailyBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  turnover?: number | null
}

export interface HithinkDailyParityReport {
  adjustment: 'none' | 'forward' | 'backward' | 'unknown'
  hithinkCount: number
  peerCount: number
  comparedCount: number
  missingInHithink: string[]
  missingInPeer: string[]
  mismatchCounts: Record<'open' | 'high' | 'low' | 'close' | 'volume' | 'turnover', number>
  mismatchSamples: Array<{ date: string; fields: string[] }>
  volumeUnit: 'shares' | 'unknown'
  turnoverUnit: 'currency' | 'unknown'
  pass: boolean
}

export class HithinkConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HithinkConfigurationError'
  }
}

export class HithinkRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HithinkRequestError'
  }
}

function optionalEnv(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[name]?.trim()
  return value || undefined
}

function parseNonNegativeInt(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HithinkConfigurationError(`${name} must be a non-negative integer`)
  }
  return parsed
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HithinkConfigurationError(`${name} must be a positive integer`)
  }
  return parsed
}

function parseCsv(value: string | undefined): string[] {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []
}

export function validateStockCodes(codes: string[]): string[] {
  const normalized = [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))]
  if (normalized.length === 0) throw new HithinkConfigurationError('HITHINK_FINANCE_CODES must contain at least one symbol')
  for (const code of normalized) {
    if (!/^\d{6}\.(SH|SZ|BJ)$/.test(code)) {
      throw new HithinkConfigurationError(`Invalid Hithink stock code: ${code}; use e.g. 600519.SH`)
    }
  }
  return normalized
}

export function validateDate(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HithinkConfigurationError(`${name} must use YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (parsed.toISOString().slice(0, 10) !== value) throw new HithinkConfigurationError(`${name} is not a valid date`)
  return value
}

function todayShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
}

function defaultStartDate(endDate: string): string {
  const end = new Date(`${endDate}T00:00:00.000Z`)
  end.setUTCFullYear(end.getUTCFullYear() - 1)
  return end.toISOString().slice(0, 10)
}

function normalizeBaseUrl(value: string | undefined): string {
  const candidate = value ?? HITHINK_DEFAULT_BASE_URL
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new HithinkConfigurationError(`Invalid HITHINK_FINANCE_BASE_URL: ${candidate}`)
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    throw new HithinkConfigurationError('HITHINK_FINANCE_BASE_URL must use HTTPS, except for localhost tests')
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
}

function validateIndexCode(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (!/^\d{6}\.(TI|SH|SZ)$/.test(normalized)) {
    throw new HithinkConfigurationError(`Invalid HITHINK_FINANCE_INDEX_CODE: ${value}`)
  }
  return normalized
}

export function readHithinkConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HithinkConfig {
  const endDate = validateDate(optionalEnv('HITHINK_FINANCE_END_DATE', env), 'HITHINK_FINANCE_END_DATE') ?? todayShanghai()
  const startDate = validateDate(optionalEnv('HITHINK_FINANCE_START_DATE', env), 'HITHINK_FINANCE_START_DATE') ?? defaultStartDate(endDate)
  if (startDate > endDate) throw new HithinkConfigurationError('HITHINK_FINANCE_START_DATE must not be after HITHINK_FINANCE_END_DATE')
  return {
    baseUrl: normalizeBaseUrl(optionalEnv('HITHINK_FINANCE_BASE_URL', env)),
    apiKey: optionalEnv('HITHINK_FINANCE_API_KEY', env),
    codes: validateStockCodes(parseCsv(optionalEnv('HITHINK_FINANCE_CODES', env)).length
      ? parseCsv(optionalEnv('HITHINK_FINANCE_CODES', env))
      : ['000001.SZ', '600519.SH']),
    indexCode: validateIndexCode(optionalEnv('HITHINK_FINANCE_INDEX_CODE', env) ?? '886042.TI'),
    tradeDate: validateDate(optionalEnv('HITHINK_FINANCE_TRADE_DATE', env), 'HITHINK_FINANCE_TRADE_DATE'),
    startDate,
    endDate,
    timeoutMs: parsePositiveInt(optionalEnv('HITHINK_FINANCE_TIMEOUT_MS', env), HITHINK_DEFAULT_TIMEOUT_MS, 'HITHINK_FINANCE_TIMEOUT_MS'),
    requestGapMs: parseNonNegativeInt(optionalEnv('HITHINK_FINANCE_REQUEST_GAP_MS', env), HITHINK_DEFAULT_REQUEST_GAP_MS, 'HITHINK_FINANCE_REQUEST_GAP_MS'),
    maxRetries: parseNonNegativeInt(optionalEnv('HITHINK_FINANCE_MAX_RETRIES', env), HITHINK_DEFAULT_MAX_RETRIES, 'HITHINK_FINANCE_MAX_RETRIES'),
  }
}

export function dateToShanghaiMs(date: string): number {
  validateDate(date, 'date')
  return Date.parse(`${date}T00:00:00.000+08:00`)
}

function buildUrl(baseUrl: string, endpoint: string, params: HithinkParams): string {
  if (!endpoint || endpoint.includes('://') || endpoint.includes('?')) {
    throw new HithinkConfigurationError(`Invalid Hithink endpoint: ${endpoint}`)
  }
  const url = new URL(`${baseUrl}/${endpoint.replace(/^\/+/, '')}`)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function createAbortSignal(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}

async function parseResponse(response: Response): Promise<{ body: unknown; rawText: string; rawBytes: Uint8Array; jsonParsed: boolean }> {
  const rawBytes = typeof response.arrayBuffer === 'function'
    ? new Uint8Array(await response.arrayBuffer())
    : new TextEncoder().encode(await response.text())
  const rawText = new TextDecoder().decode(rawBytes)
  if (!rawText.trim()) return { body: undefined, rawText, rawBytes, jsonParsed: true }
  try {
    return { body: JSON.parse(rawText) as unknown, rawText, rawBytes, jsonParsed: true }
  } catch {
    return { body: rawText, rawText, rawBytes, jsonParsed: false }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function codeOf(body: unknown): number | string | null {
  if (!isRecord(body)) return null
  const code = body.code
  return typeof code === 'number' || typeof code === 'string' ? code : null
}

function messageOf(body: unknown): string | null {
  if (typeof body === 'string') return body.slice(0, 500)
  if (!isRecord(body)) return null
  const message = body.message ?? body.msg ?? body.error
  return typeof message === 'string' ? message.slice(0, 500) : null
}

function requestIdOf(body: unknown): string | null {
  if (!isRecord(body)) return null
  const value = body.request_id ?? body.requestId
  return typeof value === 'string' ? value : null
}

function dataOf<T>(body: unknown): T | null {
  if (!isRecord(body) || !('data' in body)) return null
  return (body.data ?? null) as T | null
}

function numericCode(code: number | string | null): number | null {
  if (typeof code === 'number') return code
  if (typeof code === 'string' && /^-?\d+$/.test(code)) return Number(code)
  return null
}

function shouldRetry(httpStatus: number, code: number | string | null): boolean {
  const apiCode = numericCode(code)
  return httpStatus === 408 || httpStatus === 429 || httpStatus >= 500
    || apiCode === 4001 || apiCode === 5001 || apiCode === 5002 || apiCode === 5003
}

function backoffMs(attempt: number): number {
  return Math.min(2_000, 250 * 2 ** Math.max(0, attempt - 1))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createHithinkFinanceClient(options: {
  baseUrl?: string
  apiKey?: string
  timeoutMs?: number
  requestGapMs?: number
  maxRetries?: number
  fetchImpl?: HithinkFetch
  sleepImpl?: (ms: number) => Promise<void>
  /** Called before every outbound attempt. The shared provider runtime uses this for global pacing. */
  beforeAttempt?: () => Promise<void>
  now?: () => Date
} = {}): HithinkClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const apiKey = options.apiKey?.trim() || undefined
  const timeoutMs = options.timeoutMs ?? HITHINK_DEFAULT_TIMEOUT_MS
  const requestGapMs = options.requestGapMs ?? 0
  const maxRetries = options.maxRetries ?? HITHINK_DEFAULT_MAX_RETRIES
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) throw new HithinkConfigurationError('maxRetries must be 0..3')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new HithinkConfigurationError('timeoutMs must be positive')
  if (!Number.isInteger(requestGapMs) || requestGapMs < 0) throw new HithinkConfigurationError('requestGapMs must be a non-negative integer')
  const fetchImpl = options.fetchImpl ?? fetch
  const sleepImpl = options.sleepImpl ?? sleep
  const beforeAttempt = options.beforeAttempt
  const now = options.now ?? (() => new Date())

  const get = async <T = unknown>(endpoint: string, params: HithinkParams = {}): Promise<HithinkResponse<T>> => {
    if (!apiKey) throw new HithinkConfigurationError('Missing HITHINK_FINANCE_API_KEY')
    const url = buildUrl(baseUrl, endpoint, params)
    const startedMs = Date.now()
    let lastError: unknown
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      if (beforeAttempt) await beforeAttempt()
      else if (requestGapMs > 0) await sleepImpl(requestGapMs)
      const abort = createAbortSignal(timeoutMs)
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          redirect: 'error',
          headers: { Accept: 'application/json', 'X-api-key': apiKey },
          signal: abort.signal,
        })
        const parsed = await parseResponse(response)
        const code = codeOf(parsed.body)
        if (attempt <= maxRetries && shouldRetry(response.status, code)) {
          await sleepImpl(backoffMs(attempt))
          continue
        }
        return {
          httpStatus: response.status,
          ok: response.status === 200 && code === 0,
          code,
          message: messageOf(parsed.body),
          requestId: requestIdOf(parsed.body),
          data: dataOf<T>(parsed.body),
          body: parsed.body,
          rawText: parsed.rawText,
          rawBytes: parsed.rawBytes,
          jsonParsed: parsed.jsonParsed,
          attempts: attempt,
          durationMs: Math.max(0, Date.now() - startedMs),
          receivedAt: now().toISOString(),
        }
      } catch (error) {
        lastError = error
        if (attempt > maxRetries) break
        await sleepImpl(backoffMs(attempt))
      } finally {
        abort.dispose()
      }
    }
    void lastError
    throw new HithinkRequestError('Hithink request failed after bounded retries (network/timeout)')
  }

  return { isConfigured: Boolean(apiKey), get }
}

function codesParam(codes: string[]): string {
  return validateStockCodes(codes).join(',')
}

export function buildHithinkProbeRequests(config: HithinkConfig): HithinkProbeRequest[] {
  const codes = validateStockCodes(config.codes)
  const tradeDateMs = dateToShanghaiMs(config.tradeDate ?? config.endDate)
  const primaryCode = codes[0]
  const params = { thscode: primaryCode, interval: '1d', start: dateToShanghaiMs(config.startDate), end: dateToShanghaiMs(config.endDate) }
  return [
    {
      id: 'historical-daily-forward',
      capability: 'historical-daily',
      endpoint: '/api/a-share/prices/historical',
      params: { ...params, adjust: 'forward' },
      note: 'One-stock daily K; forward adjustment is the first parity candidate.',
    },
    {
      id: 'historical-daily-raw',
      capability: 'historical-daily',
      endpoint: '/api/a-share/prices/historical',
      params: { ...params, adjust: 'none' },
      note: 'Raw daily K; keep as the immutable research substrate.',
    },
    {
      id: 'corporate-actions-adjustment-factors',
      capability: 'corporate-actions',
      endpoint: '/api/a-share/corporate-actions/adjustment-factors',
      params: { thscode: primaryCode },
      note: 'Raw corporate-action event stream; do not infer point-in-time adjustment from a current qfq series alone.',
    },
    {
      id: 'realtime-snapshot',
      capability: 'realtime-snapshot',
      endpoint: '/api/a-share/prices/snapshot',
      params: { thscodes: codesParam(codes) },
      note: 'Explicit batch snapshot; never omit thscodes during an authentication probe.',
    },
    {
      id: 'auction-live',
      capability: 'auction-live',
      endpoint: '/api/a-share/auction/snapshot',
      params: { thscodes: codesParam(codes), stage: 'live' },
      note: 'Live auction state; response timestamp is assembly time, not event time.',
    },
    {
      id: 'auction-final',
      capability: 'auction-final',
      endpoint: '/api/a-share/auction/snapshot',
      params: { thscodes: codesParam(codes), stage: 'final' },
      note: 'Final auction state; validate 09:15/09:20/09:25/09:30/09:35/10:00/10:30 separately.',
    },
    {
      id: 'limit-up-pool',
      capability: 'limit-up-pool',
      endpoint: '/api/a-share/special-data/limit-up-pool',
      params: { date_ms: tradeDateMs, page: 1, size: 100, sort_field: 'limit_up_time', sort_dir: 'asc' },
      note: 'Fact pool candidate for first-board and limit-up research.',
    },
    {
      id: 'limit-up-ladder',
      capability: 'limit-up-ladder',
      endpoint: '/api/a-share/special-data/limit-up-ladder',
      params: {},
      note: 'Fixed recent 30-trading-day matrix; not a full custom ladder replacement.',
    },
    {
      id: 'dragon-tiger-list',
      capability: 'dragon-tiger-list',
      endpoint: '/api/a-share/special-data/dragon-tiger-list',
      params: { board_type: 'all', date: config.tradeDate ?? config.endDate },
      note: 'Institutional/hot-money fact data candidate.',
    },
    {
      id: 'index-catalog-concept',
      capability: 'index-catalog',
      endpoint: '/api/a-share-index/catalog/ths-index-list',
      params: { tag: 'cn_concept' },
      note: 'Current THS concept catalog; large response should be archived, not printed.',
    },
    {
      id: 'index-constituents',
      capability: 'index-constituents',
      endpoint: '/api/a-share-index/constituents/ths-stock-list',
      params: { thscode: config.indexCode },
      note: 'Current constituents only; not historical point-in-time membership.',
    },
    {
      id: 'index-snapshot',
      capability: 'index-snapshot',
      endpoint: '/api/a-share-index/prices/snapshot',
      params: { thscodes: config.indexCode },
      note: 'Current board/index snapshot for regime and sector cross-check.',
    },
    {
      id: 'index-historical-daily',
      capability: 'index-historical-daily',
      endpoint: '/api/a-share-index/prices/historical',
      params: { thscode: config.indexCode, interval: '1d', start: dateToShanghaiMs(config.startDate), end: dateToShanghaiMs(config.endDate) },
      note: 'Index/board daily K; no adjustment parameter.',
    },
    {
      id: 'market-dump-daily',
      capability: 'market-dump-daily',
      endpoint: '/api/dump/market-dumps/daily-k/download-url',
      params: {},
      note: 'Signed URL probe only; this script never downloads or logs the URL.',
    },
    {
      id: 'market-dump-daily-10d',
      capability: 'market-dump-daily-10d',
      endpoint: '/api/dump/market-dumps/daily-k-10d/download-url',
      params: {},
      note: 'Recent incremental dump signed URL probe.',
    },
    {
      id: 'market-dump-adjustment-factors',
      capability: 'market-dump-adjustment-factors',
      endpoint: '/api/dump/market-dumps/adjustment-factors/download-url',
      params: {},
      note: 'Full-market adjustment-event dump signed URL probe.',
    },
  ]
}

function classifyProbeStatus(response: HithinkResponse): HithinkProbeStatus {
  const code = numericCode(response.code)
  if (response.httpStatus === 401 || response.httpStatus === 403 || code === 2001 || code === 2002 || code === 2003 || code === 2004) return 'permission-denied'
  if (response.httpStatus === 429 || code === 4001) return 'rate-limited'
  if (code === 3002 || code === 4040) return 'not-ready'
  if (response.httpStatus === 404 || code === 3004) return 'unsupported'
  if (!response.jsonParsed || !response.ok || response.code !== 0) return 'error'
  if (response.data == null) return 'error'
  if (isRecord(response.data) && response.data.data_status === 'not_ready') return 'not-ready'
  if (isEmptyData(response.data)) return 'empty'
  return 'available'
}

function isEmptyData(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0
  if (!isRecord(data)) return false
  const lists = ['item', 'items', 'stock_items', 'hot_money_items'].map((key) => data[key]).filter(Array.isArray)
  return lists.length > 0 && lists.every((items) => items.length === 0)
}

function responseShape(value: unknown, depth = 0): string {
  if (depth > 2) return '…'
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `array[${value.length}]${value.length ? `<${responseShape(value[0], depth + 1)}>` : ''}`
  if (isRecord(value)) {
    const keys = Object.keys(value).slice(0, 12)
    return `{${keys.map((key) => `${key}:${responseShape(value[key], depth + 1)}`).join(', ')}}`
  }
  return typeof value
}

function redactUrls(value: unknown): unknown {
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? '[REDACTED_URL]' : value.slice(0, 300)
  if (Array.isArray(value)) return value.slice(0, 2).map(redactUrls)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).slice(0, 12).map(([key, item]) => [key, redactUrls(item)]))
  return value
}

function notConfiguredResult(request: HithinkProbeRequest, now: () => Date): HithinkProbeResult {
  const timestamp = now().toISOString()
  return {
    id: request.id,
    capability: request.capability,
    endpoint: request.endpoint,
    source: 'hithink-finance-api',
    sourceTier: 'shadow',
    status: 'not-configured',
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: 0,
    attempts: 0,
    fields: [],
    note: request.skipReason ?? 'No HITHINK_FINANCE_API_KEY was configured; network was not called.',
  }
}

function fieldNames(data: unknown): string[] {
  const first = Array.isArray(data) ? data[0] : isRecord(data) && Array.isArray(data.item) ? data.item[0] : data
  return isRecord(first) ? Object.keys(first).slice(0, 30) : []
}

export async function probeHithinkCapabilities(options: {
  config?: HithinkConfig
  fetchImpl?: HithinkFetch
  sleepImpl?: (ms: number) => Promise<void>
  now?: () => Date
} = {}): Promise<HithinkCapabilityMatrix> {
  const config = options.config ?? readHithinkConfigFromEnv()
  const now = options.now ?? (() => new Date())
  const requests = buildHithinkProbeRequests(config)
  const client = createHithinkFinanceClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    now,
  })
  const results: HithinkProbeResult[] = []

  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index]
    if (!client.isConfigured) {
      results.push(notConfiguredResult(request, now))
      continue
    }
    if (index > 0 && config.requestGapMs > 0) await (options.sleepImpl ?? sleep)(config.requestGapMs)
    const startedAt = now().toISOString()
    try {
      const response = await client.get(request.endpoint, request.params)
      const finishedAt = now().toISOString()
      results.push({
        id: request.id,
        capability: request.capability,
        endpoint: request.endpoint,
        source: 'hithink-finance-api',
        sourceTier: 'shadow',
        status: classifyProbeStatus(response),
        startedAt,
        finishedAt,
        durationMs: response.durationMs,
        attempts: response.attempts,
        httpStatus: response.httpStatus,
        apiCode: response.code,
        requestId: response.requestId,
        responseShape: responseShape(response.data),
        fields: fieldNames(response.data),
        sample: redactUrls(JSON.parse(JSON.stringify(response.data).split(config.apiKey!).join('[REDACTED]'))),
        note: request.note,
      })
    } catch (error) {
      const finishedAt = now().toISOString()
      results.push({
        id: request.id,
        capability: request.capability,
        endpoint: request.endpoint,
        source: 'hithink-finance-api',
        sourceTier: 'shadow',
        status: 'error',
        startedAt,
        finishedAt,
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
        attempts: config.maxRetries + 1,
        fields: [],
        note: `${request.note ?? ''} ${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)}`.trim(),
      })
    }
  }

  return {
    generatedAt: now().toISOString(),
    source: 'hithink-finance-api',
    sourceTier: 'shadow',
    eligibleAsTradeGate: false,
    configured: client.isConfigured,
    codes: config.codes,
    tradeDate: config.tradeDate,
    results,
    notes: [
      'Research-only capability probe; it never changes screener qualification, scoring, ranking, fills, position sizing, or risk gates.',
      'API success requires HTTP 200 and code=0. Missing data is not converted to zero or a simulated observation.',
      'The response timestamp is not copied into historical bar providerAt; historical PIT status requires separate evidence.',
      'Market Dump signed URLs are intentionally redacted and are not downloaded by this probe.',
      'The public contract does not establish a universal quota or SLA; measure the configured key with repeated probes before promotion.',
    ],
  }
}

export function normalizeHithinkDailyBars(data: unknown): ComparableDailyBar[] {
  if (!isRecord(data) || !Array.isArray(data.item)) return []
  return data.item.flatMap((item) => {
    if (!isRecord(item) || typeof item.date_ms !== 'number') return []
    const values = ['open_price', 'high_price', 'low_price', 'close_price', 'volume', 'turnover'].map((key) => item[key])
    if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return []
    return [{
      date: new Date(item.date_ms + 8 * 3600_000).toISOString().slice(0, 10),
      open: item.open_price as number,
      high: item.high_price as number,
      low: item.low_price as number,
      close: item.close_price as number,
      volume: item.volume as number,
      turnover: item.turnover as number,
    }]
  })
}

function closeEnough(left: number | null | undefined, right: number | null | undefined, tolerance: number): boolean {
  return left != null && right != null && Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance
}

export function compareHithinkDailyBars(
  hithinkBars: readonly ComparableDailyBar[],
  peerBars: readonly ComparableDailyBar[],
  options: { adjustment?: HithinkDailyParityReport['adjustment']; priceTolerance?: number; volumeTolerance?: number; turnoverTolerance?: number } = {},
): HithinkDailyParityReport {
  const priceTolerance = options.priceTolerance ?? 1e-8
  const volumeTolerance = options.volumeTolerance ?? 0
  const turnoverTolerance = options.turnoverTolerance ?? 0.01
  const hithinkByDate = new Map(hithinkBars.map((bar) => [bar.date.slice(0, 10), bar]))
  const peerByDate = new Map(peerBars.map((bar) => [bar.date.slice(0, 10), bar]))
  const allDates = [...new Set([...hithinkByDate.keys(), ...peerByDate.keys()])].sort()
  const mismatchCounts = { open: 0, high: 0, low: 0, close: 0, volume: 0, turnover: 0 }
  const mismatchSamples: Array<{ date: string; fields: string[] }> = []
  let comparedCount = 0
  for (const date of allDates) {
    const hithink = hithinkByDate.get(date)
    const peer = peerByDate.get(date)
    if (!hithink || !peer) continue
    comparedCount += 1
    const fields: string[] = []
    if (!closeEnough(hithink.open, peer.open, priceTolerance)) { mismatchCounts.open += 1; fields.push('open') }
    if (!closeEnough(hithink.high, peer.high, priceTolerance)) { mismatchCounts.high += 1; fields.push('high') }
    if (!closeEnough(hithink.low, peer.low, priceTolerance)) { mismatchCounts.low += 1; fields.push('low') }
    if (!closeEnough(hithink.close, peer.close, priceTolerance)) { mismatchCounts.close += 1; fields.push('close') }
    if (!closeEnough(hithink.volume, peer.volume, volumeTolerance)) { mismatchCounts.volume += 1; fields.push('volume') }
    if (hithink.turnover != null || peer.turnover != null) {
      if (!closeEnough(hithink.turnover, peer.turnover, turnoverTolerance)) { mismatchCounts.turnover += 1; fields.push('turnover') }
    }
    if (fields.length > 0 && mismatchSamples.length < 10) mismatchSamples.push({ date, fields })
  }
  const totalMismatches = Object.values(mismatchCounts).reduce((sum, value) => sum + value, 0)
  return {
    adjustment: options.adjustment ?? 'unknown',
    hithinkCount: hithinkBars.length,
    peerCount: peerBars.length,
    comparedCount,
    missingInHithink: [...peerByDate.keys()].filter((date) => !hithinkByDate.has(date)).sort(),
    missingInPeer: [...hithinkByDate.keys()].filter((date) => !peerByDate.has(date)).sort(),
    mismatchCounts,
    mismatchSamples,
    volumeUnit: 'unknown',
    turnoverUnit: 'unknown',
    pass: comparedCount > 0 && totalMismatches === 0 && hithinkBars.length === peerBars.length,
  }
}

export function renderHithinkCapabilityMatrix(matrix: HithinkCapabilityMatrix): string {
  const rows = matrix.results.map((result) => [
    `| ${result.id} | ${result.capability} | ${result.status} | ${result.attempts} | ${result.httpStatus ?? '—'} | ${result.apiCode ?? '—'} | ${result.note ?? ''} |`,
  ])
  const fingerprint = createHash('sha256').update(JSON.stringify(matrix.results.map((result) => ({ id: result.id, status: result.status, apiCode: result.apiCode })))).digest('hex').slice(0, 16)
  return [
    '# 同花顺 Financial-API 能力探针（shadow）',
    '',
    `- 生成时间：${matrix.generatedAt}`,
    `- configured：${matrix.configured}; eligibleAsTradeGate：${matrix.eligibleAsTradeGate}`,
    `- 探针指纹：${fingerprint}`,
    '',
    '| id | capability | status | attempts | HTTP | code | note |',
    '|---|---|---|---:|---:|---|---|',
    ...rows,
    '',
    '## 边界',
    '',
    ...matrix.notes.map((note) => `- ${note}`),
    '',
  ].join('\n')
}
