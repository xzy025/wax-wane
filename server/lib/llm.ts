// LLM helpers: SOCKS proxy fetch, protocol detection, Anthropic⇄OpenAI
// conversion, and per-provider presets. Extracted from index.ts.

import { SocksProxyAgent } from 'socks-proxy-agent'
import fetch from 'node-fetch'

// ── Proxy ──────────────────────────────────────────────────
// Only route foreign APIs (Google/Anthropic/OpenAI) through the SOCKS proxy.
// Lazy-initialized so SOCKS_PROXY is read after dotenv config() has run in
// index.ts (ESM evaluates this module before index.ts's body).

let proxyAgent: SocksProxyAgent | undefined
let proxyResolved = false

function getProxyAgent(): SocksProxyAgent | undefined {
  if (!proxyResolved) {
    proxyResolved = true
    const socksProxy = process.env.SOCKS_PROXY // No default; must be explicitly configured
    if (socksProxy) {
      proxyAgent = new SocksProxyAgent(socksProxy)
      console.log(`[Proxy] SOCKS proxy configured: ${socksProxy} (for Google API only)`)
    }
  }
  return proxyAgent
}

export async function fetchWithProxy(url: string, options: any = {}) {
  const needsProxy =
    url.includes('googleapis.com') ||
    url.includes('google.com') ||
    url.includes('anthropic.com') ||
    url.includes('openai.com')

  const agent = getProxyAgent()
  if (agent && needsProxy) {
    console.log(`[Proxy] Using proxy for: ${url}`)
    return fetch(url, { ...options, agent } as any)
  }
  // Direct fetch for domestic APIs (eastmoney, etc.)
  return fetch(url, options)
}

// ── Protocol detection ─────────────────────────────────────

export function getProtocol(apiUrl: string): 'anthropic' | 'openai' {
  if (apiUrl.includes('/anthropic') || apiUrl.includes('/messages')) return 'anthropic'
  return 'openai'
}

// ── Anthropic format conversion ────────────────────────────

export function toAnthropicRequest(
  messages: Array<{
    role: string
    content: string
    images?: string[]
    tool_call_id?: string
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
  }>,
  tools: Array<{ name: string; description: string; parameters: unknown }>,
  model: string,
) {
  // Extract system message
  const systemMsg = messages.find((m) => m.role === 'system')
  const nonSystemMessages = messages.filter((m) => m.role !== 'system')

  // Convert messages to Anthropic format
  const anthropicMessages: Array<{ role: string; content: string | Array<unknown> }> = []

  for (const msg of nonSystemMessages) {
    if (msg.role === 'tool') {
      // Tool results go as user messages with tool_result content
      anthropicMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content,
          },
        ],
      })
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      // Assistant with tool calls
      const content: Array<unknown> = []
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }
      for (const tc of msg.tool_calls) {
        let args = {}
        try {
          args = JSON.parse(tc.function.arguments)
        } catch {}
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: args,
        })
      }
      anthropicMessages.push({ role: 'assistant', content })
    } else if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      // User message with images - use content blocks
      const content: Array<unknown> = []
      for (const img of msg.images) {
        // Extract base64 data and media type
        const match = img.match(/^data:(image\/\w+);base64,(.+)$/)
        if (match) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: match[1],
              data: match[2],
            },
          })
        }
      }
      content.push({ type: 'text', text: msg.content })
      anthropicMessages.push({ role: 'user', content })
    } else {
      anthropicMessages.push({ role: msg.role, content: msg.content })
    }
  }

  // Convert tools to Anthropic format
  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))

  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: anthropicMessages,
    stream: true,
  }

  if (systemMsg) {
    body.system = systemMsg.content
  }
  if (anthropicTools.length > 0) {
    body.tools = anthropicTools
  }

  return body
}

// Convert Anthropic SSE stream to OpenAI format for frontend consumption
export async function* anthropicToOpenAIStream(body: NodeJS.ReadableStream) {
  const decoder = new TextDecoder()
  let buffer = ''
  let currentToolId = ''
  let currentToolName = ''
  let currentToolArgs = ''
  let textContent = ''

  for await (const chunk of body) {
    const value = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk)
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (!data) continue

      let event: Record<string, unknown>
      try {
        event = JSON.parse(data)
      } catch {
        continue
      }

      const eventType = event.type as string

      if (eventType === 'content_block_start') {
        const block = event.content_block as Record<string, unknown> | undefined
        if (block?.type === 'tool_use') {
          currentToolId = block.id as string
          currentToolName = block.name as string
          currentToolArgs = ''
        }
      } else if (eventType === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown> | undefined
        if (delta?.type === 'text_delta') {
          const text = delta.text as string
          textContent += text
          // Emit as OpenAI-style chunk
          yield `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
        } else if (delta?.type === 'input_json_delta') {
          currentToolArgs += (delta.partial_json as string) ?? ''
        }
      } else if (eventType === 'content_block_stop') {
        if (currentToolId) {
          // Emit tool call as OpenAI-style chunk
          yield `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: currentToolId,
                      type: 'function',
                      function: { name: currentToolName, arguments: currentToolArgs },
                    },
                  ],
                },
              },
            ],
          })}\n\n`
          currentToolId = ''
          currentToolName = ''
          currentToolArgs = ''
        }
      } else if (eventType === 'message_stop') {
        yield 'data: [DONE]\n\n'
        return
      }
    }
  }

  yield 'data: [DONE]\n\n'
}

// ── OpenAI format (pass-through) ───────────────────────────

export function toOpenAIRequest(
  messages: Array<{
    role: string
    content: string
    images?: string[]
    tool_call_id?: string
    tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  }>,
  tools: Array<{ name: string; description: string; parameters: unknown }>,
  model: string,
) {
  // Convert messages to OpenAI format with image support
  const openaiMessages = messages.map((msg) => {
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      // User message with images
      const content: Array<unknown> = [{ type: 'text', text: msg.content }]
      for (const img of msg.images) {
        content.push({
          type: 'image_url',
          image_url: { url: img },
        })
      }
      return { role: msg.role, content }
    } else if (msg.role === 'tool') {
      // Tool message - must include tool_call_id
      return { role: msg.role, content: msg.content, tool_call_id: msg.tool_call_id }
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      // Assistant message with tool calls
      return { role: msg.role, content: msg.content, tool_calls: msg.tool_calls }
    }
    return { role: msg.role, content: msg.content }
  })

  const body: Record<string, unknown> = {
    model,
    messages: openaiMessages,
    stream: true,
  }

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
  }

  return body
}

// ── LLM Config by ID ───────────────────────────────────────

export interface LLMPreset {
  apiUrl: string
  apiKey: string
  model: string
  protocol: 'openai' | 'anthropic'
}

export function getLLMPresetById(id?: string): LLMPreset {
  // Default: 小米 MiMo
  const defaultPreset: LLMPreset = {
    apiUrl: process.env.LLM_API_URL || 'https://token-plan-cn.xiaomimimo.com/anthropic',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'mimo-v2.5-pro',
    protocol: 'openai', // MiMo uses OpenAI-compatible format
  }

  if (!id) return defaultPreset

  switch (id) {
    case 'claude':
      return {
        apiUrl: process.env.CLAUDE_API_URL || 'https://api.anthropic.com',
        apiKey: process.env.CLAUDE_API_KEY || '',
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
        protocol: 'anthropic',
      }
    case 'codex':
      return {
        apiUrl: process.env.OPENAI_API_URL || 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        protocol: 'openai',
      }
    case 'gemini':
      return {
        apiUrl: process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        protocol: 'openai',
      }
    case 'xiaomi-mimo':
    default:
      return defaultPreset
  }
}
