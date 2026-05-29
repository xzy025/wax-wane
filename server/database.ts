// SQLite database layer using sql.js (pure JS, no native compilation)
import initSqlJs, { type Database } from 'sql.js'
import fs from 'fs'
import path from 'path'

const DB_PATH = path.join(import.meta.dirname, 'data', 'trade-review.db')

let db: Database | null = null

export async function getDatabase(): Promise<Database> {
  if (db) return db

  const SQL = await initSqlJs()

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
    initializeSchema(db)
    saveDatabase(db)
  }

  return db
}

function initializeSchema(db: Database): void {
  db.run(`
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

  db.run(`
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
      validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'warning', 'error')),
      validation_message TEXT,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS trade_groups (
      id TEXT PRIMARY KEY,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
      buy_count INTEGER NOT NULL DEFAULT 0,
      sell_count INTEGER NOT NULL DEFAULT 0,
      total_buy_amount REAL NOT NULL DEFAULT 0,
      total_sell_amount REAL NOT NULL DEFAULT 0,
      total_fee REAL NOT NULL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      realized_return REAL,
      holding_days INTEGER,
      strategy TEXT,
      mistakes_json TEXT NOT NULL DEFAULT '[]',
      review_status TEXT NOT NULL DEFAULT 'not_reviewed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS review_notes (
      id TEXT PRIMARY KEY,
      trade_group_id TEXT NOT NULL REFERENCES trade_groups(id),
      buy_reason TEXT,
      sell_reason TEXT,
      execution_review TEXT,
      lesson TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS rag_documents (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('trade_group', 'review_note', 'lesson')),
      trade_group_id TEXT REFERENCES trade_groups(id),
      stock_code TEXT,
      stock_name TEXT,
      content TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  // Create indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(trade_date)')
  db.run('CREATE INDEX IF NOT EXISTS idx_trades_stock ON trades(stock_code, trade_date)')
  db.run('CREATE INDEX IF NOT EXISTS idx_trade_groups_stock ON trade_groups(stock_code)')
  db.run('CREATE INDEX IF NOT EXISTS idx_trade_groups_status ON trade_groups(status)')
  db.run('CREATE INDEX IF NOT EXISTS idx_review_notes_group ON review_notes(trade_group_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_rag_documents_type ON rag_documents(type)')
  db.run('CREATE INDEX IF NOT EXISTS idx_rag_documents_trade_group ON rag_documents(trade_group_id)')
}

function saveDatabase(db: Database): void {
  const data = db.export()
  const buffer = Buffer.from(data)

  // Ensure directory exists
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(DB_PATH, buffer)
}

// ── CRUD Operations ─────────────────────────────────────────

export async function closeDatabase(): Promise<void> {
  if (db) {
    saveDatabase(db)
    db.close()
    db = null
  }
}

// Import Batches
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
  const d = await getDatabase()
  d.run(
    `INSERT INTO import_batches (id, source_filename, source_type, broker_name, account_alias, imported_at, row_count, success_count, error_count, status, mapping_json, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      batch.id, batch.source_filename, batch.source_type, batch.broker_name ?? null,
      batch.account_alias ?? null, batch.imported_at, batch.row_count, batch.success_count,
      batch.error_count, batch.status, batch.mapping_json, batch.notes ?? null,
    ],
  )
  saveDatabase(d)
}

// Trades
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
  const d = await getDatabase()
  const now = new Date().toISOString()
  d.run(
    `INSERT INTO trades (id, import_batch_id, trade_date, stock_code, stock_name, side, quantity, price, gross_amount, commission, stamp_tax, transfer_fee, other_fee, net_amount, validation_status, validation_message, raw_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trade.id, trade.import_batch_id ?? null, trade.trade_date, trade.stock_code,
      trade.stock_name, trade.side, trade.quantity, trade.price, trade.gross_amount,
      trade.commission ?? 0, trade.stamp_tax ?? 0, trade.transfer_fee ?? 0,
      trade.other_fee ?? 0, trade.net_amount, trade.validation_status ?? 'valid',
      trade.validation_message ?? null, trade.raw_json, now, now,
    ],
  )
  saveDatabase(d)
}

export async function getTrades(filters?: {
  stock_code?: string
  start_date?: string
  end_date?: string
  side?: 'buy' | 'sell'
  limit?: number
}): Promise<Record<string, unknown>[]> {
  const d = await getDatabase()
  let sql = 'SELECT * FROM trades WHERE 1=1'
  const params: unknown[] = []

  if (filters?.stock_code) {
    sql += ' AND stock_code = ?'
    params.push(filters.stock_code)
  }
  if (filters?.start_date) {
    sql += ' AND trade_date >= ?'
    params.push(filters.start_date)
  }
  if (filters?.end_date) {
    sql += ' AND trade_date <= ?'
    params.push(filters.end_date)
  }
  if (filters?.side) {
    sql += ' AND side = ?'
    params.push(filters.side)
  }

  sql += ' ORDER BY trade_date DESC'

  if (filters?.limit) {
    sql += ` LIMIT ${filters.limit}`
  }

  const result = d.exec(sql, params)
  if (result.length === 0) return []

  const columns = result[0].columns
  return result[0].values.map((row) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      obj[col] = row[i]
    })
    return obj
  })
}

// Trade Groups
export async function insertTradeGroup(group: {
  id: string
  stock_code: string
  stock_name: string
  opened_at: string
  closed_at?: string
  status: 'open' | 'closed'
  buy_count?: number
  sell_count?: number
  total_buy_amount?: number
  total_sell_amount?: number
  total_fee?: number
  realized_pnl?: number
  realized_return?: number
  holding_days?: number
  strategy?: string
  mistakes_json?: string
  review_status?: string
}): Promise<void> {
  const d = await getDatabase()
  const now = new Date().toISOString()
  d.run(
    `INSERT INTO trade_groups (id, stock_code, stock_name, opened_at, closed_at, status, buy_count, sell_count, total_buy_amount, total_sell_amount, total_fee, realized_pnl, realized_return, holding_days, strategy, mistakes_json, review_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      group.id, group.stock_code, group.stock_name, group.opened_at,
      group.closed_at ?? null, group.status, group.buy_count ?? 0,
      group.sell_count ?? 0, group.total_buy_amount ?? 0, group.total_sell_amount ?? 0,
      group.total_fee ?? 0, group.realized_pnl ?? 0, group.realized_return ?? null,
      group.holding_days ?? null, group.strategy ?? null, group.mistakes_json ?? '[]',
      group.review_status ?? 'not_reviewed', now, now,
    ],
  )
  saveDatabase(d)
}

export async function getTradeGroups(filters?: {
  status?: 'open' | 'closed'
  stock_code?: string
}): Promise<Record<string, unknown>[]> {
  const d = await getDatabase()
  let sql = 'SELECT * FROM trade_groups WHERE 1=1'
  const params: unknown[] = []

  if (filters?.status) {
    sql += ' AND status = ?'
    params.push(filters.status)
  }
  if (filters?.stock_code) {
    sql += ' AND stock_code = ?'
    params.push(filters.stock_code)
  }

  sql += ' ORDER BY opened_at DESC'

  const result = d.exec(sql, params)
  if (result.length === 0) return []

  const columns = result[0].columns
  return result[0].values.map((row) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      obj[col] = row[i]
    })
    return obj
  })
}

// Review Notes
export async function upsertReviewNote(note: {
  trade_group_id: string
  buy_reason?: string
  sell_reason?: string
  execution_review?: string
  lesson?: string
}): Promise<void> {
  const d = await getDatabase()
  const now = new Date().toISOString()

  // Check if note exists
  const existing = d.exec('SELECT id FROM review_notes WHERE trade_group_id = ?', [note.trade_group_id])

  if (existing.length > 0 && existing[0].values.length > 0) {
    // Update
    d.run(
      `UPDATE review_notes SET buy_reason = ?, sell_reason = ?, execution_review = ?, lesson = ?, updated_at = ?
       WHERE trade_group_id = ?`,
      [note.buy_reason ?? null, note.sell_reason ?? null, note.execution_review ?? null, note.lesson ?? null, now, note.trade_group_id],
    )
  } else {
    // Insert
    d.run(
      `INSERT INTO review_notes (id, trade_group_id, buy_reason, sell_reason, execution_review, lesson, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), note.trade_group_id, note.buy_reason ?? null, note.sell_reason ?? null, note.execution_review ?? null, note.lesson ?? null, now, now],
    )
  }
  saveDatabase(d)
}

export async function getReviewNote(trade_group_id: string): Promise<Record<string, unknown> | null> {
  const d = await getDatabase()
  const result = d.exec('SELECT * FROM review_notes WHERE trade_group_id = ?', [trade_group_id])

  if (result.length === 0 || result[0].values.length === 0) return null

  const columns = result[0].columns
  const row = result[0].values[0]
  const obj: Record<string, unknown> = {}
  columns.forEach((col, i) => {
    obj[col] = row[i]
  })
  return obj
}
