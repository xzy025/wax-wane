import type { AgentMiddleware, AgentContext } from '../pipeline.types'
import { compressMessages, compressToolResult } from '../../contextCompression'

/**
 * Context compression middleware.
 * Compresses message history and tool results to reduce token usage.
 */
export const compressionMiddleware: AgentMiddleware = {
  name: 'compression',
  order: 10,

  async before(context: AgentContext): Promise<AgentContext> {
    const compressed = compressMessages(context.messages)

    if (compressed.summary) {
      // Inject summary as a system message, keep recent messages
      const systemMsg = context.messages.find((m) => m.role === 'system')
      const nonSystem = compressed.recentMessages.filter((m) => m.role !== 'system')

      return {
        ...context,
        messages: [
          ...(systemMsg ? [systemMsg] : []),
          { role: 'system', content: `对话摘要:\n${compressed.summary}` },
          ...nonSystem,
        ],
        metadata: {
          ...context.metadata,
          compressionApplied: true,
          originalMessageCount: context.messages.length,
          compressedMessageCount: nonSystem.length + 1,
          estimatedTokens: compressed.estimatedTokens,
        },
      }
    }

    return context
  },

  async onToolCall(toolName, args, context) {
    // We don't intercept tool calls here, just pass through
    // Tool result compression happens in the agentLoop
    return { proceed: true }
  },
}
