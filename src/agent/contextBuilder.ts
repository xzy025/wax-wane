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

  // Always include full analytics
  parts.push(serializeAnalytics(state.tradeGroups))

  if (state.tradeGroups.length === 0) return parts.join('\n')

  // Compact list of ALL trade groups (for quick reference)
  parts.push('')
  parts.push('## All Trade Groups (compact)')
  for (const group of state.tradeGroups) {
    const status = group.closed ? `${group.days}d` : 'OPEN'
    const pnl = group.pnl >= 0 ? `+${group.pnl}` : `${group.pnl}`
    parts.push(`- ${group.name} (${group.code}): ${pnl} CNY, ${group.returnRate}%, ${status}, ${group.status}`)
  }

  // Full detail for RECENT trade groups only (last 5)
  const recentGroups = [...state.tradeGroups]
    .sort((a, b) => new Date(b.opened).getTime() - new Date(a.opened).getTime())
    .slice(0, 5)

  parts.push('')
  parts.push('## Recent Trade Groups (detailed)')
  for (const group of recentGroups) {
    parts.push('')
    parts.push(serializeTradeGroup(group, state.reviewNotes[group.id]))
  }

  // Risk alerts (unreviewed, consecutive losses)
  const unreviewed = state.tradeGroups.filter((g) => g.status === 'Not reviewed')
  const openLosers = state.tradeGroups.filter((g) => !g.closed && g.pnl < 0)

  if (unreviewed.length > 0 || openLosers.length > 0) {
    parts.push('')
    parts.push('## ⚠️ Alerts')
    if (unreviewed.length > 0) {
      parts.push(`- ${unreviewed.length} trade group(s) not reviewed`)
    }
    if (openLosers.length > 0) {
      parts.push(`- ${openLosers.length} open losing position(s)`)
    }
  }

  // Hint for semantic search
  parts.push('')
  parts.push('## Note')
  parts.push('For historical trade details not shown above, use the semanticSearch tool to find relevant experiences by topic.')

  const context = parts.join('\n')
  return context
}

export function estimateTokens(text: string): number {
  // Rough heuristic: ~4 chars per token for English, ~2 chars per token for Chinese
  // Use 3 as a middle ground
  return Math.ceil(text.length / 3)
}

export function serializeMemory(memory: {
  tradingProfile: {
    commonMistakes: string[]
    tradingStyle: string
    strengths: string[]
    weaknesses: string[]
    theoryGaps: string[]
  }
  improvementPlans: Array<{
    id: string
    focusArea: string
    theory: string
    status: string
    progress: number
    checkInDate: string
  }>
  marketAnalysis: {
    wyckoffPhase: string
    dowTrend: string
    sentimentPhase: string
  }
  conversationSummary: string
}): string {
  const parts: string[] = []

  // Trading Profile
  parts.push('## 用户画像')
  if (memory.tradingProfile.tradingStyle !== 'unknown') {
    parts.push(`- 交易风格：${memory.tradingProfile.tradingStyle}`)
  }
  if (memory.tradingProfile.commonMistakes.length > 0) {
    parts.push(`- 常见问题：${memory.tradingProfile.commonMistakes.join('、')}`)
  }
  if (memory.tradingProfile.strengths.length > 0) {
    parts.push(`- 优势：${memory.tradingProfile.strengths.join('、')}`)
  }
  if (memory.tradingProfile.weaknesses.length > 0) {
    parts.push(`- 弱项：${memory.tradingProfile.weaknesses.join('、')}`)
  }
  if (memory.tradingProfile.theoryGaps.length > 0) {
    parts.push(`- 理论薄弱：${memory.tradingProfile.theoryGaps.join('、')}`)
  }

  // Active Improvement Plans
  const activePlans = memory.improvementPlans.filter((p) => p.status === 'active')
  if (activePlans.length > 0) {
    parts.push('')
    parts.push('## 当前改进计划')
    for (const plan of activePlans) {
      parts.push(`- ${plan.focusArea}（${plan.theory}）：进行中，进度 ${plan.progress}%，${plan.checkInDate} 检查`)
    }
  }

  // Market Analysis
  if (memory.marketAnalysis.wyckoffPhase !== 'unknown') {
    parts.push('')
    parts.push('## 当前市场状态（基于理论分析）')
    parts.push(`- Wyckoff 阶段：${memory.marketAnalysis.wyckoffPhase}`)
    parts.push(`- 道氏趋势：${memory.marketAnalysis.dowTrend}`)
    parts.push(`- A股情绪：${memory.marketAnalysis.sentimentPhase}`)
  }

  // Conversation Summary
  if (memory.conversationSummary) {
    parts.push('')
    parts.push('## 上次对话摘要')
    parts.push(memory.conversationSummary)
  }

  return parts.join('\n')
}
