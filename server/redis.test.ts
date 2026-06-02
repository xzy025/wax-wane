import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ioredis with a class-like constructor
const mockRedisInstance = {
  lrange: vi.fn().mockResolvedValue([]),
  rpush: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  llen: vi.fn().mockResolvedValue(0),
  del: vi.fn().mockResolvedValue(1),
  hgetall: vi.fn().mockResolvedValue({}),
  hset: vi.fn().mockResolvedValue(1),
  hget: vi.fn().mockResolvedValue(null),
  get: vi.fn().mockResolvedValue(null),
  setex: vi.fn().mockResolvedValue('OK'),
  keys: vi.fn().mockResolvedValue([]),
  on: vi.fn(),
  quit: vi.fn().mockResolvedValue('OK'),
}

vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      constructor() {
        return mockRedisInstance
      }
    },
  }
})

vi.mock('dotenv', () => ({
  config: vi.fn(),
}))

// Import after mocking
import {
  getConversationHistory,
  appendMessage,
  clearConversation,
  getConversationLength,
  getReviewProgress,
  setReviewStep,
  getReviewStep,
  clearReviewProgress,
  getCachedToolResult,
  cacheToolResult,
  getMarketSnapshot,
  setMarketSnapshot,
  getSession,
  setSession,
  updateSessionActivity,
  getActiveSession,
  setActiveSession,
  getCacheStats,
} from './redis'

describe('Redis Short-Term Memory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the singleton client by re-importing
    // Since we mock ioredis, each test gets a fresh mock
  })

  describe('Conversation History', () => {
    it('returns empty array when no history exists', async () => {
      mockRedisInstance.lrange.mockResolvedValue([])
      const history = await getConversationHistory('session-1')
      expect(history).toEqual([])
    })

    it('appends message with correct TTL', async () => {
      const message = {
        role: 'user' as const,
        content: 'Hello',
        timestamp: Date.now(),
      }
      await appendMessage('session-1', message)
      expect(mockRedisInstance.rpush).toHaveBeenCalledWith(
        'agent:conv:session-1:messages',
        JSON.stringify(message),
      )
      expect(mockRedisInstance.expire).toHaveBeenCalledWith(
        'agent:conv:session-1:messages',
        7200,
      )
    })

    it('clears conversation', async () => {
      await clearConversation('session-1')
      expect(mockRedisInstance.del).toHaveBeenCalledWith('agent:conv:session-1:messages')
    })

    it('returns conversation length', async () => {
      mockRedisInstance.llen.mockResolvedValue(5)
      const length = await getConversationLength('session-1')
      expect(length).toBe(5)
    })
  })

  describe('Review Progress', () => {
    it('returns empty array when no progress exists', async () => {
      mockRedisInstance.hgetall.mockResolvedValue({})
      const progress = await getReviewProgress('review-1')
      expect(progress).toEqual([])
    })

    it('sets review step with correct TTL', async () => {
      const progress = {
        step: 'macro',
        status: 'done' as const,
        result: 'Analysis complete',
        timestamp: Date.now(),
      }
      await setReviewStep('review-1', 'macro', progress)
      expect(mockRedisInstance.hset).toHaveBeenCalledWith(
        'agent:review:review-1:progress',
        'macro',
        JSON.stringify(progress),
      )
      expect(mockRedisInstance.expire).toHaveBeenCalledWith(
        'agent:review:review-1:progress',
        1800,
      )
    })

    it('gets specific review step', async () => {
      const progress = {
        step: 'macro',
        status: 'done' as const,
        timestamp: Date.now(),
      }
      mockRedisInstance.hget.mockResolvedValue(JSON.stringify(progress))
      const result = await getReviewStep('review-1', 'macro')
      expect(result).toEqual(progress)
    })

    it('returns null for non-existent step', async () => {
      mockRedisInstance.hget.mockResolvedValue(null)
      const result = await getReviewStep('review-1', 'nonexistent')
      expect(result).toBeNull()
    })

    it('clears review progress', async () => {
      await clearReviewProgress('review-1')
      expect(mockRedisInstance.del).toHaveBeenCalledWith('agent:review:review-1:progress')
    })
  })

  describe('Tool Result Cache', () => {
    it('returns null for cache miss', async () => {
      mockRedisInstance.get.mockResolvedValue(null)
      const result = await getCachedToolResult('getStockQuote', { code: '600519' })
      expect(result).toBeNull()
    })

    it('returns cached result on hit', async () => {
      const cached = { price: 1800, volume: 100000 }
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(cached))
      const result = await getCachedToolResult('getStockQuote', { code: '600519' })
      expect(result).toEqual(cached)
    })

    it('caches tool result with default TTL', async () => {
      const result = { price: 1800 }
      await cacheToolResult('getStockQuote', { code: '600519' }, result)
      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        expect.stringContaining('agent:cache:getStockQuote:'),
        30,
        JSON.stringify(result),
      )
    })

    it('caches tool result with custom TTL', async () => {
      const result = { price: 1800 }
      await cacheToolResult('getStockQuote', { code: '600519' }, result, 60)
      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        expect.stringContaining('agent:cache:getStockQuote:'),
        60,
        JSON.stringify(result),
      )
    })
  })

  describe('Market Snapshot', () => {
    it('returns null for no snapshot', async () => {
      mockRedisInstance.get.mockResolvedValue(null)
      const result = await getMarketSnapshot('2026-06-01')
      expect(result).toBeNull()
    })

    it('sets market snapshot with TTL until end of day', async () => {
      const data = { indices: [], breadth: {} }
      await setMarketSnapshot('2026-06-01', data)
      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        'agent:market:snapshot:2026-06-01',
        expect.any(Number),
        JSON.stringify(data),
      )
      // TTL should be positive
      const ttl = mockRedisInstance.setex.mock.calls[0][1]
      expect(ttl).toBeGreaterThan(0)
    })
  })

  describe('Session Management', () => {
    it('returns null for non-existent session', async () => {
      mockRedisInstance.get.mockResolvedValue(null)
      const result = await getSession('session-1')
      expect(result).toBeNull()
    })

    it('sets session with TTL', async () => {
      const session = {
        sessionId: 'session-1',
        userId: 'user-1',
        startedAt: Date.now(),
        lastActivity: Date.now(),
      }
      await setSession(session)
      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        'agent:session:session-1',
        7200,
        JSON.stringify(session),
      )
    })

    it('updates session activity', async () => {
      const session = {
        sessionId: 'session-1',
        userId: 'user-1',
        startedAt: Date.now(),
        lastActivity: Date.now() - 1000,
      }
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(session))
      await updateSessionActivity('session-1')
      expect(mockRedisInstance.setex).toHaveBeenCalled()
    })

    it('sets active session for user', async () => {
      await setActiveSession('user-1', 'session-1')
      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        'agent:user:user-1:activeSession',
        7200,
        'session-1',
      )
    })
  })

  describe('Cache Stats', () => {
    it('returns counts of all cached items', async () => {
      mockRedisInstance.keys
        .mockResolvedValueOnce(['agent:conv:1:messages', 'agent:conv:2:messages'])
        .mockResolvedValueOnce(['agent:review:1:progress'])
        .mockResolvedValueOnce(['agent:cache:1', 'agent:cache:2', 'agent:cache:3'])
        .mockResolvedValueOnce(['agent:session:1'])
      const stats = await getCacheStats()
      expect(stats).toEqual({
        conversations: 2,
        reviews: 1,
        cachedResults: 3,
        sessions: 1,
      })
    })
  })
})
