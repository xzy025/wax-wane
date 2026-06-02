import type { ToolModule } from '../types'
import { StructuredReviewOrchestrator } from '../multi-agent/orchestrators/structured-review.orchestrator'

export const runStructuredReview: ToolModule = {
  schema: {
    name: 'runStructuredReview',
    description: '执行结构化复盘流程。自动调用宏观、消息面、大盘、板块、交易复盘 5 个子 Agent，生成完整的每日复盘报告。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  execute: async (_args, state) => {
    const orchestrator = new StructuredReviewOrchestrator()
    const results: string[] = []

    for await (const event of orchestrator.execute(state, '复盘', 'zh')) {
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
