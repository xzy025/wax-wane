import express from 'express'
import cors from 'cors'
import { config } from 'dotenv'
import { SocksProxyAgent } from 'socks-proxy-agent'
import fetch from 'node-fetch'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { fetchAShareData, fetchStockQuote, fetchIndexTrends, clearAShareCache, fetchStockKline, fetchStockFundamentals } from './ashare'
import { searchWeb, searchStockNews } from './webSearch'
import { fetchHKData, clearHKCache } from './hk'
import { fetchUSData, clearUSCache } from './us'
import { fetchHotList, clearHotListCache } from './hotlist'
import { fetchNewsFeed } from './news'
import { fetchMacroData, clearMacroCache } from './macro'
import { searchSimilar, getDocumentCount } from './vectorStore'
import { syncTradeGroups, resetAndSyncAll } from './ragSync'
import {
  initDatabase,
  insertImportBatch,
  insertTrade,
  getTrades,
  insertTradeGroup,
  getTradeGroups,
  upsertReviewNote,
  getReviewNote,
} from './pgDatabase'
import {
  getMemory,
  saveMemory,
  updateTradingProfile,
  addImprovementPlan,
  updateImprovementPlan,
  updateMarketAnalysis,
  updateConversationSummary,
} from './memoryStore'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

config({ path: join(__dirname, '.env') })

const app = express()
const PORT = process.env.PORT ?? 3002

// CORS: allow dev server and local network access
const allowedOrigins = process.env.CORS_ORIGINS?.split(',') ?? [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3002',
]
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(null, true) // Permissive for local dev; tighten for production
    }
  },
}))
app.use(express.json({ limit: '50mb' }))

// Proxy configuration for Google API access (SOCKS5) - only for foreign APIs
const socksProxy = process.env.SOCKS_PROXY // No default; must be explicitly configured
let proxyAgent: SocksProxyAgent | undefined
if (socksProxy) {
  proxyAgent = new SocksProxyAgent(socksProxy)
  console.log(`[Proxy] SOCKS proxy configured: ${socksProxy} (for Google API only)`)
}

// Custom fetch - only use proxy for foreign APIs (Google, Anthropic, OpenAI)
async function fetchWithProxy(url: string, options: any = {}) {
  const needsProxy = url.includes('googleapis.com') || url.includes('google.com')
    || url.includes('anthropic.com') || url.includes('openai.com')

  if (proxyAgent && needsProxy) {
    console.log(`[Proxy] Using proxy for: ${url}`)
    return fetch(url, { ...options, agent: proxyAgent } as any)
  }
  // Direct fetch for domestic APIs (eastmoney, etc.)
  return fetch(url, options)
}

// Detect protocol from URL
function getProtocol(apiUrl: string): 'anthropic' | 'openai' {
  if (apiUrl.includes('/anthropic') || apiUrl.includes('/messages')) return 'anthropic'
  return 'openai'
}

// --- Anthropic format conversion ---

function toAnthropicRequest(messages: Array<{ role: string; content: string; images?: string[]; tool_call_id?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }>, tools: Array<{ name: string; description: string; parameters: unknown }>, model: string) {
  // Extract system message
  const systemMsg = messages.find((m) => m.role === 'system')
  const nonSystemMessages = messages.filter((m) => m.role !== 'system')

  // Convert messages to Anthropic format
  const anthropicMessages: Array<{ role: string; content: string | Array<unknown> }> = []

  for (const msg of nonSystemMessages) {
    if (msg.role === 'tool') {
      // Tool results go as user messages with tool_result content
      const lastAssistant = anthropicMessages.findLast((m) => m.role === 'assistant')
      anthropicMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        }],
      })
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      // Assistant with tool calls
      const content: Array<unknown> = []
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }
      for (const tc of msg.tool_calls) {
        let args = {}
        try { args = JSON.parse(tc.function.arguments) } catch {}
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
async function* anthropicToOpenAIStream(body: NodeJS.ReadableStream) {
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
      try { event = JSON.parse(data) } catch { continue }

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
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: currentToolId,
                  type: 'function',
                  function: { name: currentToolName, arguments: currentToolArgs },
                }],
              },
            }],
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

// --- OpenAI format (pass-through) ---

function toOpenAIRequest(messages: Array<{ role: string; content: string; images?: string[]; tool_call_id?: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }>, tools: Array<{ name: string; description: string; parameters: unknown }>, model: string) {
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

// --- LLM Config by ID ---

interface LLMPreset {
  apiUrl: string
  apiKey: string
  model: string
  protocol: 'openai' | 'anthropic'
}

function getLLMPresetById(id?: string): LLMPreset {
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

// --- Main endpoint ---

app.post('/api/agent/chat', async (req, res) => {
  const { messages, tools, llmConfig } = req.body

  // Debug: log image info
  const hasImages = messages.some((m: { images?: string[] }) => m.images && m.images.length > 0)
  if (hasImages) {
    console.log('[Agent] Request contains images')
    const imgMsg = messages.find((m: { images?: string[] }) => m.images && m.images.length > 0)
    console.log('[Agent] Image count:', imgMsg.images.length)
    console.log('[Agent] Image format:', imgMsg.images[0].substring(0, 50) + '...')
  }

  // Get LLM config by ID (API keys stay on server)
  const preset = getLLMPresetById(llmConfig?.id)
  const apiUrl = preset.apiUrl
  const apiKey = preset.apiKey
  let model = preset.model
  const protocol = preset.protocol

  // MiMo: auto-switch to mimo-v2.5 when images are present (mimo-v2.5-pro doesn't support images)
  if (hasImages && model === 'mimo-v2.5-pro') {
    model = 'mimo-v2.5'
    console.log('[Agent] Auto-switched to mimo-v2.5 for image support')
  }

  if (!apiKey) {
    res.status(500).json({
      error: `API key not configured for model "${llmConfig?.id || 'default'}". Set the key in server/.env`,
    })
    return
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  // Detect MiMo API
  const isMiMo = apiUrl.includes('xiaomimimo.com') || apiUrl.includes('mimo')
  const isGemini = apiUrl.includes('googleapis.com')

  let actualUrl = apiUrl
  if (isMiMo) {
    // MiMo: remove /anthropic suffix and add /v1/chat/completions
    actualUrl = apiUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '')
    if (!actualUrl.endsWith('/v1/chat/completions')) {
      actualUrl = actualUrl + '/v1/chat/completions'
    }
  } else if (isGemini) {
    // Gemini: ensure URL ends with /chat/completions
    if (!actualUrl.endsWith('/chat/completions')) {
      actualUrl = actualUrl.replace(/\/+$/, '') + '/chat/completions'
    }
  } else if (protocol === 'anthropic') {
    // Anthropic: ensure URL ends with /v1/messages
    if (!apiUrl.endsWith('/v1/messages')) {
      actualUrl = apiUrl.replace(/\/+$/, '') + '/v1/messages'
    }
  }

  try {
    let body: Record<string, unknown>
    let headers: Record<string, string>

    if (protocol === 'anthropic') {
      body = toAnthropicRequest(messages, tools ?? [], model)
      headers = {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      }
    } else {
      body = toOpenAIRequest(messages, tools ?? [], model)
      // MiMo uses api-key header, others use Authorization: Bearer
      if (isMiMo) {
        headers = {
          'api-key': apiKey,
          'Content-Type': 'application/json',
        }
      } else {
        headers = {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        }
      }
    }

    console.log(`[Agent] Protocol: ${protocol}, URL: ${actualUrl}`)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Agent] Body preview:`, JSON.stringify(body).substring(0, 200))
    }

    // Debug: log image content in body
    if (hasImages) {
      const msgWithImg = (body.messages as Array<{ content: unknown }>).find((m) => Array.isArray(m.content))
      if (msgWithImg) {
        console.log('[Agent] Image content block:', JSON.stringify(msgWithImg.content).substring(0, 200))
      }
    }

    const llmResponse = await fetchWithProxy(actualUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text()
      res.write(`data: ${JSON.stringify({ error: `LLM API error (${llmResponse.status}): ${errorText}` })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    const responseBody = llmResponse.body!

    if (protocol === 'anthropic') {
      // Convert Anthropic stream to OpenAI format
      for await (const chunk of anthropicToOpenAIStream(responseBody)) {
        res.write(chunk)
      }
    } else {
      // Pass-through OpenAI stream
      for await (const chunk of responseBody) {
        res.write(chunk)
      }
    }

    res.end()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const stack = err instanceof Error ? err.stack : ''
    console.error(`[Agent] Error:`, message)
    console.error(`[Agent] Stack:`, stack)
    console.error(`[Agent] URL:`, actualUrl)
    console.error(`[Agent] Model:`, model)
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  }
})

// Health check
app.get('/api/health', (_req, res) => {
  const hasUrl = !!process.env.LLM_API_URL
  const hasKey = !!process.env.LLM_API_KEY
  const protocol = hasUrl ? getProtocol(process.env.LLM_API_URL!) : 'unknown'
  console.log('[Health] LLM_API_URL:', hasUrl, 'LLM_API_KEY:', hasKey)
  res.json({
    status: 'ok',
    configured: hasUrl && hasKey,
    protocol,
    model: process.env.LLM_MODEL,
  })
})

// Clear all market data caches (for refresh button)
app.post('/api/refresh', (_req, res) => {
  clearAShareCache()
  clearHKCache()
  clearUSCache()
  clearHotListCache()
  clearMacroCache()
  res.json({ ok: true })
})

// A-share market data
app.get('/api/ashare', async (_req, res) => {
  try {
    const data = await fetchAShareData()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Hong Kong market data
app.get('/api/hk', async (_req, res) => {
  try {
    const data = await fetchHKData()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// US market data
app.get('/api/us', async (_req, res) => {
  try {
    const data = await fetchUSData()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Hot stock rankings
app.get('/api/hotlist', async (_req, res) => {
  try {
    const data = await fetchHotList()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── MCP Routes: A-share market data ──────────────────────

app.get('/api/mcp/ashare/trends', async (req, res) => {
  const code = req.query.code as string | undefined
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'Missing or invalid ?code= (6-digit stock/index code)' })
    return
  }
  try {
    const data = await fetchIndexTrends(code)
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.get('/api/mcp/ashare/quote', async (req, res) => {
  const code = req.query.code as string | undefined
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'Missing or invalid ?code= (6-digit stock code)' })
    return
  }
  try {
    const quote = await fetchStockQuote(code)
    if (!quote) {
      res.status(404).json({ error: `Stock ${code} not found` })
      return
    }
    res.json(quote)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Stock K-line history
app.get('/api/stock/kline', async (req, res) => {
  const code = req.query.code as string | undefined
  const period = parseInt(req.query.period as string) || 101
  const count = parseInt(req.query.count as string) || 30
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'Missing or invalid ?code= (6-digit stock code)' })
    return
  }
  try {
    const data = await fetchStockKline(code, period, count)
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Stock fundamentals
app.get('/api/stock/fundamentals', async (req, res) => {
  const code = req.query.code as string | undefined
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'Missing or invalid ?code= (6-digit stock code)' })
    return
  }
  try {
    const data = await fetchStockFundamentals(code)
    if (!data) {
      res.status(404).json({ error: `Stock ${code} not found` })
      return
    }
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Stock news search
app.get('/api/stock/news', async (req, res) => {
  const code = req.query.code as string | undefined
  const count = parseInt(req.query.count as string) || 10
  if (!code) {
    res.status(400).json({ error: 'Missing ?code= parameter' })
    return
  }
  try {
    const data = await searchStockNews(code, count)
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Web search proxy
app.get('/api/web/search', async (req, res) => {
  const query = req.query.q as string | undefined
  const count = parseInt(req.query.count as string) || 5
  if (!query) {
    res.status(400).json({ error: 'Missing ?q= parameter' })
    return
  }
  try {
    const data = await searchWeb(query, count)
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.get('/api/mcp/ashare/breadth', async (_req, res) => {
  try {
    const data = await fetchAShareData()
    res.json({
      advance: data.advance,
      decline: data.decline,
      flat: data.flat,
      limitUpCount: data.limitUpCount,
      limitDownCount: data.limitDownCount,
      promotionRate: data.promotionRate,
      promotedCount: data.promotedCount,
      promotionTotal: data.promotionTotal,
      newHighCount: data.newHighCount,
      nearHighCount: data.nearHighCount,
      nearHighStocks: data.nearHighStocks,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.get('/api/mcp/ashare/limit-pool', async (req, res) => {
  const direction = (req.query.direction as string) ?? 'up'
  if (direction !== 'up' && direction !== 'down') {
    res.status(400).json({ error: '?direction= must be "up" or "down"' })
    return
  }
  try {
    const data = await fetchAShareData()
    const stocks = direction === 'up' ? data.limitUpStocks : data.limitDownStocks
    const count = direction === 'up' ? data.limitUpCount : data.limitDownCount
    res.json({ count, stocks })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.get('/api/mcp/ashare/indices', async (_req, res) => {
  try {
    const data = await fetchAShareData()
    res.json(data.indices)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── MCP Routes: News (RSS) ──────────────────────────────

app.get('/api/mcp/news/summary', async (_req, res) => {
  try {
    const items = await fetchNewsFeed()
    res.json(items)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── MCP Routes: Macro data ───────────────────────────────

app.get('/api/mcp/macro/indicators', async (_req, res) => {
  try {
    const data = await fetchMacroData()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── MCP Routes: RAG (Vector Search) ─────────────────────

app.get('/api/mcp/rag/status', async (_req, res) => {
  try {
    const count = await getDocumentCount()
    res.json({ status: 'ok', documentCount: count })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.get('/api/mcp/rag/search', async (req, res) => {
  const { query, type, topK } = req.query
  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'Missing ?query= parameter' })
    return
  }
  try {
    const k = topK ? parseInt(topK as string, 10) : 5
    const results = await searchSimilar(query, k, type as string)
    res.json(results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/mcp/rag/sync', async (req, res) => {
  const { tradeGroups, reviewNotes, reset } = req.body
  if (!tradeGroups || !Array.isArray(tradeGroups)) {
    res.status(400).json({ error: 'Missing tradeGroups array in body' })
    return
  }
  try {
    const result = reset
      ? await resetAndSyncAll(tradeGroups, reviewNotes || {})
      : await syncTradeGroups(tradeGroups, reviewNotes || {})
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── MCP Routes: GraphRAG ──────────────────────────────────

app.post('/api/mcp/graph/sync', async (req, res) => {
  const { tradeGroups, reviewNotes } = req.body
  if (!tradeGroups || !Array.isArray(tradeGroups)) {
    res.status(400).json({ error: 'Missing tradeGroups array in body' })
    return
  }
  try {
    const { fullGraphSync } = await import('./graph/graphSync')
    const result = await fullGraphSync(tradeGroups, reviewNotes || {})
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.get('/api/mcp/graph/stats', async (_req, res) => {
  try {
    const { getGraphStats } = await import('./graph/graphSchema')
    const stats = await getGraphStats()
    res.json(stats)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/mcp/graph/query', async (req, res) => {
  const { queryType, params } = req.body
  try {
    const graphQuery = await import('./graph/graphQuery')
    let result: unknown

    switch (queryType) {
      case 'findTradesByMistake':
        result = await graphQuery.findTradesByMistake(params.mistake)
        break
      case 'findTradesByPhase':
        result = await graphQuery.findTradesByPhase(params.phaseType, params.phaseValue)
        break
      case 'findRelatedTrades':
        result = await graphQuery.findRelatedTrades(params.tradeGroupId, params.relationTypes)
        break
      case 'findPatternPath':
        result = await graphQuery.findPatternPath(params.mistake)
        break
      case 'multiHop':
        result = await graphQuery.multiHopQuery(
          params.startType,
          params.startFilter,
          params.hops,
        )
        break
      default:
        res.status(400).json({ error: `Unknown query type: ${queryType}` })
        return
    }

    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── MCP Routes: Database ────────────────────────────────────

app.get('/api/db/trades', async (req, res) => {
  try {
    const { stock_code, start_date, end_date, side, limit } = req.query
    const trades = await getTrades({
      stock_code: stock_code as string,
      start_date: start_date as string,
      end_date: end_date as string,
      side: side as 'buy' | 'sell',
      limit: limit ? parseInt(limit as string, 10) : undefined,
    })
    res.json(trades)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/db/trades', async (req, res) => {
  try {
    await insertTrade(req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.get('/api/db/trade-groups', async (req, res) => {
  try {
    const { status, stock_code } = req.query
    const groups = await getTradeGroups({
      status: status as 'open' | 'closed',
      stock_code: stock_code as string,
    })
    res.json(groups)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/db/trade-groups', async (req, res) => {
  try {
    await insertTradeGroup(req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.get('/api/db/review-notes/:groupId', async (req, res) => {
  try {
    const note = await getReviewNote(req.params.groupId)
    res.json(note)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.put('/api/db/review-notes/:groupId', async (req, res) => {
  try {
    await upsertReviewNote({ trade_group_id: req.params.groupId, ...req.body })
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/db/import-batches', async (req, res) => {
  try {
    await insertImportBatch(req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── MCP Routes: Agent Memory ───────────────────────────────

app.get('/api/memory/:userId', async (req, res) => {
  try {
    const memory = await getMemory(req.params.userId)
    res.json(memory)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.put('/api/memory/:userId', async (req, res) => {
  try {
    const memory = { ...req.body, userId: req.params.userId }
    await saveMemory(memory)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.patch('/api/memory/:userId/profile', async (req, res) => {
  try {
    await updateTradingProfile(req.params.userId, req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/memory/:userId/plans', async (req, res) => {
  try {
    await addImprovementPlan(req.params.userId, req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.patch('/api/memory/:userId/plans/:planId', async (req, res) => {
  try {
    await updateImprovementPlan(req.params.userId, req.params.planId, req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.patch('/api/memory/:userId/market', async (req, res) => {
  try {
    await updateMarketAnalysis(req.params.userId, req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.patch('/api/memory/:userId/summary', async (req, res) => {
  try {
    await updateConversationSummary(req.params.userId, req.body.summary)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── MCP Routes: Enhanced Memory ───────────────────────────

app.get('/api/memory-enhanced/:userId', async (req, res) => {
  try {
    const { getEnhancedMemory, serializeEnhancedMemory } = await import('./memoryEnhanced')
    const memory = await getEnhancedMemory(req.params.userId)
    res.json({
      ...memory,
      serialized: serializeEnhancedMemory(memory),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.patch('/api/memory-enhanced/:userId/profile', async (req, res) => {
  try {
    const { updateEnhancedTradingProfile } = await import('./memoryEnhanced')
    await updateEnhancedTradingProfile(req.params.userId, req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/memory-enhanced/:userId/infer-profile', async (req, res) => {
  try {
    const { inferTradingProfile } = await import('./memoryEnhanced')
    const { tradeGroups } = req.body
    await inferTradingProfile(req.params.userId, tradeGroups || [])
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/memory-enhanced/:userId/lessons', async (req, res) => {
  try {
    const { extractLessonsFromReview } = await import('./memoryExtraction')
    const { tradeGroupId, reviewNote } = req.body
    await extractLessonsFromReview(req.params.userId, tradeGroupId, reviewNote)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/memory-enhanced/:userId/patterns', async (req, res) => {
  try {
    const { extractPatternsFromTrades } = await import('./memoryExtraction')
    const { tradeGroups } = req.body
    await extractPatternsFromTrades(req.params.userId, tradeGroups || [])
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/memory-enhanced/:userId/decisions', async (req, res) => {
  try {
    const { addKeyDecision } = await import('./memoryEnhanced')
    await addKeyDecision(req.params.userId, req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/memory-enhanced/:userId/actions', async (req, res) => {
  try {
    const { addActionItem } = await import('./memoryEnhanced')
    await addActionItem(req.params.userId, {
      ...req.body,
      id: crypto.randomUUID(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    })
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.patch('/api/memory-enhanced/:userId/actions/:actionId', async (req, res) => {
  try {
    const { completeActionItem } = await import('./memoryEnhanced')
    await completeActionItem(req.params.userId, req.params.actionId)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Initialize database and start server
async function startServer() {
  let dbConnected = false

  try {
    await initDatabase()
    console.log('[Server] PostgreSQL database initialized')
    dbConnected = true

    // Initialize GraphRAG schema
    try {
      const { initGraphSchema } = await import('./graph/graphSchema')
      await initGraphSchema()
      console.log('[Server] GraphRAG schema initialized')
    } catch (err) {
      console.warn('[Server] GraphRAG schema init failed (non-fatal):', err)
    }
  } catch (err) {
    console.warn('[Server] PostgreSQL not available, running in limited mode')
    console.warn('[Server] Agent chat API will work, but database features are disabled')
  }

  app.listen(PORT, () => {
    const protocol = process.env.LLM_API_URL ? getProtocol(process.env.LLM_API_URL) : 'unknown'
    console.log(`Agent server running on http://localhost:${PORT}`)
    console.log(`LLM configured: ${!!(process.env.LLM_API_URL && process.env.LLM_API_KEY)}`)
    console.log(`Protocol: ${protocol}`)
    console.log(`Model: ${process.env.LLM_MODEL}`)
    console.log(`Database: ${dbConnected ? 'PostgreSQL (connected)' : 'PostgreSQL (not connected - limited mode)'}`)
  })
}

startServer()
