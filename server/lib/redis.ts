// Redis client for short-term memory storage
// Install: npm install ioredis
import Redis from 'ioredis'
import { config } from 'dotenv'

config()

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

let client: Redis | null = null

/** Get or create Redis client (singleton) */
export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null  // Stop retrying
        return Math.min(times * 200, 2000)  // Exponential backoff
      },
      lazyConnect: true,
    })

    client.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message)
    })

    client.on('connect', () => {
      console.log('[Redis] Connected to', REDIS_URL)
    })
  }
  return client
}

/** Close Redis connection */
export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit()
    client = null
  }
}

// ── Short-Term Memory Service ─────────────────────────────

/** TTL constants (seconds) */
const TTL = {
  CONVERSATION: 7200,    // 2 hours
  REVIEW_PROGRESS: 1800, // 30 minutes
  TOOL_CACHE: 30,        // 30 seconds
  MARKET_SNAPSHOT: 86400, // 24 hours (until end of day)
  SESSION: 7200,         // 2 hours
} as const

/** Message format for conversation history */
export interface StoredMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  tool_call_id?: string
  timestamp: number
}

/** Review progress state */
export interface ReviewProgress {
  step: string
  status: 'pending' | 'running' | 'done' | 'error'
  result?: string
  timestamp: number
}

/** Session info */
export interface SessionInfo {
  sessionId: string
  userId: string
  startedAt: number
  lastActivity: number
  llmConfig?: string
}

// ── Conversation History ───────────────────────────────────

export async function getConversationHistory(sessionId: string): Promise<StoredMessage[]> {
  const redis = getRedisClient()
  const key = `agent:conv:${sessionId}:messages`
  const raw = await redis.lrange(key, 0, -1)
  return raw.map((r) => JSON.parse(r))
}

export async function appendMessage(sessionId: string, message: StoredMessage): Promise<void> {
  const redis = getRedisClient()
  const key = `agent:conv:${sessionId}:messages`
  await redis.rpush(key, JSON.stringify(message))
  await redis.expire(key, TTL.CONVERSATION)
}

export async function clearConversation(sessionId: string): Promise<void> {
  const redis = getRedisClient()
  const key = `agent:conv:${sessionId}:messages`
  await redis.del(key)
}

export async function getConversationLength(sessionId: string): Promise<number> {
  const redis = getRedisClient()
  const key = `agent:conv:${sessionId}:messages`
  return redis.llen(key)
}

// ── Review Progress ───────────────────────────────────────

export async function getReviewProgress(reviewId: string): Promise<ReviewProgress[]> {
  const redis = getRedisClient()
  const key = `agent:review:${reviewId}:progress`
  const raw = await redis.hgetall(key)
  return Object.values(raw).map((r) => JSON.parse(r))
}

export async function setReviewStep(
  reviewId: string,
  step: string,
  progress: ReviewProgress,
): Promise<void> {
  const redis = getRedisClient()
  const key = `agent:review:${reviewId}:progress`
  await redis.hset(key, step, JSON.stringify(progress))
  await redis.expire(key, TTL.REVIEW_PROGRESS)
}

export async function getReviewStep(
  reviewId: string,
  step: string,
): Promise<ReviewProgress | null> {
  const redis = getRedisClient()
  const key = `agent:review:${reviewId}:progress`
  const raw = await redis.hget(key, step)
  return raw ? JSON.parse(raw) : null
}

export async function clearReviewProgress(reviewId: string): Promise<void> {
  const redis = getRedisClient()
  const key = `agent:review:${reviewId}:progress`
  await redis.del(key)
}

// ── Tool Result Cache ─────────────────────────────────────

function hashArgs(args: Record<string, unknown>): string {
  const sorted = Object.keys(args)
    .sort()
    .map((k) => `${k}:${JSON.stringify(args[k])}`)
    .join('|')
  return Buffer.from(sorted).toString('base64').substring(0, 32)
}

export async function getCachedToolResult(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown | null> {
  const redis = getRedisClient()
  const key = `agent:cache:${toolName}:${hashArgs(args)}`
  const raw = await redis.get(key)
  return raw ? JSON.parse(raw) : null
}

export async function cacheToolResult(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  ttl: number = TTL.TOOL_CACHE,
): Promise<void> {
  const redis = getRedisClient()
  const key = `agent:cache:${toolName}:${hashArgs(args)}`
  await redis.setex(key, ttl, JSON.stringify(result))
}

// ── Market Data Snapshot ──────────────────────────────────

export async function getMarketSnapshot(date: string): Promise<Record<string, unknown> | null> {
  const redis = getRedisClient()
  const key = `agent:market:snapshot:${date}`
  const raw = await redis.get(key)
  return raw ? JSON.parse(raw) : null
}

export async function setMarketSnapshot(
  date: string,
  data: Record<string, unknown>,
): Promise<void> {
  const redis = getRedisClient()
  const key = `agent:market:snapshot:${date}`
  // Calculate TTL until end of day
  const now = new Date()
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  const ttl = Math.max(Math.floor((endOfDay.getTime() - now.getTime()) / 1000), 60)
  await redis.setex(key, ttl, JSON.stringify(data))
}

// ── Session Management ────────────────────────────────────

export async function getSession(sessionId: string): Promise<SessionInfo | null> {
  const redis = getRedisClient()
  const key = `agent:session:${sessionId}`
  const raw = await redis.get(key)
  return raw ? JSON.parse(raw) : null
}

export async function setSession(session: SessionInfo): Promise<void> {
  const redis = getRedisClient()
  const key = `agent:session:${session.sessionId}`
  await redis.setex(key, TTL.SESSION, JSON.stringify(session))
}

export async function updateSessionActivity(sessionId: string): Promise<void> {
  const session = await getSession(sessionId)
  if (session) {
    session.lastActivity = Date.now()
    await setSession(session)
  }
}

export async function getActiveSession(userId: string): Promise<SessionInfo | null> {
  const redis = getRedisClient()
  const key = `agent:user:${userId}:activeSession`
  const sessionId = await redis.get(key)
  if (!sessionId) return null
  return getSession(sessionId)
}

export async function setActiveSession(userId: string, sessionId: string): Promise<void> {
  const redis = getRedisClient()
  const key = `agent:user:${userId}:activeSession`
  await redis.setex(key, TTL.SESSION, sessionId)
}

// ── Statistics ────────────────────────────────────────────

export async function getCacheStats(): Promise<{
  conversations: number
  reviews: number
  cachedResults: number
  sessions: number
}> {
  const redis = getRedisClient()
  const [convKeys, reviewKeys, cacheKeys, sessionKeys] = await Promise.all([
    redis.keys('agent:conv:*:messages'),
    redis.keys('agent:review:*:progress'),
    redis.keys('agent:cache:*'),
    redis.keys('agent:session:*'),
  ])
  return {
    conversations: convKeys.length,
    reviews: reviewKeys.length,
    cachedResults: cacheKeys.length,
    sessions: sessionKeys.length,
  }
}
