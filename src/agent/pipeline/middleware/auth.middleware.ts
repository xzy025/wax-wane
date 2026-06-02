import type { AgentMiddleware, AgentContext, AgentResponse } from '../pipeline.types'

/**
 * Authentication middleware.
 * Validates that the request has a valid userId.
 */
export const authMiddleware: AgentMiddleware = {
  name: 'auth',
  order: 0,

  async before(context: AgentContext): Promise<AgentContext> {
    if (!context.userId) {
      throw new Error('Unauthorized: userId is required')
    }
    return context
  },

  async onError(error: Error, _context: AgentContext): Promise<AgentResponse | null> {
    if (error.message.startsWith('Unauthorized')) {
      return {
        content: `认证失败: ${error.message}`,
        duration: 0,
      }
    }
    return null
  },
}
