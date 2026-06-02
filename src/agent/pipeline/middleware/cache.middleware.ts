import type { AgentMiddleware, ToolCallInterception } from '../pipeline.types'

/** Tools that should be cached */
const CACHEABLE_TOOLS: Record<string, number> = {
  getMacroIndicators: 30,   // 30 seconds
  getMarketBreadth: 30,
  getStockQuote: 10,        // 10 seconds (more volatile)
  getIndexTrends: 30,
  getLimitPool: 30,
  getNewsSummary: 60,       // 1 minute
  getHotList: 30,
}

/** In-memory cache for when Redis is not available */
const memoryCache = new Map<string, { data: unknown; expires: number }>()

function getCacheKey(toolName: string, args: Record<string, unknown>): string {
  const sorted = Object.keys(args)
    .sort()
    .map((k) => `${k}:${JSON.stringify(args[k])}`)
    .join('|')
  return `${toolName}:${sorted}`
}

function getFromCache(key: string): unknown | null {
  const entry = memoryCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    memoryCache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key: string, data: unknown, ttlSeconds: number): void {
  memoryCache.set(key, {
    data,
    expires: Date.now() + ttlSeconds * 1000,
  })
}

/**
 * Tool result caching middleware.
 * Caches results of frequently-called tools to reduce API calls.
 */
export const cacheMiddleware: AgentMiddleware = {
  name: 'cache',
  order: 20,

  async onToolCall(toolName, args): Promise<ToolCallInterception> {
    const ttl = CACHEABLE_TOOLS[toolName]
    if (!ttl) {
      return { proceed: true }
    }

    const cacheKey = getCacheKey(toolName, args)
    const cached = getFromCache(cacheKey)

    if (cached !== null) {
      return { proceed: false, cachedResult: cached }
    }

    // Proceed but we'll cache the result after execution
    // (This is handled by the after hook or the caller)
    return { proceed: true }
  },

  async after(context, response) {
    // Cache tool call results from this response
    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        const ttl = CACHEABLE_TOOLS[tc.name]
        if (ttl) {
          const cacheKey = getCacheKey(tc.name, tc.args)
          setCache(cacheKey, tc.result, ttl)
        }
      }
    }
    return response
  },
}

/** Clear all cached entries (for testing) */
export function clearCache(): void {
  memoryCache.clear()
}

/** Get cache stats (for monitoring) */
export function getCacheStats(): { size: number; keys: string[] } {
  // Clean expired entries
  const now = Date.now()
  for (const [key, entry] of memoryCache) {
    if (now > entry.expires) {
      memoryCache.delete(key)
    }
  }
  return {
    size: memoryCache.size,
    keys: Array.from(memoryCache.keys()),
  }
}
