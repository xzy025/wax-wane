import type { ToolModule } from '../types'
import { TheoryReviewOrchestrator } from '../multi-agent/orchestrators/theory-review.orchestrator'

export const runTheoryReview: ToolModule = {
  schema: {
    name: 'runTheoryReview',
    description: '执行理论引导复盘流程。并行调用 Wyckoff、道氏、价格行为、A股情绪 4 个理论 Agent，综合分析后生成报告。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  execute: async (_args, state) => {
    const orchestrator = new TheoryReviewOrchestrator()
    const results: string[] = []

    for await (const event of orchestrator.execute(state, '理论分析', 'zh')) {
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
