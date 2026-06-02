import { BaseAgent } from './base.agent'
import type { AgentContext } from '../types'

/**
 * Al Brooks Agent
 * Analyzes market using Price Action theory.
 */
export class AlBrooksAgent extends BaseAgent {
  readonly id = 'albrooks'
  readonly name = '价格行为分析师'
  readonly stepName = 'priceAction'
  protected toolName = 'analyzeWithTheory'

  protected getToolArgs(_context: AgentContext): Record<string, unknown> {
    return { analysisType: 'priceAction' }
  }

  protected postProcess(result: unknown): string {
    if (typeof result !== 'object' || !result) return String(result)
    const r = result as Record<string, unknown>

    const parts = [`**价格行为信号**: ${r.signal ?? 'N/A'}`]
    if (r.analysis) parts.push(r.analysis as string)
    if (r.patterns) parts.push(`K线形态: ${r.patterns}`)

    return parts.join('\n')
  }
}
