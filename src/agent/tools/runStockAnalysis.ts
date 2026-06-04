import type { ToolModule } from '../types'
import { StockAnalysisOrchestrator } from '../multi-agent/orchestrators/stock-analysis.orchestrator'

export const runStockAnalysis: ToolModule = {
  schema: {
    name: 'runStockAnalysis',
    description:
      '执行个股多维度分析。并行调用技术面（Wyckoff/道氏/Al Brooks）、基本面、消息面 3 个 Agent，综合分析后生成报告。' +
      '当用户提到具体股票代码或名称，要求分析时使用。' +
      '参数 stockCode 为6位股票代码。',
    parameters: {
      type: 'object',
      properties: {
        stockCode: {
          type: 'string',
          description: '6位股票代码，如 "300750"',
        },
      },
      required: ['stockCode'],
    },
  },

  execute: async (args, state) => {
    const code = typeof args.stockCode === 'string' ? args.stockCode : ''
    if (!code || !/^\d{6}$/.test(code)) {
      return { error: '请提供6位股票代码，如 "300750"' }
    }

    const orchestrator = new StockAnalysisOrchestrator()
    const results: string[] = []

    for await (const event of orchestrator.execute(state, `分析${code}`, 'zh')) {
      if (event.type === 'step_result') {
        const r = event.data as { agentName: string; content: string; success: boolean }
        if (r.success) {
          results.push(`### ${r.agentName}\n${r.content}`)
        }
      }
      if (event.type === 'complete') {
        return event.data
      }
    }

    return results.join('\n\n')
  },
}
