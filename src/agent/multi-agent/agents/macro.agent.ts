import { BaseAgent } from './base.agent'
import type { AgentContext } from '../types'

/**
 * Macro Analyst Agent
 * Fetches and analyzes macro economic indicators.
 */
export class MacroAnalystAgent extends BaseAgent {
  readonly id = 'macro-analyst'
  readonly name = '宏观分析师'
  readonly stepName = '宏观面分析'
  protected toolName = 'getMacroIndicators'

  protected getToolArgs(_context: AgentContext): Record<string, unknown> {
    return {}
  }

  protected postProcess(result: unknown): string {
    if (typeof result !== 'object' || !result) return String(result)
    const r = result as Record<string, unknown>

    const lines = [
      `美债10Y: ${r.usTreasury10y ?? 'N/A'}`,
      `黄金: ${r.gold ?? 'N/A'}`,
      `美元指数: ${r.usdIndex ?? 'N/A'}`,
      `汇率: ${r.usdcny ?? 'N/A'}`,
      `原油: ${r.crudeOil ?? 'N/A'}`,
      `VIX: ${r.vix ?? 'N/A'}`,
    ]

    return lines.join('\n')
  }
}
