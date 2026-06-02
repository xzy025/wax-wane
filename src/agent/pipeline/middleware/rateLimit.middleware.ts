import type { AgentMiddleware, AgentContext, AgentResponse } from '../pipeline.types'

/** Rate limit configuration */
export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number
  /** Window duration in seconds */
  windowSeconds: number
  /** Custom error message */
  errorMessage?: string
}

/** In-memory rate limit store */
const rateLimitStore = new Map<string, { count: number; windowStart: number }>()

/**
 * Rate limiting middleware.
 * Limits the number of requests per user per time window.
 */
export function createRateLimitMiddleware(config: RateLimitConfig): AgentMiddleware {
  const {
    maxRequests = 30,
    windowSeconds = 60,
    errorMessage = `请求过于频繁，请 ${windowSeconds} 秒后再试`,
  } = config

  return {
    name: 'rate-limit',
    order: 1,

    async before(context: AgentContext): Promise<AgentContext> {
      const key = `${context.userId}`
      const now = Date.now()
      const windowMs = windowSeconds * 1000

      let entry = rateLimitStore.get(key)

      // Reset window if expired
      if (!entry || now - entry.windowStart > windowMs) {
        entry = { count: 0, windowStart: now }
        rateLimitStore.set(key, entry)
      }

      entry.count++

      if (entry.count > maxRequests) {
        const remainingMs = windowMs - (now - entry.windowStart)
        const remainingSeconds = Math.ceil(remainingMs / 1000)
        throw new Error(`${errorMessage} (剩余 ${remainingSeconds} 秒)`)
      }

      // Add rate limit info to metadata
      context.metadata.rateLimitRemaining = maxRequests - entry.count
      context.metadata.rateLimitReset = entry.windowStart + windowMs

      return context
    },

    async onError(error: Error, _context: AgentContext): Promise<AgentResponse | null> {
      if (error.message.includes('请求过于频繁')) {
        return {
          content: error.message,
          duration: 0,
        }
      }
      return null
    },
  }
}

/** Default rate limit: 30 requests per minute */
export const rateLimitMiddleware = createRateLimitMiddleware({
  maxRequests: 30,
  windowSeconds: 60,
})

/** Get rate limit stats for a user */
export function getRateLimitStats(userId: string): {
  count: number
  remaining: number
  resetAt: number
} | null {
  const entry = rateLimitStore.get(userId)
  if (!entry) return null
  return {
    count: entry.count,
    remaining: Math.max(0, 30 - entry.count),
    resetAt: entry.windowStart + 60000,
  }
}

/** Clear rate limit store (for testing) */
export function clearRateLimits(): void {
  rateLimitStore.clear()
}
