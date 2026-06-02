import type { SubAgent, AgentContext, AgentResult } from '../types'

/**
 * Base class for sub-agents.
 * Provides common functionality for tool execution and result formatting.
 *
 * Note: Uses lazy import of executeTool to avoid circular dependencies.
 */
export abstract class BaseAgent implements SubAgent {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly stepName: string

  /** Tool to call (override in subclass) */
  protected abstract toolName: string

  /** Arguments for the tool (override for dynamic args) */
  protected abstract getToolArgs(context: AgentContext): Record<string, unknown>

  /** Post-process the tool result (override for custom formatting) */
  protected postProcess(result: unknown, context: AgentContext): string {
    if (typeof result === 'string') return result
    return JSON.stringify(result, null, 2)
  }

  /** Execute the agent */
  async execute(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now()

    try {
      // Lazy import to avoid circular dependency
      const { executeTool } = await import('../../tools')
      const args = this.getToolArgs(context)
      const rawResult = await executeTool(this.toolName, args, context.appState)
      const content = this.postProcess(rawResult, context)

      return {
        agentId: this.id,
        agentName: this.name,
        stepName: this.stepName,
        content,
        success: true,
        duration: Date.now() - startTime,
      }
    } catch (err) {
      return {
        agentId: this.id,
        agentName: this.name,
        stepName: this.stepName,
        content: '',
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        duration: Date.now() - startTime,
      }
    }
  }
}
