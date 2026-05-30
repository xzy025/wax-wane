import express from 'express'
import cors from 'cors'
import { config } from 'dotenv'
import { fetchAShareData, fetchStockQuote, fetchIndexTrends } from './ashare'
import { fetchNewsFeed } from './news'
import { fetchMacroData } from './macro'
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

config()

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({ origin: true }))
app.use(express.json())

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
async function* anthropicToOpenAIStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder()
  let buffer = ''
  let currentToolId = ''
  let currentToolName = ''
  let currentToolArgs = ''
  let textContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

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

function toOpenAIRequest(messages: Array<{ role: string; content: string; images?: string[] }>, tools: Array<{ name: string; description: string; parameters: unknown }>, model: string) {
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

  // Use request config or fall back to environment variables
  const apiUrl = llmConfig?.apiUrl ?? process.env.LLM_API_URL
  const apiKey = llmConfig?.apiKey ?? process.env.LLM_API_KEY
  const model = llmConfig?.model ?? process.env.LLM_MODEL ?? 'deepseek-chat'

  if (!apiUrl || !apiKey) {
    res.status(500).json({
      error: 'LLM API not configured. Set LLM_API_URL and LLM_API_KEY in server/.env',
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

  // For MiMo, always use OpenAI-compatible format
  const protocol = isMiMo ? 'openai' : getProtocol(apiUrl)

  let actualUrl = apiUrl
  if (isMiMo) {
    // MiMo: remove /anthropic suffix and add /v1/chat/completions
    actualUrl = apiUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '')
    if (!actualUrl.endsWith('/v1/chat/completions')) {
      actualUrl = actualUrl + '/v1/chat/completions'
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

    console.error(`[Agent] Protocol: ${protocol}`)
    console.error(`[Agent] URL: ${actualUrl}`)
    console.error(`[Agent] Key: ${apiKey?.substring(0, 10)}...`)
    console.error(`[Agent] Body preview:`, JSON.stringify(body).substring(0, 200))

    // Debug: log image content in body
    if (hasImages) {
      const msgWithImg = (body.messages as Array<{ content: unknown }>).find((m) => Array.isArray(m.content))
      if (msgWithImg) {
        console.log('[Agent] Image content block:', JSON.stringify(msgWithImg.content).substring(0, 200))
      }
    }

    const llmResponse = await fetch(actualUrl, {
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

    const reader = llmResponse.body!.getReader()

    if (protocol === 'anthropic') {
      // Convert Anthropic stream to OpenAI format
      for await (const chunk of anthropicToOpenAIStream(reader)) {
        res.write(chunk)
      }
    } else {
      // Pass-through OpenAI stream
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }

    res.end()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  }
})

// Health check
app.get('/api/health', (_req, res) => {
  const protocol = process.env.LLM_API_URL ? getProtocol(process.env.LLM_API_URL) : 'unknown'
  res.json({
    status: 'ok',
    configured: !!(process.env.LLM_API_URL && process.env.LLM_API_KEY),
    protocol,
    model: process.env.LLM_MODEL,
  })
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

// Initialize database and start server
async function startServer() {
  try {
    await initDatabase()
    console.log('[Server] PostgreSQL database initialized')
  } catch (err) {
    console.error('[Server] Failed to initialize database:', err)
    process.exit(1)
  }

  app.listen(PORT, () => {
    const protocol = process.env.LLM_API_URL ? getProtocol(process.env.LLM_API_URL) : 'unknown'
    console.log(`Agent server running on http://localhost:${PORT}`)
    console.log(`LLM configured: ${!!(process.env.LLM_API_URL && process.env.LLM_API_KEY)}`)
    console.log(`Protocol: ${protocol}`)
    console.log(`Model: ${process.env.LLM_MODEL}`)
    console.log(`Database: PostgreSQL (pgvector)`)
  })
}

startServer()
