import type { AppState } from '../../store'
import type { ToolModule } from '../types'
import {
  computeWinRate,
  computePayoff,
  computeTotalFees,
  computeTotalPnl,
  computeConsecutiveLosses,
  computeAvgHoldingDays,
  computeDisciplineScore,
} from '../../utils/metrics'

/** Safely extract a string argument, returning undefined if not a string. */
function getStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const val = args[key]
  return typeof val === 'string' ? val : undefined
}

export const schema = {
  name: 'calculateMetrics',
  description:
    'Compute aggregate trading metrics for a date range or specific stock. Returns win rate, payoff ratio, ' +
    'total PnL, average holding days, fee ratio, consecutive losses. Use when the user asks for performance statistics or comparisons.',
  parameters: {
    type: 'object' as const,
    properties: {
      startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
      endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
      stockCode: { type: 'string', description: 'Optional: compute for a single stock' },
      strategy: { type: 'string', description: 'Optional: filter by strategy tag' },
    },
    required: [],
  },
}

export function execute(args: Record<string, unknown>, state: AppState): Record<string, unknown> {
  let groups = [...state.tradeGroups]

  const startDate = getStringArg(args, 'startDate')
  const endDate = getStringArg(args, 'endDate')
  const stockCode = getStringArg(args, 'stockCode')
  const strategy = getStringArg(args, 'strategy')

  if (startDate) {
    groups = groups.filter((g) => g.opened >= startDate)
  }
  if (endDate) {
    groups = groups.filter((g) => g.opened <= endDate)
  }
  if (stockCode) {
    groups = groups.filter((g) => g.code === stockCode)
  }
  if (strategy) {
    groups = groups.filter((g) => g.strategy === strategy)
  }

  const closedGroups = groups.filter((g) => g.closed)
  const winners = closedGroups.filter((g) => g.pnl > 0)
  const losers = closedGroups.filter((g) => g.pnl < 0)

  const totalPnl = computeTotalPnl(closedGroups)
  const winRate = computeWinRate(closedGroups)
  const payoff = computePayoff(closedGroups)
  const totalFees = computeTotalFees(groups)
  const avgHoldingDays = computeAvgHoldingDays(closedGroups)
  const maxConsecutiveLoss = computeConsecutiveLosses(closedGroups)

  // Mistake frequency
  const mistakeMap = new Map<string, number>()
  for (const g of closedGroups) {
    for (const m of g.mistakes) {
      mistakeMap.set(m, (mistakeMap.get(m) ?? 0) + 1)
    }
  }
  const topMistakes = [...mistakeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }))

  const discipline = computeDisciplineScore(closedGroups, state.reviewNotes)

  return {
    totalGroups: groups.length,
    closedGroups: closedGroups.length,
    openGroups: groups.filter((g) => !g.closed).length,
    winners: winners.length,
    losers: losers.length,
    totalPnl: Math.round(totalPnl),
    winRate: Math.round(winRate * 10) / 10,
    payoffRatio: Math.round(payoff * 100) / 100,
    avgWin: winners.length > 0 ? Math.round(winners.reduce((s, g) => s + g.pnl, 0) / winners.length) : 0,
    avgLoss: losers.length > 0 ? Math.round(Math.abs(losers.reduce((s, g) => s + g.pnl, 0) / losers.length)) : 0,
    avgHoldingDays,
    totalFees: Math.round(totalFees),
    maxConsecutiveLoss,
    topMistakes,
    disciplineScore: discipline.score,
  }
}

export const calculateMetrics: ToolModule = { schema, execute }
