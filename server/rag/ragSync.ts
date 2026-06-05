// RAG sync - sync trade data to vector store
import { addDocument, getDocumentCount, clearIndex } from './vectorStore'

interface TradeGroup {
  id: string
  code: string
  name: string
  opened: string
  closed: string | null
  pnl: number
  returnRate: number
  days: number
  totalFee: number
  strategy: string
  mistakes: readonly string[]
  status: string
}

interface ReviewNote {
  buyReason: string
  sellReason: string
  executionReview: string
  lesson: string
}

interface SyncResult {
  success: boolean
  documentsAdded: number
  totalDocuments: number
  error?: string
}

export async function syncTradeGroups(
  tradeGroups: TradeGroup[],
  reviewNotes: Record<string, ReviewNote>,
): Promise<SyncResult> {
  try {
    let documentsAdded = 0

    for (const group of tradeGroups) {
      const note = reviewNotes[group.id]

      // Document 1: Trade group summary
      const tradeSummary = `交易组 ${group.name} (${group.code})
时间: ${group.opened} 至 ${group.closed || '持仓中'} (${group.days}天)
盈亏: ${group.pnl >= 0 ? '+' : ''}${group.pnl} 元, 收益率: ${group.returnRate}%
策略: ${group.strategy || '未标注'}
错误标签: ${group.mistakes.length > 0 ? group.mistakes.join(', ') : '无'}
状态: ${group.status}`

      await addDocument({
        id: `trade_group:${group.id}`,
        text: tradeSummary,
        metadata: {
          type: 'trade_group',
          tradeGroupId: group.id,
          stockCode: group.code,
          stockName: group.name,
          pnl: group.pnl,
          returnRate: group.returnRate,
          days: group.days,
          strategy: group.strategy,
          mistakes: [...group.mistakes],
          opened: group.opened,
          closed: group.closed,
        },
      })
      documentsAdded++

      // Document 2: Review note (if exists and has content)
      if (note && (note.buyReason || note.sellReason || note.executionReview || note.lesson)) {
        const reviewText = `复盘笔记 - ${group.name} (${group.code})
买入理由: ${note.buyReason || '未填写'}
卖出理由: ${note.sellReason || '未填写'}
执行复盘: ${note.executionReview || '未填写'}
教训总结: ${note.lesson || '未填写'}`

        await addDocument({
          id: `review:${group.id}`,
          text: reviewText,
          metadata: {
            type: 'review_note',
            tradeGroupId: group.id,
            stockCode: group.code,
            stockName: group.name,
            pnl: group.pnl,
          },
        })
        documentsAdded++
      }

      // Document 3: Lesson (separate for better retrieval)
      if (note?.lesson && note.lesson.trim().length > 10) {
        await addDocument({
          id: `lesson:${group.id}`,
          text: `交易教训 - ${group.name}: ${note.lesson}`,
          metadata: {
            type: 'lesson',
            tradeGroupId: group.id,
            stockCode: group.code,
            stockName: group.name,
            pnl: group.pnl,
            mistakes: [...group.mistakes],
          },
        })
        documentsAdded++
      }
    }

    const totalDocuments = await getDocumentCount()

    return {
      success: true,
      documentsAdded,
      totalDocuments,
    }
  } catch (err) {
    return {
      success: false,
      documentsAdded: 0,
      totalDocuments: 0,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

export async function resetAndSyncAll(
  tradeGroups: TradeGroup[],
  reviewNotes: Record<string, ReviewNote>,
): Promise<SyncResult> {
  await clearIndex()
  return syncTradeGroups(tradeGroups, reviewNotes)
}
