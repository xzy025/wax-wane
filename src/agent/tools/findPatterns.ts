import type { AppState } from '../../store'
import type { ToolModule } from '../types'

export const schema = {
  name: 'findPatternTrades',
  description:
    'Find trade groups that share a specific mistake tag, strategy, or pattern (e.g., all trades with ' +
    '"Late stop loss", all losing trades held over 14 days). Use when the user asks to analyze patterns or find recurring mistakes.',
  parameters: {
    type: 'object' as const,
    properties: {
      mistakeTag: { type: 'string', description: 'Filter by mistake tag (e.g., "No plan", "Late stop loss")' },
      strategy: { type: 'string', description: 'Filter by strategy tag' },
      minPnl: { type: 'number', description: 'Minimum PnL filter (negative for losses)' },
      maxPnl: { type: 'number', description: 'Maximum PnL filter' },
      minDays: { type: 'number', description: 'Minimum holding days' },
      maxDays: { type: 'number', description: 'Maximum holding days' },
      closedOnly: { type: 'boolean', description: 'If true, only return closed groups (default true)' },
    },
    required: [],
  },
}

export function execute(
  args: Record<string, unknown>,
  state: AppState,
): Array<Record<string, unknown>> {
  let groups = [...state.tradeGroups]

  const mistakeTag = args.mistakeTag as string | undefined
  const strategy = args.strategy as string | undefined
  const minPnl = args.minPnl as number | undefined
  const maxPnl = args.maxPnl as number | undefined
  const minDays = args.minDays as number | undefined
  const maxDays = args.maxDays as number | undefined
  const closedOnly = (args.closedOnly as boolean) ?? true

  if (closedOnly) {
    groups = groups.filter((g) => g.closed)
  }
  if (mistakeTag) {
    groups = groups.filter((g) => g.mistakes.includes(mistakeTag))
  }
  if (strategy) {
    groups = groups.filter((g) => g.strategy === strategy)
  }
  if (minPnl !== undefined) {
    groups = groups.filter((g) => g.pnl >= minPnl)
  }
  if (maxPnl !== undefined) {
    groups = groups.filter((g) => g.pnl <= maxPnl)
  }
  if (minDays !== undefined) {
    groups = groups.filter((g) => g.days >= minDays)
  }
  if (maxDays !== undefined) {
    groups = groups.filter((g) => g.days <= maxDays)
  }

  return groups.map((g) => ({
    id: g.id,
    stockCode: g.code,
    stockName: g.name,
    opened: g.opened,
    closed: g.closed,
    holdingDays: g.days,
    pnl: g.pnl,
    returnRate: g.returnRate,
    strategy: g.strategy,
    mistakes: g.mistakes,
  }))
}

export const findPatterns: ToolModule = { schema, execute }
