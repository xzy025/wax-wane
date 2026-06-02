import type { AppState } from '../../../store'
import type { AgentResult } from '../types'
import { PipelineContext } from '../pipeline/context'
import { MacroAnalystAgent } from '../agents/macro.agent'
import { NewsAnalystAgent } from '../agents/news.agent'
import { MarketAnalystAgent } from '../agents/market.agent'
import { SectorAnalystAgent } from '../agents/sector.agent'
import { TradeReviewerAgent } from '../agents/trade-reviewer.agent'

/**
 * Structured Review Orchestrator
 * Runs 5 sub-agents sequentially: Macro → News → Market → Sector → Trade
 */
export class StructuredReviewOrchestrator {
  private agents = [
    new MacroAnalystAgent(),
    new NewsAnalystAgent(),
    new MarketAnalystAgent(),
    new SectorAnalystAgent(),
    new TradeReviewerAgent(),
  ]

  /**
   * Execute the structured review pipeline.
   * Yields intermediate results for each step.
   */
  async *execute(
    appState: AppState,
    userMessage: string,
    language: 'zh' | 'en' = 'zh',
  ): AsyncGenerator<{ type: 'step_start' | 'step_result' | 'complete'; data: AgentResult | string }> {
    const ctx = new PipelineContext(userMessage, language)

    for (const agent of this.agents) {
      yield { type: 'step_start', data: agent.name }

      const agentCtx = {
        appState,
        userMessage,
        language,
        results: ctx.getAllResults(),
        currentStep: agent.stepName,
      }

      const result = await agent.execute(agentCtx)
      ctx.addResult(result)

      yield { type: 'step_result', data: result }

      // If a required step fails, stop
      if (!result.success) {
        yield {
          type: 'complete',
          data: `复盘流程中断: ${agent.name} 执行失败 — ${result.error}`,
        }
        return
      }
    }

    // Build final report
    const report = this.buildReport(ctx)
    yield { type: 'complete', data: report }
  }

  private buildReport(ctx: PipelineContext): string {
    const results = ctx.getAllResults()
    const date = new Date().toLocaleDateString('zh-CN')

    const parts: string[] = []
    parts.push(`## 📊 每日复盘报告 — ${date}`)
    parts.push('')
    parts.push('### 一、宏观面')
    parts.push(results['宏观面分析'] ?? '未获取')
    parts.push('')
    parts.push('### 二、消息面')
    parts.push(results['消息面分析'] ?? '未获取')
    parts.push('')
    parts.push('### 三、大盘走势')
    parts.push(results['大盘走势分析'] ?? '未获取')
    parts.push('')
    parts.push('### 四、板块热点')
    parts.push(results['板块热点分析'] ?? '未获取')
    parts.push('')
    parts.push('### 五、交易复盘')
    parts.push(results['交易复盘分析'] ?? '未获取')

    return parts.join('\n')
  }
}
