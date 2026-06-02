import type { AppState } from '../store'
import type { AgentMessage, AgentEvent } from './types'
import type { DeepAgentConfig, DeepAgentEvent } from './deep-agents/types'
import { createTradeReviewAgent } from './deep-agents/agent'

/**
 * Agent Loop V2 — DeepAgents-powered agent loop.
 *
 * This is a drop-in replacement for the original agentLoop.ts that uses
 * the DeepAgents integration for:
 * - Automatic planning for structured requests (复盘, 理论分析)
 * - Multi-agent orchestration
 * - Context compression
 * - Tool result caching
 *
 * For free-form chat, it falls back to the standard agent loop.
 */
export async function* runAgentV2(
  userMessage: string,
  appState: AppState,
  conversationHistory: AgentMessage[],
  language: 'zh' | 'en' = 'zh',
  signal?: AbortSignal,
  llmConfig?: { id?: string },
  images?: string[],
): AsyncGenerator<AgentEvent> {
  const config: DeepAgentConfig = {
    llmId: llmConfig?.id,
    enablePlanning: true,
    enableSubAgents: true,
    enableFilesystem: false,
    maxIterations: 10,
  }

  try {
    const generator = createTradeReviewAgent(
      userMessage,
      appState,
      conversationHistory.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      config,
    )

    for await (const event of generator) {
      // Check abort signal
      if (signal?.aborted) {
        return
      }

      // Convert DeepAgentEvent to AgentEvent if needed
      yield event as AgentEvent
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
