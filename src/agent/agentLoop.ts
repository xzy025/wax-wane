import type { AppState } from '../store'
import type { AgentMessage, AgentEvent, ToolCall } from './types'
import { toolDefinitions, executeTool } from './tools'
import { buildSystemPrompt } from './prompts'
import { streamChat, type LLMConfig } from './llmClient'
import { compressMessages, compressToolResult } from './contextCompression'

const MAX_ITERATIONS = 10

export async function* runAgent(
  userMessage: string,
  appState: AppState,
  conversationHistory: AgentMessage[],
  language: 'zh' | 'en' = 'zh',
  signal?: AbortSignal,
  llmConfig?: LLMConfig,
  images?: string[],
  selectedPatterns?: string[],
): AsyncGenerator<AgentEvent> {
  const systemPrompt = buildSystemPrompt(appState, language, selectedPatterns)

  const messages: AgentMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage, images },
  ]

  // Apply context compression if messages are large
  const compressed = compressMessages(messages)
  const workingMessages = compressed.summary
    ? [
        messages[0], // system prompt
        { role: 'system' as const, content: `对话摘要:\n${compressed.summary}` },
        ...compressed.recentMessages.filter((m) => m.role !== 'system'),
      ]
    : messages

  let iteration = 0

  while (iteration < MAX_ITERATIONS) {
    iteration++

    let content = ''
    let toolCalls: ToolCall[] = []

    try {
      signal?.throwIfAborted()
      const stream = streamChat(workingMessages, toolDefinitions, signal, llmConfig)

      for await (const chunk of stream) {
        signal?.throwIfAborted()
        if (chunk.type === 'token') {
          content += chunk.data
          yield { type: 'token', content: chunk.data }
        } else if (chunk.type === 'tool_calls') {
          toolCalls = chunk.data
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      yield { type: 'error', message: err instanceof Error ? err.message : 'Unknown error' }
      return
    }

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      yield { type: 'assistant_message', content }
      return
    }

    // Execute tool calls
    const assistantMessage: AgentMessage = {
      role: 'assistant',
      content,
      tool_calls: toolCalls,
    }
    workingMessages.push(assistantMessage)

    for (const toolCall of toolCalls) {
      yield { type: 'tool_start', toolName: toolCall.function.name, toolId: toolCall.id }

      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(toolCall.function.arguments)
      } catch {
        // Empty args
      }

      const result = await executeTool(toolCall.function.name, args, appState)

      yield { type: 'tool_result', toolName: toolCall.function.name, toolId: toolCall.id, result }

      // Compress tool result before adding to context
      const compressedResult = compressToolResult(toolCall.function.name, result)

      workingMessages.push({
        role: 'tool',
        content: compressedResult,
        tool_call_id: toolCall.id,
      })
    }
  }

  // If we hit max iterations, make one final call without tools
  try {
    signal?.throwIfAborted()
    let finalContent = ''
    const finalMessages: AgentMessage[] = [
      ...workingMessages,
      {
        role: 'user',
        content: 'Please provide your final analysis based on the data you have gathered.',
      },
    ]

    const stream = streamChat(finalMessages, [], signal, llmConfig)
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      if (chunk.type === 'token') {
        finalContent += chunk.data
        yield { type: 'token', content: chunk.data }
      }
    }
    yield { type: 'assistant_message', content: finalContent }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    yield { type: 'error', message: err instanceof Error ? err.message : 'Unknown error' }
  }
}
