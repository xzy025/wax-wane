import { describe, it, expect, vi, beforeEach } from 'vitest'
import { streamChat } from './llmClient'
import type { AgentMessage, ToolDefinition } from './types'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

describe('streamChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('streams text tokens', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ]

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createSSEStream(sseData),
    })

    const messages: AgentMessage[] = [{ role: 'user', content: 'test' }]
    const chunks: string[] = []

    for await (const chunk of streamChat(messages, [])) {
      if (chunk.type === 'token') {
        chunks.push(chunk.data)
      }
    }

    expect(chunks).toEqual(['Hello', ' world'])
  })

  it('handles tool calls', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"testTool"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"a\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createSSEStream(sseData),
    })

    const messages: AgentMessage[] = [{ role: 'user', content: 'test' }]
    const toolCalls: unknown[] = []

    for await (const chunk of streamChat(messages, [])) {
      if (chunk.type === 'tool_calls') {
        toolCalls.push(...chunk.data)
      }
    }

    expect(toolCalls).toHaveLength(1)
    expect((toolCalls[0] as Record<string, unknown>).id).toBe('call_1')
    expect(((toolCalls[0] as Record<string, unknown>).function as Record<string, unknown>).name).toBe('testTool')
    expect(((toolCalls[0] as Record<string, unknown>).function as Record<string, unknown>).arguments).toBe('{"a":1}')
  })

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal server error',
    })

    const messages: AgentMessage[] = [{ role: 'user', content: 'test' }]

    await expect(async () => {
      for await (const _ of streamChat(messages, [])) {
        // Should throw before yielding
      }
    }).rejects.toThrow('LLM API error (500)')
  })

  it('handles SSE errors', async () => {
    const sseData = [
      'data: {"error":"Rate limit exceeded"}\n\n',
    ]

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createSSEStream(sseData),
    })

    const messages: AgentMessage[] = [{ role: 'user', content: 'test' }]

    await expect(async () => {
      for await (const _ of streamChat(messages, [])) {
        // Should throw before yielding
      }
    }).rejects.toThrow('SSE error: Rate limit exceeded')
  })
})
