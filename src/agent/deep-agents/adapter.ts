import type { AppState } from '../../store'
import type { ToolModule } from '../types'
import { toolDefinitions, executeTool } from '../tools'
import { buildSystemPrompt } from '../prompts'
import type { DeepAgentConfig, DeepAgentEvent } from './types'

/**
 * Adapter that bridges the existing Wax Wane tool system
 * with the DeepAgents framework.
 */
export class DeepAgentAdapter {
  private appState: AppState
  private config: DeepAgentConfig

  constructor(appState: AppState, config: DeepAgentConfig = {}) {
    this.appState = appState
    this.config = {
      enablePlanning: true,
      enableSubAgents: true,
      enableFilesystem: false,
      maxIterations: 10,
      ...config,
    }
  }

  /**
   * Get tool definitions in the format expected by DeepAgents/LangChain.
   */
  getToolDefinitions(): Array<{
    name: string
    description: string
    parameters: Record<string, unknown>
  }> {
    return toolDefinitions.map((def) => ({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    }))
  }

  /**
   * Execute a tool by name with the given arguments.
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return executeTool(name, args, this.appState)
  }

  /**
   * Get the system prompt with context.
   */
  getSystemPrompt(): string {
    return buildSystemPrompt(this.appState, 'zh')
  }

  /**
   * Get the current config.
   */
  getConfig(): DeepAgentConfig {
    return { ...this.config }
  }

  /**
   * Get the app state.
   */
  getAppState(): AppState {
    return this.appState
  }
}
