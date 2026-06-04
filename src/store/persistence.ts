// Backend write-through persistence layer.
//
// localStorage stays the always-available source of truth (see store/index.tsx).
// When the PostgreSQL backend is reachable, state-mutating actions are mirrored
// to /api/db/* on a best-effort basis. Every network call swallows its own
// failure: if the backend is in limited mode (no PG) the app behaves exactly as
// it did before this layer existed.
import type { ParsedTrade, ReviewNote, TradeGroup } from '../types'
import type { ImportBatch } from './index'

let dbAvailable = false

/** Last known backend DB availability (synchronously readable after a probe). */
export function isDbAvailable(): boolean {
  return dbAvailable
}

/**
 * Probe the backend health endpoint once and cache whether the PostgreSQL
 * database is connected. Network/parse errors resolve to `false` (limited mode).
 */
export async function probeBackendDb(): Promise<boolean> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) {
      dbAvailable = false
      return false
    }
    const json = (await res.json()) as { db?: boolean }
    dbAvailable = json.db === true
    return dbAvailable
  } catch {
    dbAvailable = false
    return false
  }
}

function postJson(path: string, body: unknown): Promise<unknown> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined)
}

function putJson(path: string, body: unknown): Promise<unknown> {
  return fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined)
}

// ── Mappers: frontend camelCase → backend snake_case ───────────

/**
 * ParsedTrade has no id (it's a parsed row, not a stored entity), so we mint one
 * per sync. import_batch_id is left null to avoid foreign-key ordering issues —
 * trades are dispatched before their import batch.
 */
export function tradeToDb(trade: ParsedTrade): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    trade_date: trade.tradeDate,
    stock_code: trade.stockCode,
    stock_name: trade.stockName,
    side: trade.side,
    quantity: trade.quantity,
    price: trade.price,
    gross_amount: trade.grossAmount,
    commission: trade.commission,
    stamp_tax: trade.stampTax,
    transfer_fee: trade.transferFee,
    other_fee: trade.otherFee,
    net_amount: trade.netAmount,
    validation_status: trade.validationStatus ?? 'valid',
    validation_message: trade.validationMessage,
    raw_json: JSON.stringify(trade.raw),
  }
}

/**
 * The frontend TradeGroup.status ("Reviewed" / "Follow up" / "Not reviewed") is a
 * review state, mapped to the DB `review_status` column. The DB `status` column
 * (open/closed) is derived from whether the group has a close date.
 */
export function tradeGroupToDb(group: TradeGroup): Record<string, unknown> {
  return {
    id: group.id,
    stock_code: group.code,
    stock_name: group.name,
    opened_at: group.opened,
    closed_at: group.closed ?? undefined,
    status: group.closed ? 'closed' : 'open',
    pnl: group.pnl,
    return_rate: group.returnRate,
    holding_days: group.days,
    strategy: group.strategy || undefined,
    mistakes_json: JSON.stringify(group.mistakes),
    review_status: group.status,
  }
}

export function reviewNoteToDb(note: ReviewNote): Record<string, unknown> {
  return {
    buy_reason: note.buyReason,
    sell_reason: note.sellReason,
    execution_review: note.executionReview,
    lesson: note.lesson,
  }
}

export function importBatchToDb(batch: ImportBatch): Record<string, unknown> {
  return {
    id: batch.id,
    source_filename: batch.filename,
    source_type: 'csv',
    imported_at: batch.importedAt,
    row_count: batch.rowCount,
    success_count: batch.status === 'imported' ? batch.rowCount : 0,
    error_count: batch.status === 'failed' ? batch.rowCount : 0,
    status: batch.status,
    mapping_json: '{}',
  }
}

// ── Write-through sync helpers ─────────────────────────────────

export function syncTrades(trades: readonly ParsedTrade[]): void {
  if (!dbAvailable) return
  for (const trade of trades) void postJson('/api/db/trades', tradeToDb(trade))
}

export function syncTradeGroups(groups: readonly TradeGroup[]): void {
  if (!dbAvailable) return
  for (const group of groups) void postJson('/api/db/trade-groups', tradeGroupToDb(group))
}

export function syncReviewNote(groupId: string, note: ReviewNote): void {
  if (!dbAvailable) return
  void putJson(`/api/db/review-notes/${encodeURIComponent(groupId)}`, reviewNoteToDb(note))
}

export function syncImportBatch(batch: ImportBatch): void {
  if (!dbAvailable) return
  void postJson('/api/db/import-batches', importBatchToDb(batch))
}
