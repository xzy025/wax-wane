import type { AppState } from '../../store'
import type { ToolModule } from '../types'

export const schema = {
  name: 'getTradeGroupDetail',
  description:
    'Get detailed information about a specific trade group (stock trading cycle) including PnL, ' +
    'holding period, strategy, mistakes, and review notes. Use when discussing a specific stock or trade cycle.',
  parameters: {
    type: 'object' as const,
    properties: {
      groupId: { type: 'string', description: 'Trade group ID (e.g., "tg-001")' },
      stockCode: { type: 'string', description: 'Stock code to look up the active or most recent group' },
    },
    required: [],
  },
}

export function execute(
  args: Record<string, unknown>,
  state: AppState,
): Record<string, unknown> | null {
  const groupId = args.groupId as string | undefined
  const stockCode = args.stockCode as string | undefined

  let group = undefined

  if (groupId) {
    group = state.tradeGroups.find((g) => g.id === groupId)
  } else if (stockCode) {
    // Find most recent group for this stock
    group = [...state.tradeGroups]
      .filter((g) => g.code === stockCode)
      .sort((a, b) => b.opened.localeCompare(a.opened))[0]
  }

  if (!group) return null

  const note = state.reviewNotes[group.id]

  return {
    id: group.id,
    stockCode: group.code,
    stockName: group.name,
    opened: group.opened,
    closed: group.closed,
    holdingDays: group.days,
    pnl: group.pnl,
    returnRate: group.returnRate,
    totalFee: group.totalFee,
    strategy: group.strategy,
    mistakes: group.mistakes,
    status: group.status,
    reviewNote: note
      ? {
          buyReason: note.buyReason,
          sellReason: note.sellReason,
          executionReview: note.executionReview,
          lesson: note.lesson,
        }
      : null,
  }
}

export const getTradeGroups: ToolModule = { schema, execute }
