// Vector store using PostgreSQL pgvector
import { embedText } from './embedding'
import {
  searchSimilarTradeGroups,
  searchSimilarReviewNotes,
  searchSimilarFundamentalReports,
  updateTradeGroupEmbedding,
  updateReviewNoteEmbedding,
  pool,
} from '../db/pgDatabase'

export interface VectorDocument {
  id: string
  text: string
  metadata: Record<string, unknown>
}

export interface SearchResult {
  id: string
  text: string
  metadata: Record<string, unknown>
  score: number
}

export async function addDocument(doc: VectorDocument): Promise<void> {
  const embedding = await embedText(doc.text)

  if (doc.id.startsWith('trade_group:')) {
    const tradeGroupId = doc.id.replace('trade_group:', '')
    await updateTradeGroupEmbedding(tradeGroupId, embedding)
  } else if (doc.id.startsWith('review:')) {
    const tradeGroupId = doc.id.replace('review:', '')
    await updateReviewNoteEmbedding(tradeGroupId, embedding)
  }
}

// ── Row → document builders ────────────────────────────────
// Shared by dense search (adds a similarity score) and the BM25 corpus loader
// so a given row maps to the *same id and text* in both paths — essential for
// rank fusion, which joins the two rankings by id.

function tradeGroupDoc(row: Record<string, unknown>): VectorDocument {
  const mistakes = JSON.parse((row.mistakes_json as string) || '[]') as string[]
  return {
    id: `trade_group:${row.id}`,
    text: `交易组 ${row.stock_name} (${row.stock_code}) 策略:${row.strategy || '未标注'} 盈亏:${row.pnl}元 收益率:${row.return_rate ?? '-'}% 错误标签:${mistakes.length ? mistakes.join(',') : '无'} 状态:${row.status}`,
    metadata: {
      type: 'trade_group',
      tradeGroupId: row.id,
      stockCode: row.stock_code,
      stockName: row.stock_name,
      pnl: row.pnl,
      strategy: row.strategy,
      mistakes,
    },
  }
}

function reviewNoteDoc(row: Record<string, unknown>): VectorDocument {
  return {
    id: `review:${row.trade_group_id}`,
    text: `复盘笔记: 买入理由 ${row.buy_reason || '无'}; 卖出理由 ${row.sell_reason || '无'}; 执行复盘 ${row.execution_review || '无'}; 教训 ${row.lesson || '无'}`,
    metadata: {
      type: 'review_note',
      tradeGroupId: row.trade_group_id,
      buyReason: row.buy_reason,
      sellReason: row.sell_reason,
      lesson: row.lesson,
    },
  }
}

function fundamentalDoc(row: Record<string, unknown>): VectorDocument {
  return {
    id: `fundamental:${row.id}`,
    text: `${row.stock_name || ''} (${row.stock_code || ''}) 基本面: ${(row.summary as string) || ''}`,
    metadata: {
      type: 'fundamental_report',
      reportId: row.id,
      stockCode: row.stock_code,
      stockName: row.stock_name,
      createdAt: row.created_at,
    },
  }
}

export async function searchSimilar(
  query: string,
  topK: number = 5,
  type?: string,
): Promise<SearchResult[]> {
  const queryEmbedding = await embedText(query)

  const results: SearchResult[] = []
  const score = (row: Record<string, unknown>) => 1 - (row.distance as number) // distance → similarity

  if (!type || type === 'all' || type === 'trade_group') {
    const tradeGroups = await searchSimilarTradeGroups(queryEmbedding, topK)
    results.push(...tradeGroups.map((row) => ({ ...tradeGroupDoc(row), score: score(row) })))
  }

  if (!type || type === 'all' || type === 'review_note') {
    const reviewNotes = await searchSimilarReviewNotes(queryEmbedding, topK)
    results.push(...reviewNotes.map((row) => ({ ...reviewNoteDoc(row), score: score(row) })))
  }

  if (!type || type === 'all' || type === 'fundamental_report') {
    const reports = await searchSimilarFundamentalReports(queryEmbedding, topK)
    results.push(...reports.map((row) => ({ ...fundamentalDoc(row), score: score(row) })))
  }

  // Sort by score and limit
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, topK)
}

/**
 * Load the full lexical corpus (no embeddings required) for BM25 search.
 * Unlike dense search this includes rows that were never embedded, so lexical
 * matches keep working even before/without an embedding sync.
 */
export async function getCorpus(type?: string): Promise<VectorDocument[]> {
  const docs: VectorDocument[] = []

  if (!type || type === 'all' || type === 'trade_group') {
    const { rows } = await pool.query(
      'SELECT id, stock_code, stock_name, pnl, return_rate, strategy, mistakes_json, status FROM trade_groups',
    )
    docs.push(...rows.map(tradeGroupDoc))
  }

  if (!type || type === 'all' || type === 'review_note') {
    const { rows } = await pool.query(
      `SELECT trade_group_id, buy_reason, sell_reason, execution_review, lesson FROM review_notes
       WHERE buy_reason IS NOT NULL OR sell_reason IS NOT NULL OR execution_review IS NOT NULL OR lesson IS NOT NULL`,
    )
    docs.push(...rows.map(reviewNoteDoc))
  }

  if (!type || type === 'all' || type === 'fundamental_report') {
    const { rows } = await pool.query(
      'SELECT id, stock_code, stock_name, summary, created_at FROM fundamental_reports',
    )
    docs.push(...rows.map(fundamentalDoc))
  }

  return docs
}

export async function deleteDocument(id: string): Promise<void> {
  if (id.startsWith('trade_group:')) {
    const tradeGroupId = id.replace('trade_group:', '')
    await pool.query('UPDATE trade_groups SET embedding = NULL WHERE id = $1', [tradeGroupId])
  } else if (id.startsWith('review:')) {
    const tradeGroupId = id.replace('review:', '')
    await pool.query('UPDATE review_notes SET embedding = NULL WHERE trade_group_id = $1', [tradeGroupId])
  }
}

export async function getDocumentCount(): Promise<number> {
  const tradeGroupCount = await pool.query('SELECT COUNT(*) FROM trade_groups WHERE embedding IS NOT NULL')
  const reviewNoteCount = await pool.query('SELECT COUNT(*) FROM review_notes WHERE embedding IS NOT NULL')
  return parseInt(tradeGroupCount.rows[0].count as string) + parseInt(reviewNoteCount.rows[0].count as string)
}

export async function clearIndex(): Promise<void> {
  await pool.query('UPDATE trade_groups SET embedding = NULL')
  await pool.query('UPDATE review_notes SET embedding = NULL')
}
