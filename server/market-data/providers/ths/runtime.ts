import {
  createHithinkFinanceClient,
  type HithinkFetch,
  type HithinkParams,
  type HithinkResponse,
} from '../../hithinkFinanceClient'
import type { HithinkConnectionConfig } from './config'

export type ThsRequestStatus =
  | 'success'
  | 'empty'
  | 'rate-limited'
  | 'permission-denied'
  | 'invalid-parameters'
  | 'upstream-error'
  | 'invalid-response'
  | 'not-configured'
  | 'busy'

export interface ThsRuntimeDiagnostics {
  provider: 'hithink-finance'
  configured: boolean
  active: number
  queued: number
  cacheEntries: number
  pendingEntries: number
  cacheHits: number
  cacheMisses: number
  statuses: Record<ThsRequestStatus, number>
}

export class ThsRuntimeBusyError extends Error {
  constructor(message = 'THS provider request budget is busy') {
    super(message)
    this.name = 'ThsRuntimeBusyError'
  }
}

interface RuntimeCacheEntry {
  value: unknown
  expiresAt: number
}

interface MemoizeOptions<T> {
  ttlMs?: number | ((value: T) => number)
  shouldCache?: (value: T) => boolean
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]))
  }
  return value
}

export function stableRequestKey(endpoint: string, params: HithinkParams = {}): string {
  return JSON.stringify({ endpoint: endpoint.replace(/^\/+/, '/'), params: stableValue(params) })
}

class RequestBudget {
  private active = 0
  private queued = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly maxConcurrent: number, private readonly maxQueue: number) {}

  snapshot(): { active: number; queued: number } {
    return { active: this.active, queued: this.queued }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      if (this.queued >= this.maxQueue) throw new ThsRuntimeBusyError()
      this.queued += 1
      await new Promise<void>((resolve) => this.waiters.push(resolve))
      this.queued -= 1
    }
    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      this.waiters.shift()?.()
    }
  }
}

/** Serializes only outbound starts, so retry backoff does not consume the whole request budget. */
class RequestPacer {
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly gapMs: number,
    private readonly sleepImpl: (ms: number) => Promise<void>,
  ) {}

  async wait(): Promise<void> {
    if (this.gapMs === 0) return
    const previous = this.tail
    let release: (() => void) | undefined
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      await this.sleepImpl(this.gapMs)
    } finally {
      release?.()
    }
  }
}

export function classifyHithinkResponse(response: Pick<HithinkResponse, 'httpStatus' | 'code' | 'ok' | 'data'>): ThsRequestStatus {
  const numericCode = typeof response.code === 'number'
    ? response.code
    : typeof response.code === 'string' && /^-?\d+$/.test(response.code) ? Number(response.code) : null
  if (response.httpStatus === 401 || response.httpStatus === 403 || numericCode === 401 || numericCode === 403) return 'permission-denied'
  if (response.httpStatus === 429 || numericCode === 4001) return 'rate-limited'
  if (response.httpStatus === 400 || response.httpStatus === 422 || numericCode === 400 || numericCode === 422) return 'invalid-parameters'
  if (response.httpStatus >= 400 || (numericCode !== null && numericCode !== 0)) return 'upstream-error'
  if (!response.ok) return 'upstream-error'
  return response.data == null ? 'empty' : 'success'
}

export interface ThsRuntime {
  readonly isConfigured: boolean
  get<T = unknown>(endpoint: string, params?: HithinkParams): Promise<HithinkResponse<T>>
  memoize<T>(namespace: string, key: string, task: () => Promise<T>, options?: MemoizeOptions<T>): Promise<T>
  diagnostics(): ThsRuntimeDiagnostics
}

export function createThsRuntime(options: {
  connection: HithinkConnectionConfig
  fetchImpl?: HithinkFetch
  sleepImpl?: (ms: number) => Promise<void>
  now?: () => number
}): ThsRuntime {
  const now = options.now ?? (() => Date.now())
  const budget = new RequestBudget(options.connection.maxConcurrent, options.connection.maxQueue)
  const sleepImpl = options.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const pacer = new RequestPacer(options.connection.requestGapMs, sleepImpl)
  const cache = new Map<string, RuntimeCacheEntry>()
  const pending = new Map<string, Promise<unknown>>()
  const statuses = Object.fromEntries([
    'success', 'empty', 'rate-limited', 'permission-denied', 'invalid-parameters',
    'upstream-error', 'invalid-response', 'not-configured', 'busy',
  ].map((status) => [status, 0])) as Record<ThsRequestStatus, number>
  let cacheHits = 0
  let cacheMisses = 0
  const client = createHithinkFinanceClient({
    baseUrl: options.connection.baseUrl,
    apiKey: options.connection.apiKey,
    timeoutMs: options.connection.timeoutMs,
    maxRetries: options.connection.maxRetries,
    requestGapMs: 0,
    fetchImpl: options.fetchImpl,
    sleepImpl,
    beforeAttempt: () => pacer.wait(),
  })

  const evictIfNeeded = () => {
    while (cache.size >= options.connection.cacheMaxEntries) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }

  const memoize = async <T>(namespace: string, key: string, task: () => Promise<T>, memoOptions: MemoizeOptions<T> = {}): Promise<T> => {
    const cacheKey = `${namespace}:${key}`
    const saved = cache.get(cacheKey)
    if (saved && saved.expiresAt > now()) {
      cacheHits += 1
      return saved.value as T
    }
    if (saved) cache.delete(cacheKey)
    const existing = pending.get(cacheKey)
    if (existing) return existing as Promise<T>
    cacheMisses += 1
    const taskPromise = task()
    pending.set(cacheKey, taskPromise)
    try {
      const value = await taskPromise
      if (!memoOptions.shouldCache || memoOptions.shouldCache(value)) {
        evictIfNeeded()
        const ttlMs = typeof memoOptions.ttlMs === 'function'
          ? memoOptions.ttlMs(value)
          : memoOptions.ttlMs ?? options.connection.cacheTtlMs
        cache.set(cacheKey, { value, expiresAt: now() + ttlMs })
      }
      return value
    } finally {
      pending.delete(cacheKey)
    }
  }

  const get = async <T = unknown>(endpoint: string, params: HithinkParams = {}): Promise<HithinkResponse<T>> => {
    const key = stableRequestKey(endpoint, params)
    try {
      const response = await memoize('hithink-response', key,
        () => budget.run(() => client.get<T>(endpoint, params)),
        { shouldCache: (value) => value.ok })
      statuses[classifyHithinkResponse(response)] += 1
      return response
    } catch (error) {
      const status: ThsRequestStatus = error instanceof ThsRuntimeBusyError
        ? 'busy'
        : error instanceof Error && error.name === 'HithinkConfigurationError' ? 'not-configured' : 'upstream-error'
      statuses[status] += 1
      throw error
    }
  }

  return {
    isConfigured: client.isConfigured,
    get,
    memoize,
    diagnostics: () => {
      const snapshot = budget.snapshot()
      return {
        provider: 'hithink-finance',
        configured: client.isConfigured,
        active: snapshot.active,
        queued: snapshot.queued,
        cacheEntries: cache.size,
        pendingEntries: pending.size,
        cacheHits,
        cacheMisses,
        statuses: { ...statuses },
      }
    },
  }
}
