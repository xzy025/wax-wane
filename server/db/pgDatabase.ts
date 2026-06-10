// PostgreSQL database layer with pgvector support
import pg from 'pg'
import { config } from 'dotenv'

config()

const { Pool } = pg

const pool = new Pool({
  host: process.env.PG_HOST ?? 'localhost',
  port: parseInt(process.env.PG_PORT ?? '5432'),
  database: process.env.PG_DATABASE ?? 'trade_review',
  user: process.env.PG_USER ?? 'postgres',
  password: process.env.PG_PASSWORD ?? 'postgres',
})

// ── Connection State ───────────────────────────────────────

let dbReady = false

/** Whether the PostgreSQL connection initialized successfully (write-through enabled). */
export function isDbReady(): boolean {
  return dbReady
}

// ── Schema Initialization ──────────────────────────────────

export async function initDatabase(): Promise<void> {
  const client = await pool.connect()
  try {
    // Enable pgvector extension
    await client.query('CREATE EXTENSION IF NOT EXISTS vector')

    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id TEXT PRIMARY KEY,
        source_filename TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'excel')),
        broker_name TEXT,
        account_alias TEXT,
        imported_at TEXT NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('draft', 'imported', 'failed')),
        mapping_json TEXT NOT NULL,
        notes TEXT
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        import_batch_id TEXT REFERENCES import_batches(id),
        trade_date TEXT NOT NULL,
        stock_code TEXT NOT NULL,
        stock_name TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        price REAL NOT NULL CHECK (price > 0),
        gross_amount REAL NOT NULL,
        commission REAL NOT NULL DEFAULT 0,
        stamp_tax REAL NOT NULL DEFAULT 0,
        transfer_fee REAL NOT NULL DEFAULT 0,
        other_fee REAL NOT NULL DEFAULT 0,
        net_amount REAL NOT NULL,
        validation_status TEXT NOT NULL DEFAULT 'valid',
        validation_message TEXT,
        raw_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS trade_groups (
        id TEXT PRIMARY KEY,
        stock_code TEXT NOT NULL,
        stock_name TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
        pnl REAL NOT NULL DEFAULT 0,
        return_rate REAL,
        holding_days INTEGER,
        strategy TEXT,
        mistakes_json TEXT NOT NULL DEFAULT '[]',
        review_status TEXT NOT NULL DEFAULT 'not_reviewed',
        embedding VECTOR(1536),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS review_notes (
        id TEXT PRIMARY KEY,
        trade_group_id TEXT NOT NULL REFERENCES trade_groups(id),
        buy_reason TEXT,
        sell_reason TEXT,
        execution_review TEXT,
        lesson TEXT,
        embedding VECTOR(1536),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        trading_profile_json TEXT NOT NULL,
        improvement_plans_json TEXT NOT NULL,
        market_analysis_json TEXT NOT NULL,
        conversation_summary TEXT,
        last_updated TEXT NOT NULL
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS fundamental_reports (
        id TEXT PRIMARY KEY,
        stock_code TEXT,
        stock_name TEXT,
        report_md TEXT,
        summary TEXT,
        created_at TEXT,
        embedding VECTOR(1536)
      )
    `)

    // Create indexes
    await client.query('CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(trade_date)')
    await client.query('CREATE INDEX IF NOT EXISTS idx_trades_stock ON trades(stock_code, trade_date)')
    await client.query('CREATE INDEX IF NOT EXISTS idx_trade_groups_stock ON trade_groups(stock_code)')
    await client.query('CREATE INDEX IF NOT EXISTS idx_trade_groups_status ON trade_groups(status)')
    await client.query('CREATE INDEX IF NOT EXISTS idx_review_notes_group ON review_notes(trade_group_id)')
    await client.query('CREATE INDEX IF NOT EXISTS idx_fundamental_stock ON fundamental_reports(stock_code)')

    dbReady = true
    console.log('[PostgreSQL] Database initialized successfully')
  } finally {
    client.release()
  }
}

// ── Import Batches ─────────────────────────────────────────

export async function insertImportBatch(batch: {
  id: string
  source_filename: string
  source_type: 'csv' | 'excel'
  broker_name?: string
  account_alias?: string
  imported_at: string
  row_count: number
  success_count: number
  error_count: number
  status: 'draft' | 'imported' | 'failed'
  mapping_json: string
  notes?: string
}): Promise<void> {
  await pool.query(
    `INSERT INTO import_batches (id, source_filename, source_type, broker_name, account_alias, imported_at, row_count, success_count, error_count, status, mapping_json, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      batch.id, batch.source_filename, batch.source_type, batch.broker_name ?? null,
      batch.account_alias ?? null, batch.imported_at, batch.row_count, batch.success_count,
      batch.error_count, batch.status, batch.mapping_json, batch.notes ?? null,
    ],
  )
}

// ── Trades ─────────────────────────────────────────────────

export async function insertTrade(trade: {
  id: string
  import_batch_id?: string
  trade_date: string
  stock_code: string
  stock_name: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  gross_amount: number
  commission?: number
  stamp_tax?: number
  transfer_fee?: number
  other_fee?: number
  net_amount: number
  validation_status?: 'valid' | 'warning' | 'error'
  validation_message?: string
  raw_json: string
}): Promise<void> {
  const now = new Date().toISOString()
  await pool.query(
    `INSERT INTO trades (id, import_batch_id, trade_date, stock_code, stock_name, side, quantity, price, gross_amount, commission, stamp_tax, transfer_fee, other_fee, net_amount, validation_status, validation_message, raw_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      trade.id, trade.import_batch_id ?? null, trade.trade_date, trade.stock_code,
      trade.stock_name, trade.side, trade.quantity, trade.price, trade.gross_amount,
      trade.commission ?? 0, trade.stamp_tax ?? 0, trade.transfer_fee ?? 0,
      trade.other_fee ?? 0, trade.net_amount, trade.validation_status ?? 'valid',
      trade.validation_message ?? null, trade.raw_json, now, now,
    ],
  )
}

export async function getTrades(filters?: {
  stock_code?: string
  start_date?: string
  end_date?: string
  side?: 'buy' | 'sell'
  limit?: number
}): Promise<Record<string, unknown>[]> {
  let sql = 'SELECT * FROM trades WHERE 1=1'
  const params: unknown[] = []
  let paramIndex = 1

  if (filters?.stock_code) {
    sql += ` AND stock_code = $${paramIndex++}`
    params.push(filters.stock_code)
  }
  if (filters?.start_date) {
    sql += ` AND trade_date >= $${paramIndex++}`
    params.push(filters.start_date)
  }
  if (filters?.end_date) {
    sql += ` AND trade_date <= $${paramIndex++}`
    params.push(filters.end_date)
  }
  if (filters?.side) {
    sql += ` AND side = $${paramIndex++}`
    params.push(filters.side)
  }

  sql += ' ORDER BY trade_date DESC'

  if (filters?.limit) {
    sql += ` LIMIT $${paramIndex++}`
    params.push(filters.limit)
  }

  const result = await pool.query(sql, params)
  return result.rows
}

// ── Trade Groups ───────────────────────────────────────────

export async function insertTradeGroup(group: {
  id: string
  stock_code: string
  stock_name: string
  opened_at: string
  closed_at?: string
  status: 'open' | 'closed'
  pnl?: number
  return_rate?: number
  holding_days?: number
  strategy?: string
  mistakes_json?: string
  review_status?: string
  embedding?: number[]
}): Promise<void> {
  const now = new Date().toISOString()
  const embeddingStr = group.embedding ? JSON.stringify(group.embedding) : null

  await pool.query(
    `INSERT INTO trade_groups (id, stock_code, stock_name, opened_at, closed_at, status, pnl, return_rate, holding_days, strategy, mistakes_json, review_status, embedding, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::vector, $14, $15)`,
    [
      group.id, group.stock_code, group.stock_name, group.opened_at,
      group.closed_at ?? null, group.status, group.pnl ?? 0, group.return_rate ?? null,
      group.holding_days ?? null, group.strategy ?? null, group.mistakes_json ?? '[]',
      group.review_status ?? 'not_reviewed', embeddingStr, now, now,
    ],
  )
}

export async function getTradeGroups(filters?: {
  status?: 'open' | 'closed'
  stock_code?: string
}): Promise<Record<string, unknown>[]> {
  let sql = 'SELECT * FROM trade_groups WHERE 1=1'
  const params: unknown[] = []
  let paramIndex = 1

  if (filters?.status) {
    sql += ` AND status = $${paramIndex++}`
    params.push(filters.status)
  }
  if (filters?.stock_code) {
    sql += ` AND stock_code = $${paramIndex++}`
    params.push(filters.stock_code)
  }

  sql += ' ORDER BY opened_at DESC'

  const result = await pool.query(sql, params)
  return result.rows
}

export async function updateTradeGroupEmbedding(id: string, embedding: number[]): Promise<void> {
  await pool.query(
    'UPDATE trade_groups SET embedding = $1::vector, updated_at = $2 WHERE id = $3',
    [JSON.stringify(embedding), new Date().toISOString(), id],
  )
}

// ── Review Notes ───────────────────────────────────────────

export async function upsertReviewNote(note: {
  trade_group_id: string
  buy_reason?: string
  sell_reason?: string
  execution_review?: string
  lesson?: string
  embedding?: number[]
}): Promise<void> {
  const now = new Date().toISOString()
  const embeddingStr = note.embedding ? JSON.stringify(note.embedding) : null

  const existing = await pool.query(
    'SELECT id FROM review_notes WHERE trade_group_id = $1',
    [note.trade_group_id],
  )

  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE review_notes SET buy_reason = $1, sell_reason = $2, execution_review = $3, lesson = $4, embedding = $5::vector, updated_at = $6
       WHERE trade_group_id = $7`,
      [note.buy_reason ?? null, note.sell_reason ?? null, note.execution_review ?? null, note.lesson ?? null, embeddingStr, now, note.trade_group_id],
    )
  } else {
    await pool.query(
      `INSERT INTO review_notes (id, trade_group_id, buy_reason, sell_reason, execution_review, lesson, embedding, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9)`,
      [crypto.randomUUID(), note.trade_group_id, note.buy_reason ?? null, note.sell_reason ?? null, note.execution_review ?? null, note.lesson ?? null, embeddingStr, now, now],
    )
  }
}

export async function getReviewNote(trade_group_id: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    'SELECT * FROM review_notes WHERE trade_group_id = $1',
    [trade_group_id],
  )
  return result.rows[0] ?? null
}

export async function updateReviewNoteEmbedding(trade_group_id: string, embedding: number[]): Promise<void> {
  await pool.query(
    'UPDATE review_notes SET embedding = $1::vector, updated_at = $2 WHERE trade_group_id = $3',
    [JSON.stringify(embedding), new Date().toISOString(), trade_group_id],
  )
}

// ── Vector Search ──────────────────────────────────────────

export async function searchSimilarTradeGroups(queryEmbedding: number[], topK: number = 5): Promise<Record<string, unknown>[]> {
  const result = await pool.query(`
    SELECT id, stock_code, stock_name, pnl, return_rate, strategy, mistakes_json, status,
           embedding <-> $1::vector AS distance
    FROM trade_groups
    WHERE embedding IS NOT NULL
    ORDER BY distance
    LIMIT $2
  `, [JSON.stringify(queryEmbedding), topK])

  return result.rows
}

export async function searchSimilarReviewNotes(queryEmbedding: number[], topK: number = 5): Promise<Record<string, unknown>[]> {
  const result = await pool.query(`
    SELECT id, trade_group_id, buy_reason, sell_reason, execution_review, lesson,
           embedding <-> $1::vector AS distance
    FROM review_notes
    WHERE embedding IS NOT NULL
    ORDER BY distance
    LIMIT $2
  `, [JSON.stringify(queryEmbedding), topK])

  return result.rows
}

// ── Fundamental Reports ────────────────────────────────────

export async function addFundamentalReport(report: {
  id: string
  stockCode: string
  stockName: string
  reportMd: string
  summary: string
  embedding?: number[]
}): Promise<void> {
  const now = new Date().toISOString()
  const embeddingStr = report.embedding ? JSON.stringify(report.embedding) : null

  await pool.query(
    `INSERT INTO fundamental_reports (id, stock_code, stock_name, report_md, summary, created_at, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
    [
      report.id, report.stockCode, report.stockName, report.reportMd,
      report.summary, now, embeddingStr,
    ],
  )
}

export async function searchSimilarFundamentalReports(queryEmbedding: number[], topK: number = 5): Promise<Record<string, unknown>[]> {
  const result = await pool.query(`
    SELECT id, stock_code, stock_name, summary, created_at,
           embedding <-> $1::vector AS distance
    FROM fundamental_reports
    WHERE embedding IS NOT NULL
    ORDER BY distance
    LIMIT $2
  `, [JSON.stringify(queryEmbedding), topK])

  return result.rows
}

// ── Agent Memory ───────────────────────────────────────────

export async function getAgentMemory(userId: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    'SELECT * FROM agent_memory WHERE user_id = $1',
    [userId],
  )
  return result.rows[0] ?? null
}

export async function upsertAgentMemory(memory: {
  user_id: string
  trading_profile_json: string
  improvement_plans_json: string
  market_analysis_json: string
  conversation_summary?: string
}): Promise<void> {
  const now = new Date().toISOString()

  const existing = await pool.query(
    'SELECT id FROM agent_memory WHERE user_id = $1',
    [memory.user_id],
  )

  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE agent_memory SET
        trading_profile_json = $1,
        improvement_plans_json = $2,
        market_analysis_json = $3,
        conversation_summary = $4,
        last_updated = $5
      WHERE user_id = $6`,
      [memory.trading_profile_json, memory.improvement_plans_json, memory.market_analysis_json, memory.conversation_summary ?? null, now, memory.user_id],
    )
  } else {
    await pool.query(
      `INSERT INTO agent_memory (id, user_id, trading_profile_json, improvement_plans_json, market_analysis_json, conversation_summary, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [crypto.randomUUID(), memory.user_id, memory.trading_profile_json, memory.improvement_plans_json, memory.market_analysis_json, memory.conversation_summary ?? null, now],
    )
  }
}

// ── Pool Export ────────────────────────────────────────────

export { pool }
