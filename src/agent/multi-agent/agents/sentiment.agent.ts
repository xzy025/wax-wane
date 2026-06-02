import { BaseAgent } from './base.agent'
import type { AgentContext } from '../types'

/**
 * Sentiment Agent
 * Analyzes A-share market sentiment cycle.
 */
export class SentimentAgent extends BaseAgent {
  readonly id = 'sentiment'
  readonly name = 'A股情绪分析师'
  readonly stepName = 'sentiment'
  protected toolName = 'analyzeWithTheory'

  protected getToolArgs(_context: AgentContext): Record<string, unknown> {
    return { analysisType: 'sentiment' }
  }

  protected postProcess(result: unknown): string {
    if (typeof result !== 'object' || !result) return String(result)
    const r = result as Record<string, unknown>

    const parts = [`**情绪阶段**: ${r.phase ?? 'N/A'}`]
    if (r.analysis) parts.push(r.analysis as string)
    if (r.indicators) parts.push(`情绪指标: ${r.indicators}`)

    return parts.join('\n')
  }
}
