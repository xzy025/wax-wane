import type { AppState } from '../../store'
import type { AgentEvent } from '../types'
import { toolDefinitions, executeTool } from '../tools'
import { buildSystemPrompt } from '../prompts'
import { compressMessages } from '../contextCompression'
import type { DeepAgentConfig, DeepAgentEvent } from './types'

/**
 * Create a Wax Wane agent using DeepAgents-style architecture.
 *
 * This is a simplified implementation that follows DeepAgents patterns:
 * - Uses existing tools via the tool registry
 * - Supports planning via write_todos
 * - Supports sub-agent delegation via task
 * - Uses context compression for long conversations
 */
export async function* createTradeReviewAgent(
  userMessage: string,
  appState: AppState,
  conversationHistory: Array<{ role: string; content: string }>,
  config: DeepAgentConfig = {},
): AsyncGenerator<AgentEvent | DeepAgentEvent> {
  const startTime = Date.now()
  const {
    enablePlanning = true,
    enableSubAgents = true,
    maxIterations = 10,
  } = config

  // Build system prompt
  const systemPrompt = buildSystemPrompt(appState, 'zh')

  // Build messages
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ]

  // Apply context compression
  const compressed = compressMessages(messages)
  const workingMessages = compressed.summary
    ? [
        messages[0],
        { role: 'system', content: `对话摘要:\n${compressed.summary}` },
        ...compressed.recentMessages.filter((m) => m.role !== 'system'),
      ]
    : messages

  // Check if this is a structured request (复盘, 理论分析, etc.)
  const isStructured = isStructuredRequest(userMessage)

  if (isStructured && enablePlanning) {
    // Use planning mode for structured requests
    yield* executeWithPlanning(
      userMessage,
      appState,
      workingMessages,
      systemPrompt,
      maxIterations,
    )
  } else {
    // Use standard mode for free-form chat
    yield* executeStandard(
      userMessage,
      appState,
      workingMessages,
      systemPrompt,
      maxIterations,
    )
  }
}

/**
 * Check if the user message is a structured request.
 */
export function isStructuredRequest(message: string): boolean {
  const keywords = ['复盘', 'review', '理论分析', '一键复盘', '帮我复盘', '分析我的交易']
  const lower = message.toLowerCase()
  return keywords.some((kw) => lower.includes(kw))
}

/**
 * Execute with planning mode.
 * Creates a task list and executes each step.
 */
async function* executeWithPlanning(
  userMessage: string,
  appState: AppState,
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  maxIterations: number,
): AsyncGenerator<AgentEvent | DeepAgentEvent> {
  // Determine which orchestrator to use
  if (userMessage.includes('理论') || userMessage.includes('理论分析')) {
    yield* executeTheoryReview(appState, userMessage)
  } else {
    yield* executeStructuredReview(appState, userMessage)
  }
}

/**
 * Execute structured review using the multi-agent system.
 */
async function* executeStructuredReview(
  appState: AppState,
  userMessage: string,
): AsyncGenerator<AgentEvent | DeepAgentEvent> {
  const { StructuredReviewOrchestrator } = await import('../multi-agent/orchestrators/structured-review.orchestrator')
  const orchestrator = new StructuredReviewOrchestrator()

  for await (const event of orchestrator.execute(appState, userMessage, 'zh')) {
    if (event.type === 'step_start') {
      yield {
        type: 'tool_start',
        toolName: event.data as string,
        toolId: `review-${Date.now()}`,
      }
    } else if (event.type === 'step_result') {
      const result = event.data as { agentName: string; content: string; success: boolean }
      yield {
        type: 'tool_result',
        toolName: result.agentName,
        toolId: `review-${Date.now()}`,
        result: result.content,
      }
    } else if (event.type === 'complete') {
      yield { type: 'assistant_message', content: event.data as string }
      yield { type: 'done' }
    }
  }
}

/**
 * Execute theory review using the multi-agent system.
 */
async function* executeTheoryReview(
  appState: AppState,
  userMessage: string,
): AsyncGenerator<AgentEvent | DeepAgentEvent> {
  const { TheoryReviewOrchestrator } = await import('../multi-agent/orchestrators/theory-review.orchestrator')
  const orchestrator = new TheoryReviewOrchestrator()

  for await (const event of orchestrator.execute(appState, userMessage, 'zh')) {
    if (event.type === 'step_start') {
      yield {
        type: 'tool_start',
        toolName: event.data as string,
        toolId: `theory-${Date.now()}`,
      }
    } else if (event.type === 'step_result') {
      const result = event.data as { agentName: string; content: string; success: boolean }
      yield {
        type: 'tool_result',
        toolName: result.agentName,
        toolId: `theory-${Date.now()}`,
        result: result.content,
      }
    } else if (event.type === 'complete') {
      yield { type: 'assistant_message', content: event.data as string }
      yield { type: 'done' }
    }
  }
}

/**
 * Execute standard (non-planning) mode.
 * Uses the existing agent loop with tools.
 */
async function* executeStandard(
  userMessage: string,
  appState: AppState,
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  maxIterations: number,
): AsyncGenerator<AgentEvent | DeepAgentEvent> {
  // Import the existing agent loop components
  const { streamChat } = await import('../llmClient')
  const { compressToolResult } = await import('../contextCompression')

  let iteration = 0
  const workingMessages = [...messages]

  while (iteration < maxIterations) {
    iteration++

    let content = ''
    let toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> = []

    try {
      const stream = streamChat(
        workingMessages as Array<{
          role: 'system' | 'user' | 'assistant' | 'tool'
          content: string
          tool_call_id?: string
          tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
        }>,
        toolDefinitions,
      )

      for await (const chunk of stream) {
        if (chunk.type === 'token') {
          content += chunk.data
          yield { type: 'token', content: chunk.data }
        } else if (chunk.type === 'tool_calls') {
          toolCalls = chunk.data as typeof toolCalls
        }
      }
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      }
      return
    }

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      yield { type: 'assistant_message', content }
      yield { type: 'done' }
      return
    }

    // Execute tool calls
    const assistantMessage = {
      role: 'assistant',
      content,
      tool_calls: toolCalls,
    }
    workingMessages.push(assistantMessage as { role: string; content: string })

    for (const toolCall of toolCalls) {
      yield {
        type: 'tool_start',
        toolName: toolCall.function.name,
        toolId: toolCall.id,
      }

      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(toolCall.function.arguments)
      } catch {
        // Empty args
      }

      const result = await executeTool(toolCall.function.name, args, appState)

      yield {
        type: 'tool_result',
        toolName: toolCall.function.name,
        toolId: toolCall.id,
        result,
      }

      // Compress tool result before adding to context
      const compressedResult = compressToolResult(toolCall.function.name, result)

      workingMessages.push({
        role: 'tool',
        content: compressedResult,
      })
    }
  }

  // If we hit max iterations, make one final call
  try {
    let finalContent = ''
    const finalMessages = [
      ...workingMessages,
      {
        role: 'user',
        content: 'Please provide your final analysis based on the data you have gathered.',
      },
    ]

    const stream = streamChat(
      finalMessages as Array<{
        role: 'system' | 'user' | 'assistant' | 'tool'
        content: string
        tool_call_id?: string
        tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
      }>,
      [],
    )

    for await (const chunk of stream) {
      if (chunk.type === 'token') {
        finalContent += chunk.data
        yield { type: 'token', content: chunk.data }
      }
    }

    yield { type: 'assistant_message', content: finalContent }
    yield { type: 'done' }
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
