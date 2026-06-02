import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://localhost:6379')
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true,
    })

    this.client.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message)
    })

    this.client.on('connect', () => {
      console.log('[Redis] Connected')
    })
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit()
    }
  }

  getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client not initialized')
    }
    return this.client
  }

  // ── Convenience Methods ──────────────────────────────────

  async get(key: string): Promise<string | null> {
    return this.getClient().get(key)
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.getClient().setex(key, ttl, value)
    } else {
      await this.getClient().set(key, value)
    }
  }

  async del(key: string): Promise<void> {
    await this.getClient().del(key)
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.getClient().lrange(key, start, stop)
  }

  async rpush(key: string, value: string): Promise<number> {
    return this.getClient().rpush(key, value)
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.getClient().expire(key, seconds)
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.getClient().hgetall(key)
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.getClient().hset(key, field, value)
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.getClient().hget(key, field)
  }

  async keys(pattern: string): Promise<string[]> {
    return this.getClient().keys(pattern)
  }
}
