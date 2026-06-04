import type { AppState } from '../../../store'
import type { AgentResult } from '../types'
import { extractStockCode } from '../../utils'
import { PipelineContext } from '../pipeline/context'
import { TechnicalAgent } from '../agents/technical.agent'
import { FundamentalAgent } from '../agents/fundamental.agent'
import { StockNewsAgent } from '../agents/stock-news.agent'
import { SynthesizerAgent } from '../agents/synthesizer.agent'

/**
 * Stock Analysis Orchestrator
 * Runs 3 analysis agents in parallel (Technical, Fundamental, News),
 * then synthesizes results into a comprehensive stock analysis report.
 */
export class StockAnalysisOrchestrator {
  private analysisAgents = [
    new TechnicalAgent(),
    new FundamentalAgent(),
    new StockNewsAgent(),
  ]

  private synthesizer = new SynthesizerAgent()

  /**
   * Execute the stock analysis pipeline.
   * 3 agents run in parallel, then synthesizer combines results.
   */
  async *execute(
    appState: AppState,
    userMessage: string,
    language: 'zh' | 'en' = 'zh',
  ): AsyncGenerator<{ type: 'step_start' | 'step_result' | 'complete'; data: AgentResult | string }> {
    const ctx = new PipelineContext(userMessage, language)

    // Extract stock code and name from message
    const stockCode = extractStockCode(userMessage)
    const stockName = this.extractStockName(userMessage, appState)

    // Run analysis agents in parallel
    const agentCtx = {
      appState,
      userMessage,
      language,
      results: {},
      currentStep: '个股分析',
    }

    yield { type: 'step_start', data: `并行分析 ${stockName || stockCode}（技术面 + 基本面 + 消息面）` }

    const promises = this.analysisAgents.map(async (agent) => {
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
      userMessage: `综合以下三个维度的分析结果，给出${stockName || stockCode}的综合评价：\n\n` +
        `技术面分析:\n${ctx.getStepResult('技术面分析') || '无数据'}\n\n` +
        `基本面分析:\n${ctx.getStepResult('基本面分析') || '无数据'}\n\n` +
        `消息面分析:\n${ctx.getStepResult('消息面分析') || '无数据'}`,
      language,
      results: ctx.getAllResults(),
      currentStep: '综合分析',
    }

    const synthResult = await this.synthesizer.execute(synthCtx)
    ctx.addResult(synthResult)

    yield { type: 'step_result', data: synthResult }

    // Build final report
    const report = this.buildReport(ctx, stockCode, stockName)
    yield { type: 'complete', data: report }
  }

  private extractStockName(message: string, _appState: AppState): string {
    // Try to extract stock name from common patterns
    const patterns = [
      /分析(.{2,8}?)\s*(?:的|股票|走势|技术|基本面)/,
      /(.{2,8}?)\s*(?:怎么样|如何|值得|可以)/,
      /(?:帮我|请)?\s*分析\s*(.{2,8}?)(?:\s|$)/,
    ]
    for (const pattern of patterns) {
      const match = message.match(pattern)
      if (match) return match[1]
    }
    return ''
  }

  private buildReport(ctx: PipelineContext, stockCode: string, stockName: string): string {
    const results = ctx.getAllResults()
    const date = new Date().toLocaleDateString('zh-CN')
    const displayName = stockName || stockCode || '未知'

    const parts: string[] = []
    parts.push(`## 📊 个股分析报告 — ${displayName} — ${date}`)
    parts.push('')

    parts.push('### 一、技术面分析')
    parts.push(results['技术面分析'] ?? '未分析')
    parts.push('')

    parts.push('### 二、基本面分析')
    parts.push(results['基本面分析'] ?? '未分析')
    parts.push('')

    parts.push('### 三、消息面分析')
    parts.push(results['消息面分析'] ?? '未分析')
    parts.push('')

    parts.push('### 四、综合评价')
    parts.push(results['综合分析'] ?? '未分析')

    return parts.join('\n')
  }
}
