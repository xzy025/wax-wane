import type { AppState } from '../../store'
import type { ToolModule } from '../types'

/** Safely extract a string argument, returning undefined if not a string. */
function getStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const val = args[key]
  return typeof val === 'string' ? val : undefined
}

/** Safely extract a number argument, returning undefined if not a number. */
function getNumberArg(args: Record<string, unknown>, key: string): number | undefined {
  const val = args[key]
  return typeof val === 'number' ? val : undefined
}

/** Safely extract a boolean argument, returning the default if not a boolean. */
function getBooleanArg(args: Record<string, unknown>, key: string, defaultValue: boolean): boolean {
  const val = args[key]
  return typeof val === 'boolean' ? val : defaultValue
}

export const schema = {
  name: 'findPatternTrades',
  description:
    'Find trade groups that share a specific mistake tag, strategy, or pattern (e.g., all trades with ' +
    '"Late stop loss", all losing trades held over 14 days). Use when the user asks to analyze patterns or find recurring mistakes.',
  parameters: {
    type: 'object' as const,
    properties: {
      mistakeTag: {
        type: 'string',
        description: 'Filter by mistake tag (e.g., "No plan", "Late stop loss")',
      },
      strategy: { type: 'string', description: 'Filter by strategy tag' },
      minPnl: { type: 'number', description: 'Minimum PnL filter (negative for losses)' },
      maxPnl: { type: 'number', description: 'Maximum PnL filter' },
      minDays: { type: 'number', description: 'Minimum holding days' },
      maxDays: { type: 'number', description: 'Maximum holding days' },
      closedOnly: {
        type: 'boolean',
        description: 'If true, only return closed groups (default true)',
      },
    },
    required: [],
  },
}

export function execute(
  args: Record<string, unknown>,
  state: AppState,
): Array<Record<string, unknown>> {
  let groups = [...state.tradeGroups]

  const mistakeTag = getStringArg(args, 'mistakeTag')
  const strategy = getStringArg(args, 'strategy')
  const minPnl = getNumberArg(args, 'minPnl')
  const maxPnl = getNumberArg(args, 'maxPnl')
  const minDays = getNumberArg(args, 'minDays')
  const maxDays = getNumberArg(args, 'maxDays')
  const closedOnly = getBooleanArg(args, 'closedOnly', true)

  if (closedOnly) {
    groups = groups.filter((g) => g.closed)
  }
  if (mistakeTag) {
    // Cast is safe: the LLM provides any string; we filter by membership
    groups = groups.filter((g) => g.mistakes.includes(mistakeTag as typeof g.mistakes[number]))
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
