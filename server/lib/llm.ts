// LLM helpers: SOCKS proxy fetch, protocol detection, Anthropic⇄OpenAI
// conversion, and per-provider presets. Extracted from index.ts.

import { SocksProxyAgent } from 'socks-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import fetch from 'node-fetch'

// ── Proxy ──────────────────────────────────────────────────
// Route configured external and market-data APIs through the SOCKS proxy.
// Lazy-initialized so SOCKS_PROXY is read after dotenv config() has run in
// index.ts (ESM evaluates this module before index.ts's body).

let proxyAgent: SocksProxyAgent | undefined
let proxyResolved = false
let marketHttpAgent: HttpsProxyAgent<string> | undefined
let marketHttpProxy: string | undefined

// ── 代理失败自动回退直连 ────────────────────────────────────────────────
// 代理是单点故障：实测腾讯 web.ifzq.gtimg.cn 走 127.0.0.1:10809 返回 501
// 反爬页，而直连 200 正常返回 qfq 前复权数据。代理一抖动，整条 K 线降级链
// (EM → 腾讯 → 新浪) 就会掉到新浪不复权，导致复权口径不一致、数据质检
// historyCoverage 归零、盘后扫描整轮作废。
// 因此：代理返回非 2xx 或网络错误时，用直连重试一次；直连成功就记住该 host
// 在 TTL 内直接走直连，避免批量扫描(600 只)每只都白付一次代理往返。
const PROXY_BYPASS_TTL_MS = 5 * 60_000
const DIRECT_FALLBACK_TIMEOUT_MS = 8_000
const proxyBypassUntil: Record<string, number> = {}

function proxyBypassed(hostname: string): boolean {
  const until = proxyBypassUntil[hostname]
  return until !== undefined && Date.now() < until
}

function markProxyBypass(hostname: string): void {
  proxyBypassUntil[hostname] = Date.now() + PROXY_BYPASS_TTL_MS
}

/** node-fetch 的响应类型；显式标注，避免兜底分支把返回值退化成 any。 */
type FetchResponse = Awaited<ReturnType<typeof fetch>>

/** 直连重试。原 signal 可能已随代理请求超时而 abort，必须换一个新的。 */
async function fetchDirect(url: string, options: any): Promise<FetchResponse | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DIRECT_FALLBACK_TIMEOUT_MS)
  try {
    const { signal: _drop, ...rest } = options ?? {}
    return await fetch(url, { ...rest, signal: controller.signal } as any)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function getProxyAgent(): SocksProxyAgent | undefined {
  if (!proxyResolved) {
    proxyResolved = true
    const socksProxy = process.env.SOCKS_PROXY // No default; must be explicitly configured
    if (socksProxy) {
      // Remote DNS keeps market-domain resolution inside the configured proxy;
      // this matters on machines where direct DNS is blocked by policy.
      const proxyUrl = socksProxy.replace(/^socks5:\/\//i, 'socks5h://')
      proxyAgent = new SocksProxyAgent(proxyUrl)
      console.log(`[Proxy] SOCKS proxy configured: ${proxyUrl} (external and market-data APIs)`)
    }
  }
  return proxyAgent
}

export async function fetchWithProxy(url: string, options: any = {}): Promise<FetchResponse> {
  const hostname = new URL(url).hostname
  const isMarket = ['eastmoney.com', 'sinajs.cn', 'gtimg.cn', 'longhuvip.com', 'quicktiny.cn']
    .some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
  // Explicit market-only routing; never silently route LLM traffic through it.
  const configuredMarketProxy = process.env.MARKET_DATA_HTTP_PROXY
  if (isMarket && configuredMarketProxy) {
    if (marketHttpProxy !== configuredMarketProxy) {
      const proxy = new URL(configuredMarketProxy)
      if (!['http:', 'https:'].includes(proxy.protocol)) throw new Error('Invalid market HTTP proxy protocol')
      marketHttpAgent = new HttpsProxyAgent(configuredMarketProxy)
      marketHttpProxy = configuredMarketProxy
    }
    if (!proxyBypassed(hostname)) {
      let proxied: FetchResponse
      try {
        proxied = await fetch(url, { ...options, agent: marketHttpAgent } as any)
      } catch {
        // 代理不可达：直连兜底
        const direct = await fetchDirect(url, options)
        if (direct) {
          markProxyBypass(hostname)
          return direct
        }
        throw new Error(`market proxy unreachable and direct fallback failed: ${url}`)
      }
      if (proxied.ok) return proxied
      // 代理可达但被目标拒绝(501/5xx 多为反爬拦截页)：直连往往正常
      const direct = await fetchDirect(url, options)
      if (direct?.ok) {
        markProxyBypass(hostname)
        return direct
      }
      return proxied
    }
    return fetch(url, options as any)
  }
  const needsProxy =
    url.includes('googleapis.com') ||
    url.includes('google.com') ||
    url.includes('anthropic.com') ||
    url.includes('openai.com') ||
    url.includes('eastmoney.com') ||
    url.includes('sinajs.cn') ||
    url.includes('gtimg.cn') ||
    url.includes('longhuvip.com') ||
    url.includes('quicktiny.cn')

  const agent = getProxyAgent()
  if (agent && needsProxy) {
    // 全市场扫描可能产生数千次行情请求；逐 URL 打日志会淹没真正的
    // 错误并显著增加终端/DevTools 压力。需要逐请求诊断时显式开启。
    if (process.env.MARKET_DATA_PROXY_DEBUG === '1') console.log(`[Proxy] Using proxy for: ${url}`)
    return fetch(url, { ...options, agent } as any)
  }
  // Without a configured proxy, preserve the existing direct-fetch behavior.
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
        model: process.env.CLAUDE_MODEL || 'claude-opus-4-8',
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
