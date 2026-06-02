import type { AppState } from '../../../store'
import type { AgentResult } from '../types'
import { PipelineContext } from '../pipeline/context'
import { WyckoffAgent } from '../agents/wyckoff.agent'
import { DowAgent } from '../agents/dow.agent'
import { AlBrooksAgent } from '../agents/albrooks.agent'
import { SentimentAgent } from '../agents/sentiment.agent'
import { SynthesizerAgent } from '../agents/synthesizer.agent'

/**
 * Theory Review Orchestrator
 * Runs 4 theory agents in parallel, then synthesizes results.
 */
export class TheoryReviewOrchestrator {
  private theoryAgents = [
    new WyckoffAgent(),
    new DowAgent(),
    new AlBrooksAgent(),
    new SentimentAgent(),
  ]

  private synthesizer = new SynthesizerAgent()

  /**
   * Execute the theory review pipeline.
   * Theory agents run in parallel, then synthesizer combines results.
   */
  async *execute(
    appState: AppState,
    userMessage: string,
    language: 'zh' | 'en' = 'zh',
  ): AsyncGenerator<{ type: 'step_start' | 'step_result' | 'complete'; data: AgentResult | string }> {
    const ctx = new PipelineContext(userMessage, language)

    // Run theory agents in parallel
    const agentCtx = {
      appState,
      userMessage,
      language,
      results: {},
      currentStep: '理论分析',
    }

    yield { type: 'step_start', data: '并行理论分析 (Wyckoff, 道氏, 价格行为, 情绪)' }

    const promises = this.theoryAgents.map(async (agent) => {
      const result = await agent.execute(agentCtx)
      ctx.addResult(result)
      return result
    })

    const results = await Promise.all(promises)

    for (const result of results) {
      yield { type: 'step_result', data: result }
    }

    // Run synthesizer
    yield { type: 'step_start', data: '综合分析' }

    const synthCtx = {
      appState,
      userMessage,
      language,
      results: ctx.getAllResults(),
      currentStep: '综合分析',
    }

    const synthResult = await this.synthesizer.execute(synthCtx)
    ctx.addResult(synthResult)

    yield { type: 'step_result', data: synthResult }

    // Build final report
    const report = this.buildReport(ctx)
    yield { type: 'complete', data: report }
  }

  private buildReport(ctx: PipelineContext): string {
    const results = ctx.getAllResults()
    const date = new Date().toLocaleDateString('zh-CN')

    const parts: string[] = []
    parts.push(`## 📚 理论引导复盘报告 — ${date}`)
    parts.push('')
    parts.push('### 一、市场理论分析')
    parts.push('')
    parts.push('**Wyckoff 量价理论**')
    parts.push(results['wyckoff'] ?? '未分析')
    parts.push('')
    parts.push('**道氏理论**')
    parts.push(results['dow'] ?? '未分析')
    parts.push('')
    parts.push('**Al Brooks 价格行为**')
    parts.push(results['priceAction'] ?? '未分析')
    parts.push('')
    parts.push('**A股情绪周期**')
    parts.push(results['sentiment'] ?? '未分析')
    parts.push('')
    parts.push('### 二、综合分析')
    parts.push(results['综合分析'] ?? '未分析')

    return parts.join('\n')
  }
}
