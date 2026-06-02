import type { AgentMiddleware, AgentContext, AgentResponse } from '../pipeline.types'

/**
 * Memory injection middleware.
 * Injects user memory (trading profile, conversation summary) into the context.
 * After the conversation, updates the summary if needed.
 */
export const memoryMiddleware: AgentMiddleware = {
  name: 'memory',
  order: 5,

  async before(context: AgentContext): Promise<AgentContext> {
    // Try to load memory from server (if available)
    try {
      const res = await fetch(`/api/memory/${context.userId}`)
      if (res.ok) {
        const memory = await res.json()

        const memoryParts: string[] = []

        // Trading profile
        if (memory.tradingProfile) {
          const p = memory.tradingProfile
          if (p.tradingStyle && p.tradingStyle !== 'unknown') {
            memoryParts.push(`交易风格: ${p.tradingStyle}`)
          }
          if (p.commonMistakes?.length > 0) {
            memoryParts.push(`常见问题: ${p.commonMistakes.join('、')}`)
          }
          if (p.strengths?.length > 0) {
            memoryParts.push(`优势: ${p.strengths.join('、')}`)
          }
          if (p.weaknesses?.length > 0) {
            memoryParts.push(`弱项: ${p.weaknesses.join('、')}`)
          }
        }

        // Active improvement plans
        if (memory.improvementPlans?.length > 0) {
          const active = memory.improvementPlans.filter(
            (p: { status: string }) => p.status === 'active',
          )
          if (active.length > 0) {
            memoryParts.push(
              `当前改进计划: ${active.map((p: { focusArea: string }) => p.focusArea).join('、')}`,
            )
          }
        }

        // Conversation summary
        if (memory.conversationSummary) {
          memoryParts.push(`上次对话摘要: ${memory.conversationSummary}`)
        }

        if (memoryParts.length > 0) {
          const systemMsg = context.messages.find((m) => m.role === 'system')
          const others = context.messages.filter((m) => m.role !== 'system')

          return {
            ...context,
            messages: [
              ...(systemMsg ? [systemMsg] : []),
              {
                role: 'system',
                content: `用户画像:\n${memoryParts.join('\n')}`,
              },
              ...others,
            ],
            metadata: {
              ...context.metadata,
              memoryLoaded: true,
            },
          }
        }
      }
    } catch {
      // Memory loading is optional — don't fail the request
    }

    return context
  },

  async after(context: AgentContext, response: AgentResponse): Promise<AgentResponse> {
    // Auto-update conversation summary after every 10+ message conversation
    const messageCount = context.messages.length
    if (messageCount >= 10 && messageCount % 5 === 0) {
      try {
        // Extract key points from the conversation
        const userQuestions = context.messages
          .filter((m) => m.role === 'user')
          .map((m) => (typeof m.content === 'string' ? m.content.substring(0, 100) : ''))
          .filter(Boolean)
          .slice(-3)

        const summary = userQuestions.join('; ')

        await fetch(`/api/memory/${context.userId}/summary`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary }),
        })
      } catch {
        // Don't fail the response if memory update fails
      }
    }

    return response
  },
}
