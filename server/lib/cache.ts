// Shared in-memory cache for market-data fetchers.
//
// Replaces the cachedData/cacheTime/CACHE_TTL/clearCache template that was
// duplicated across ashare.ts / hk.ts / us.ts / hotlist.ts / macro.ts.
//
// Adds three things the per-module copies lacked:
//   1. Market-aware TTL  — short TTL during the A-share session, long TTL when
//      the market is closed. This app is mostly used for after-close review,
//      when the data is static, so the long TTL slashes upstream calls and
//      keeps us under free-API rate limits.
//   2. In-flight de-duplication — concurrent callers (e.g. 5 banners mounting
//      at once) share a single upstream fetch instead of each hitting the API.
//   3. Serve-stale-on-error — if a refresh throws (e.g. provider rate-limited
//      us), we return the last good value instead of failing the request.

/** Minutes since midnight in the Asia/Shanghai timezone, plus weekday (0=Sun). */
function shanghaiClock(): { day: number; minutes: number } {
  const now = new Date()
  // Shanghai is UTC+8 year-round (no DST), so a fixed offset is exact.
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000
  const sh = new Date(utcMs + 8 * 3_600_000)
  return { day: sh.getDay(), minutes: sh.getHours() * 60 + sh.getMinutes() }
}

/** True during the A-share trading window (Mon–Fri, 09:30–15:00 CST). */
export function isAShareSession(): boolean {
  const { day, minutes } = shanghaiClock()
  if (day === 0 || day === 6) return false
  return minutes >= 9 * 60 + 30 && minutes <= 15 * 60
}

/**
 * Build a TTL function that returns `open` ms during the A-share session and
 * `closed` ms otherwise. Pass this as the `ttl` option to createCache.
 */
export function sessionTtl(open: number, closed: number): () => number {
  return () => (isAShareSession() ? open : closed)
}

export interface CacheOptions<T> {
  /** Loads fresh data from upstream. Called at most once per TTL window. */
  fetcher: () => Promise<T>
  /** TTL in ms, or a function returning the current TTL (e.g. sessionTtl). */
  ttl: number | (() => number)
  /** Optional label for logging. */
  name?: string
}

export interface Cache<T> {
  /** Returns cached data if fresh, otherwise fetches (de-duping concurrent calls). */
  get(): Promise<T>
  /** Invalidate the cache so the next get() refetches. */
  clear(): void
}

export function createCache<T>(opts: CacheOptions<T>): Cache<T> {
  let value: T | null = null
  let timestamp = 0
  let inflight: Promise<T> | null = null

  const ttlMs = () => (typeof opts.ttl === 'function' ? opts.ttl() : opts.ttl)

  return {
    async get(): Promise<T> {
      const now = Date.now()
      if (value !== null && now - timestamp < ttlMs()) {
        return value
      }
      // Coalesce concurrent refreshes into a single upstream fetch.
      if (inflight) return inflight

      inflight = (async () => {
        try {
          const fresh = await opts.fetcher()
          value = fresh
          timestamp = Date.now()
          return fresh
        } catch (err) {
          // Rate-limited / network error: serve last good value if we have one.
          if (value !== null) {
            if (opts.name) {
              console.warn(`[${opts.name}] refresh failed, serving stale cache:`, err)
            }
            return value
          }
          throw err
        } finally {
          inflight = null
        }
      })()

      return inflight
    },

    clear() {
      value = null
      timestamp = 0
    },
  }
}
