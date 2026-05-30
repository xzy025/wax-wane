// Vector store using PostgreSQL pgvector
import { embedText } from './embedding'
import {
  searchSimilarTradeGroups,
  searchSimilarReviewNotes,
  updateTradeGroupEmbedding,
  updateReviewNoteEmbedding,
  pool,
} from './pgDatabase'

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

export async function searchSimilar(
  query: string,
  topK: number = 5,
  type?: string,
): Promise<SearchResult[]> {
  const queryEmbedding = await embedText(query)

  let results: SearchResult[] = []

  if (!type || type === 'all' || type === 'trade_group') {
    const tradeGroups = await searchSimilarTradeGroups(queryEmbedding, topK)
    results.push(...tradeGroups.map((row) => ({
      id: `trade_group:${row.id}`,
      text: `${row.stock_name} (${row.stock_code}): ${row.pnl} CNY, ${row.return_rate}%, ${row.strategy}`,
      metadata: {
        type: 'trade_group',
        tradeGroupId: row.id,
        stockCode: row.stock_code,
        stockName: row.stock_name,
        pnl: row.pnl,
        strategy: row.strategy,
        mistakes: JSON.parse(row.mistakes_json as string || '[]'),
      },
      score: 1 - (row.distance as number), // Convert distance to similarity
    })))
  }

  if (!type || type === 'all' || type === 'review_note') {
    const reviewNotes = await searchSimilarReviewNotes(queryEmbedding, topK)
    results.push(...reviewNotes.map((row) => ({
      id: `review:${row.trade_group_id}`,
      text: `复盘笔记: 买入${row.buy_reason || '无'}, 卖出${row.sell_reason || '无'}, 教训${row.lesson || '无'}`,
      metadata: {
        type: 'review_note',
        tradeGroupId: row.trade_group_id,
        buyReason: row.buy_reason,
        sellReason: row.sell_reason,
        lesson: row.lesson,
      },
      score: 1 - (row.distance as number),
    })))
  }

  // Sort by score and limit
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, topK)
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
