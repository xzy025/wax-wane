import { BaseAgent } from './base.agent'
import type { AgentContext } from '../types'

/**
 * Trade Reviewer Agent
 * Reviews user's trades in the context of market conditions.
 */
export class TradeReviewerAgent extends BaseAgent {
  readonly id = 'trade-reviewer'
  readonly name = '交易复盘分析师'
  readonly stepName = '交易复盘分析'
  protected toolName = 'queryTradeHistory'

  protected getToolArgs(_context: AgentContext): Record<string, unknown> {
    return {}
  }

  protected postProcess(result: unknown, context: AgentContext): string {
    if (typeof result !== 'object' || !result) return String(result)
    const r = result as Record<string, unknown>
    const trades = Array.isArray(r.trades) ? r.trades : []

    const lines = [`今日交易 ${trades.length} 笔`]

    // Add context from previous steps
    const macro = context.results['宏观面分析']
    const market = context.results['大盘走势分析']

    if (macro || market) {
      lines.push('\n结合市场环境分析:')
      if (macro) lines.push(`- 宏观面: ${macro.substring(0, 100)}`)
      if (market) lines.push(`- 大盘: ${market.substring(0, 100)}`)
    }

    return lines.join('\n')
  }
}
