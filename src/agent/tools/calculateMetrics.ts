import type { AppState } from '../../store'
import type { ToolModule } from '../types'

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

export function execute(
  args: Record<string, unknown>,
  state: AppState,
): Record<string, unknown> {
  let groups = [...state.tradeGroups]

  const startDate = args.startDate as string | undefined
  const endDate = args.endDate as string | undefined
  const stockCode = args.stockCode as string | undefined
  const strategy = args.strategy as string | undefined

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

  const totalPnl = closedGroups.reduce((sum, g) => sum + g.pnl, 0)
  const winRate = closedGroups.length > 0 ? (winners.length / closedGroups.length) * 100 : 0
  const avgWin = winners.length > 0 ? winners.reduce((s, g) => s + g.pnl, 0) / winners.length : 0
  const avgLoss = losers.length > 0 ? Math.abs(losers.reduce((s, g) => s + g.pnl, 0) / losers.length) : 0
  const payoff = avgLoss > 0 ? avgWin / avgLoss : 0
  const totalFees = groups.reduce((sum, g) => sum + (g.totalFee ?? 0), 0)
  const avgHoldingDays = closedGroups.length > 0
    ? Math.round(closedGroups.reduce((s, g) => s + g.days, 0) / closedGroups.length)
    : 0

  // Consecutive losses
  let maxConsecutiveLoss = 0
  let currentStreak = 0
  for (const g of closedGroups) {
    if (g.pnl < 0) {
      currentStreak++
      maxConsecutiveLoss = Math.max(maxConsecutiveLoss, currentStreak)
    } else {
      currentStreak = 0
    }
  }

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

  // Discipline score
  let disciplineScore = 100
  const reviewedCount = closedGroups.filter((g) => {
    const note = state.reviewNotes[g.id]
    return note && (note.buyReason || note.sellReason || note.executionReview || note.lesson)
  }).length
  const reviewRate = closedGroups.length > 0 ? reviewedCount / closedGroups.length : 1
  if (reviewRate < 1) {
    disciplineScore -= Math.round((1 - reviewRate) * 20)
  }
  const mistakePenaltyMap: Record<string, number> = {
    'Late stop loss': 15,
    'No plan': 15,
    'Oversized position': 10,
    'Chasing high': 10,
  }
  for (const [key, cap] of Object.entries(mistakePenaltyMap)) {
    const count = closedGroups.filter((g) => g.mistakes.includes(key)).length
    if (count > 0) {
      disciplineScore -= Math.min(count * 5, cap)
    }
  }
  disciplineScore = Math.max(0, Math.min(100, disciplineScore))

  return {
    totalGroups: groups.length,
    closedGroups: closedGroups.length,
    openGroups: groups.filter((g) => !g.closed).length,
    winners: winners.length,
    losers: losers.length,
    totalPnl: Math.round(totalPnl),
    winRate: Math.round(winRate * 10) / 10,
    payoffRatio: Math.round(payoff * 100) / 100,
    avgWin: Math.round(avgWin),
    avgLoss: Math.round(avgLoss),
    avgHoldingDays,
    totalFees: Math.round(totalFees),
    maxConsecutiveLoss,
    topMistakes,
    disciplineScore,
  }
}

export const calculateMetrics: ToolModule = { schema, execute }
