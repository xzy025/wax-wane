import { BaseAgent } from './base.agent'
import type { AgentContext } from '../types'

/**
 * Market Analyst Agent
 * Fetches market breadth and index trends.
 */
export class MarketAnalystAgent extends BaseAgent {
  readonly id = 'market-analyst'
  readonly name = '大盘分析师'
  readonly stepName = '大盘走势分析'
  protected toolName = 'getMarketBreadth'

  protected getToolArgs(_context: AgentContext): Record<string, unknown> {
    return {}
  }

  protected postProcess(result: unknown): string {
    if (typeof result !== 'object' || !result) return String(result)
    const r = result as Record<string, unknown>

    return [
      `涨: ${r.advance}家 / 跌: ${r.decline}家`,
      `涨停: ${r.limitUpCount}家 / 跌停: ${r.limitDownCount}家`,
      `晋级率: ${r.promotionRate}%`,
    ].join('\n')
  }
}
