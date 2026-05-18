import type { AppState } from '../store'
import type { AgentMessage, AgentEvent, ToolCall } from './types'
import { toolDefinitions, executeTool } from './tools'
import { buildSystemPrompt } from './prompts'
import { streamChat } from './llmClient'

const MAX_ITERATIONS = 5

export async function* runAgent(
  userMessage: string,
  appState: AppState,
  conversationHistory: AgentMessage[],
  language: 'zh' | 'en' = 'zh',
): AsyncGenerator<AgentEvent> {
  const systemPrompt = buildSystemPrompt(appState, language)

  const messages: AgentMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ]

  let iteration = 0

  while (iteration < MAX_ITERATIONS) {
    iteration++

    let content = ''
    let toolCalls: ToolCall[] = []

    try {
      const stream = streamChat(messages, toolDefinitions)

      for await (const chunk of stream) {
        if (chunk.type === 'token') {
          content += chunk.data as string
          yield { type: 'token', content: chunk.data as string }
        } else if (chunk.type === 'tool_calls') {
          toolCalls = chunk.data as ToolCall[]
        }
      }
    } catch (err) {
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
    messages.push(assistantMessage)

    for (const toolCall of toolCalls) {
      yield { type: 'tool_start', toolName: toolCall.function.name, toolId: toolCall.id }

      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(toolCall.function.arguments)
      } catch {
        // Empty args
      }

      const result = executeTool(toolCall.function.name, args, appState)

      yield { type: 'tool_result', toolName: toolCall.function.name, toolId: toolCall.id, result }

      messages.push({
        role: 'tool',
        content: JSON.stringify(result),
        tool_call_id: toolCall.id,
      })
    }
  }

  // If we hit max iterations, make one final call without tools
  try {
    let finalContent = ''
    const finalMessages: AgentMessage[] = [
      ...messages,
      { role: 'user', content: 'Please provide your final analysis based on the data you have gathered.' },
    ]

    const stream = streamChat(finalMessages, [])
    for await (const chunk of stream) {
      if (chunk.type === 'token') {
        finalContent += chunk.data as string
        yield { type: 'token', content: chunk.data as string }
      }
    }
    yield { type: 'assistant_message', content: finalContent }
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : 'Unknown error' }
  }
}
