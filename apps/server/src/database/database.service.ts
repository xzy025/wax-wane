import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import pg from 'pg'

const { Pool } = pg

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: pg.Pool

  constructor(private configService: ConfigService) {
    this.pool = new Pool({
      host: this.configService.get('PG_HOST', 'localhost'),
      port: parseInt(this.configService.get('PG_PORT', '5432')),
      database: this.configService.get('PG_DATABASE', 'trade_review'),
      user: this.configService.get('PG_USER', 'postgres'),
      password: this.configService.get('PG_PASSWORD', 'postgres'),
    })
  }

  async onModuleInit() {
    try {
      // Test connection
      const client = await this.pool.connect()
      client.release()
      console.log('[PostgreSQL] Connected')
    } catch (err) {
      console.error('[PostgreSQL] Connection failed:', err)
    }
  }

  async onModuleDestroy() {
    await this.pool.end()
  }

  async query(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
    return this.pool.query(sql, params)
  }

  getPool(): pg.Pool {
    return this.pool
  }
}
