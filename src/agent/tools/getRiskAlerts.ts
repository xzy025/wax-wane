import type { AppState } from '../../store'
import type { ToolModule } from '../types'

export const schema = {
  name: 'getRiskAlerts',
  description:
    'Get current risk alerts: open losing positions, consecutive losing streaks, high fee ratios, ' +
    'unreviewed trades. Use when the user asks about risks, warnings, or what needs attention.',
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
}

export function execute(
  _args: Record<string, unknown>,
  state: AppState,
): Record<string, unknown> {
  const groups = state.tradeGroups
  const closedGroups = groups.filter((g) => g.closed)
  const alerts: Array<{ severity: string; title: string; detail: string }> = []

  // Open losers
  const openLosers = groups.filter((g) => !g.closed && g.pnl < 0)
  if (openLosers.length > 0) {
    const totalOpenLoss = openLosers.reduce((s, g) => s + g.pnl, 0)
    const longest = openLosers.reduce((a, b) => (a.days > b.days ? a : b))
    alerts.push({
      severity: 'high',
      title: 'Open losing positions',
      detail: `${openLosers.length} position(s) losing ${Math.round(totalOpenLoss)} CNY. ${longest.name} held for ${longest.days} days.`,
    })
  }

  // Late stop loss
  const lateStopLoss = closedGroups.filter((g) => g.mistakes.includes('Late stop loss'))
  if (lateStopLoss.length > 0) {
    const loss = lateStopLoss.reduce((s, g) => s + g.pnl, 0)
    alerts.push({
      severity: 'medium',
      title: 'Late stop-loss pattern',
      detail: `${lateStopLoss.length} trade(s) with delayed stop-loss, combined P&L: ${Math.round(loss)} CNY.`,
    })
  }

  // Fee drag
  const totalFees = groups.reduce((s, g) => s + (g.totalFee ?? 0), 0)
  const totalGross = groups.reduce((s, g) => s + Math.abs(g.pnl) + (g.totalFee ?? 0), 0)
  const feeRatio = totalGross > 0 ? (totalFees / totalGross) * 100 : 0
  if (feeRatio > 0.5) {
    alerts.push({
      severity: 'medium',
      title: 'High fee ratio',
      detail: `Fees are ${feeRatio.toFixed(2)}% of gross trading volume. Consider reducing trade frequency.`,
    })
  }

  // Consecutive losses
  let maxConsecutive = 0
  let streak = 0
  for (const g of closedGroups) {
    if (g.pnl < 0) {
      streak++
      maxConsecutive = Math.max(maxConsecutive, streak)
    } else {
      streak = 0
    }
  }
  if (maxConsecutive >= 3) {
    alerts.push({
      severity: 'high',
      title: 'Consecutive losses',
      detail: `Up to ${maxConsecutive} consecutive losing trades detected. Consider pausing to review strategy.`,
    })
  }

  // Unreviewed trades
  const unreviewed = closedGroups.filter((g) => {
    const note = state.reviewNotes[g.id]
    return !note || (!note.buyReason && !note.sellReason && !note.executionReview && !note.lesson)
  })
  if (unreviewed.length > 0) {
    alerts.push({
      severity: 'low',
      title: 'Unreviewed trades',
      detail: `${unreviewed.length} closed trade(s) have no review notes.`,
    })
  }

  if (alerts.length === 0) {
    alerts.push({
      severity: 'none',
      title: 'No risk signals',
      detail: 'No significant risk patterns detected in current data.',
    })
  }

  return { alerts, summary: { totalGroups: groups.length, closedGroups: closedGroups.length } }
}

export const getRiskAlerts: ToolModule = { schema, execute }
