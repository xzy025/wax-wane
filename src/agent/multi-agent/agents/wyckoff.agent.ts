import { BaseAgent } from './base.agent'
import type { AgentContext } from '../types'

/**
 * Wyckoff Agent
 * Analyzes market using Wyckoff Volume-Price theory.
 */
export class WyckoffAgent extends BaseAgent {
  readonly id = 'wyckoff'
  readonly name = 'Wyckoff 分析师'
  readonly stepName = 'wyckoff'
  protected toolName = 'analyzeWithTheory'

  protected getToolArgs(_context: AgentContext): Record<string, unknown> {
    return { analysisType: 'wyckoff' }
  }

  protected postProcess(result: unknown): string {
    if (typeof result !== 'object' || !result) return String(result)
    const r = result as Record<string, unknown>

    const parts = [`**Wyckoff 阶段**: ${r.phase ?? 'N/A'}`]
    if (r.analysis) parts.push(r.analysis as string)
    if (r.volumeAnalysis) parts.push(`成交量分析: ${r.volumeAnalysis}`)

    return parts.join('\n')
  }
}
