import type { TradeGroup, ReviewNote, MistakeTag } from '../types'

export function computeWinRate(closedGroups: readonly TradeGroup[]): number {
  if (closedGroups.length === 0) return 0
  const winners = closedGroups.filter((g) => g.pnl > 0).length
  return (winners / closedGroups.length) * 100
}

export function computePayoff(closedGroups: readonly TradeGroup[]): number {
  const winners = closedGroups.filter((g) => g.pnl > 0)
  const losers = closedGroups.filter((g) => g.pnl < 0)
  const avgWin =
    winners.length > 0 ? winners.reduce((s, g) => s + g.pnl, 0) / winners.length : 0
  const avgLoss =
    losers.length > 0 ? Math.abs(losers.reduce((s, g) => s + g.pnl, 0) / losers.length) : 0
  return avgLoss > 0 ? avgWin / avgLoss : 0
}

export function computeTotalFees(groups: readonly TradeGroup[]): number {
  return groups.reduce((sum, g) => sum + (g.totalFee ?? 0), 0)
}

export function computeTotalPnl(closedGroups: readonly TradeGroup[]): number {
  return closedGroups.reduce((sum, g) => sum + g.pnl, 0)
}

export function computeConsecutiveLosses(closedGroups: readonly TradeGroup[]): number {
  let maxStreak = 0
  let current = 0
  for (const g of closedGroups) {
    if (g.pnl < 0) {
      current++
      maxStreak = Math.max(maxStreak, current)
    } else {
      current = 0
    }
  }
  return maxStreak
}

export function computeAvgHoldingDays(closedGroups: readonly TradeGroup[]): number {
  if (closedGroups.length === 0) return 0
  return Math.round(closedGroups.reduce((s, g) => s + g.days, 0) / closedGroups.length)
}

const MISTAKE_PENALTIES: Record<MistakeTag, { label: string; cap: number }> = {
  'Late stop loss': { label: '止损拖延', cap: 15 },
  'No plan': { label: '无计划交易', cap: 15 },
  'Oversized position': { label: '仓位过重', cap: 10 },
  'Chasing high': { label: '追涨杀跌', cap: 10 },
  'Early profit taking': { label: '过早止盈', cap: 10 },
}

export interface DisciplineResult {
  readonly score: number
  readonly penalties: readonly string[]
}

export function computeDisciplineScore(
  closedGroups: readonly TradeGroup[],
  reviewNotes: Readonly<Record<string, ReviewNote>>,
): DisciplineResult {
  if (closedGroups.length === 0) return { score: 0, penalties: [] }

  let score = 100
  const penalties: string[] = []

  const reviewedCount = closedGroups.filter((g) => {
    const note = reviewNotes[g.id]
    return note && (note.buyReason || note.sellReason || note.executionReview || note.lesson)
  }).length
  const reviewRate = reviewedCount / closedGroups.length
  if (reviewRate < 1) {
    const deduction = Math.round((1 - reviewRate) * 20)
    score -= deduction
    penalties.push(`复盘覆盖率 ${(reviewRate * 100).toFixed(0)}%（-${deduction}）`)
  }

  for (const [key, { label, cap }] of Object.entries(MISTAKE_PENALTIES) as [MistakeTag, { label: string; cap: number }][]) {
    const count = closedGroups.filter((g) => g.mistakes.includes(key)).length
    if (count > 0) {
      const deduction = Math.min(count * 5, cap)
      score -= deduction
      penalties.push(`${label} ${count} 次（-${deduction}）`)
    }
  }

  score = Math.max(0, Math.min(100, score))
  return { score, penalties }
}
