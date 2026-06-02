import { BaseAgent } from './base.agent'
import type { AgentContext } from '../types'

/**
 * Dow Agent
 * Analyzes market using Dow Theory.
 */
export class DowAgent extends BaseAgent {
  readonly id = 'dow'
  readonly name = '道氏理论分析师'
  readonly stepName = 'dow'
  protected toolName = 'analyzeWithTheory'

  protected getToolArgs(_context: AgentContext): Record<string, unknown> {
    return { analysisType: 'dow' }
  }

  protected postProcess(result: unknown): string {
    if (typeof result !== 'object' || !result) return String(result)
    const r = result as Record<string, unknown>

    const parts = [`**道氏趋势**: ${r.trend ?? 'N/A'}`]
    if (r.analysis) parts.push(r.analysis as string)
    if (r.supportResistance) parts.push(`支撑阻力: ${r.supportResistance}`)

    return parts.join('\n')
  }
}
