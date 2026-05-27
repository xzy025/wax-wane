import type { AppState } from '../store'
import type { TradeGroup, ReviewNote } from '../types'
import { computeWinRate, computePayoff, computeTotalFees, computeTotalPnl } from '../utils/metrics'

export function serializeTradeGroup(group: TradeGroup, note?: ReviewNote): string {
  const lines: string[] = []
  lines.push(`Trade Group ${group.id}: ${group.name} (${group.code})`)
  lines.push(`  Period: ${group.opened} to ${group.closed ?? 'OPEN'} (${group.days} days)`)
  lines.push(`  P&L: ${group.pnl >= 0 ? '+' : ''}${group.pnl} CNY, Return: ${group.returnRate}%`)
  lines.push(`  Total Fees: ${group.totalFee} CNY`)

  if (group.strategy) {
    lines.push(`  Strategy: ${group.strategy}`)
  }
  if (group.mistakes.length > 0) {
    lines.push(`  Mistakes: ${group.mistakes.join(', ')}`)
  }
  lines.push(`  Status: ${group.status}`)

  if (note) {
    if (note.buyReason) lines.push(`  Buy Reason: <user-data>${note.buyReason}</user-data>`)
    if (note.sellReason) lines.push(`  Sell Reason: <user-data>${note.sellReason}</user-data>`)
    if (note.executionReview) lines.push(`  Execution Review: <user-data>${note.executionReview}</user-data>`)
    if (note.lesson) lines.push(`  Lesson: <user-data>${note.lesson}</user-data>`)
  }

  return lines.join('\n')
}

export function serializeAnalytics(groups: TradeGroup[]): string {
  const closed = groups.filter((g) => g.closed)
  const winners = closed.filter((g) => g.pnl > 0)
  const losers = closed.filter((g) => g.pnl < 0)
  const totalPnl = computeTotalPnl(closed)
  const winRate = computeWinRate(closed)
  const payoff = computePayoff(closed)
  const totalFees = computeTotalFees(groups)

  const mistakeMap = new Map<string, number>()
  for (const g of closed) {
    for (const m of g.mistakes) {
      mistakeMap.set(m, (mistakeMap.get(m) ?? 0) + 1)
    }
  }
  const topMistakes = [...mistakeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  const lines: string[] = []
  lines.push(`## Portfolio Overview`)
  lines.push(
    `Total trade groups: ${groups.length} (${closed.length} closed, ${groups.length - closed.length} open)`,
  )
  lines.push(`Win/Loss: ${winners.length}/${losers.length} (Win rate: ${winRate.toFixed(1)}%)`)
  lines.push(`Total P&L: ${totalPnl >= 0 ? '+' : ''}${Math.round(totalPnl)} CNY`)
  lines.push(`Payoff ratio: ${payoff.toFixed(2)}`)
  lines.push(`Total fees: ${Math.round(totalFees)} CNY`)

  if (topMistakes.length > 0) {
    lines.push(``)
    lines.push(`## Top Mistakes`)
    for (const [name, count] of topMistakes) {
      lines.push(`- ${name}: ${count} time(s)`)
    }
  }

  return lines.join('\n')
}

export function buildFullContext(state: AppState): string {
  const parts: string[] = []

  parts.push(serializeAnalytics(state.tradeGroups))

  if (state.tradeGroups.length > 0) {
    parts.push('')
    parts.push('## Trade Groups')
    for (const group of state.tradeGroups) {
      parts.push('')
      parts.push(serializeTradeGroup(group, state.reviewNotes[group.id]))
    }
  }

  const context = parts.join('\n')
  return context
}

export function estimateTokens(text: string): number {
  // Rough heuristic: ~4 chars per token for English, ~2 chars per token for Chinese
  // Use 3 as a middle ground
  return Math.ceil(text.length / 3)
}
