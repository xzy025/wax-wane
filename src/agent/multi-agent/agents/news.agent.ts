import { BaseAgent } from './base.agent'
import type { AgentContext } from '../types'

/**
 * News Analyst Agent
 * Fetches and summarizes financial news.
 */
export class NewsAnalystAgent extends BaseAgent {
  readonly id = 'news-analyst'
  readonly name = '消息面分析师'
  readonly stepName = '消息面分析'
  protected toolName = 'getNewsSummary'

  protected getToolArgs(_context: AgentContext): Record<string, unknown> {
    return {}
  }

  protected postProcess(result: unknown): string {
    if (!Array.isArray(result)) return String(result)

    const headlines = result
      .slice(0, 10)
      .map((r: Record<string, unknown>, i: number) => `${i + 1}. ${r.title}`)
      .join('\n')

    return `今日要闻:\n${headlines}`
  }
}
