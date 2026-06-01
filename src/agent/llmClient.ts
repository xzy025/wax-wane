import type { AgentMessage, ToolDefinition, SSEChunk, ToolCall } from './types'

const API_URL = '/api/agent/chat'

export interface StreamChatResult {
  content: string
  toolCalls: ToolCall[]
}

export type StreamChunk =
  | { readonly type: 'token'; readonly data: string }
  | { readonly type: 'tool_calls'; readonly data: ToolCall[] }
  | { readonly type: 'done'; readonly data: string }

export interface LLMConfig {
  id?: string
}

export async function* streamChat(
  messages: AgentMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal,
  llmConfig?: LLMConfig,
): AsyncGenerator<StreamChunk> {
  const body: Record<string, unknown> = { messages, tools }
  if (llmConfig) {
    body.llmConfig = llmConfig
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`LLM API error (${response.status}): ${error}`)
  }

  if (!response.body) {
    throw new Error('LLM API response body is null')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Accumulate tool calls across chunks
  const toolCallAccumulator: Map<number, { id: string; name: string; arguments: string }> =
    new Map()
  let fullContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue

      const data = trimmed.slice(6)
      if (data === '[DONE]') {
        // Yield accumulated tool calls if any
        if (toolCallAccumulator.size > 0) {
          const calls: ToolCall[] = Array.from(toolCallAccumulator.entries())
            .sort(([a], [b]) => a - b)
            .map(([, v]) => ({
              id: v.id,
              type: 'function' as const,
              function: { name: v.name, arguments: v.arguments },
            }))
          yield { type: 'tool_calls', data: calls }
        }
        yield { type: 'done', data: fullContent }
        return
      }

      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }

      if (typeof parsed.error === 'string') {
        throw new Error(`SSE error: ${parsed.error}`)
      }

      const delta = (parsed as SSEChunk).choices?.[0]?.delta
      if (!delta) continue

      // Stream text content
      if (delta.content) {
        fullContent += delta.content
        yield { type: 'token', data: delta.content }
      }

      // Accumulate tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallAccumulator.get(tc.index)
          if (existing) {
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name = tc.function.name
            if (tc.function?.arguments) existing.arguments += tc.function.arguments
          } else {
            toolCallAccumulator.set(tc.index, {
              id: tc.id ?? '',
              name: tc.function?.name ?? '',
              arguments: tc.function?.arguments ?? '',
            })
          }
        }
      }
    }
  }

  // If we reach here without [DONE], yield what we have
  if (toolCallAccumulator.size > 0) {
    const calls: ToolCall[] = Array.from(toolCallAccumulator.entries())
      .sort(([a], [b]) => a - b)
      .map(([, v]) => ({
        id: v.id,
        type: 'function' as const,
        function: { name: v.name, arguments: v.arguments },
      }))
    yield { type: 'tool_calls', data: calls }
  }
  yield { type: 'done', data: fullContent }
}
