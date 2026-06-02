import { BaseAgent } from './base.agent'
import type { AgentContext } from '../types'

/**
 * Sector Analyst Agent
 * Analyzes sector hotspots and limit pool.
 */
export class SectorAnalystAgent extends BaseAgent {
  readonly id = 'sector-analyst'
  readonly name = '板块分析师'
  readonly stepName = '板块热点分析'
  protected toolName = 'getLimitPool'

  protected getToolArgs(_context: AgentContext): Record<string, unknown> {
    return { direction: 'up' }
  }

  protected postProcess(result: unknown): string {
    if (typeof result !== 'object' || !result) return String(result)
    const r = result as Record<string, unknown>
    const stocks = Array.isArray(r.stocks) ? r.stocks : []
    const top = stocks
      .slice(0, 10)
      .map((s: Record<string, unknown>) => `${s.name}(${s.code})`)
      .join(', ')

    return `涨停 ${r.count} 家: ${top}`
  }
}
