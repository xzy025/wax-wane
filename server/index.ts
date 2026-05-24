import express from 'express'
import cors from 'cors'
import { config } from 'dotenv'
import { fetchAShareData } from './ashare'

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

function toAnthropicRequest(messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }>, tools: Array<{ name: string; description: string; parameters: unknown }>, model: string) {
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

function toOpenAIRequest(messages: Array<{ role: string; content: string }>, tools: Array<{ name: string; description: string; parameters: unknown }>, model: string) {
  const body: Record<string, unknown> = {
    model,
    messages,
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
  const { messages, tools } = req.body

  const apiUrl = process.env.LLM_API_URL
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL ?? 'deepseek-chat'

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

  const protocol = getProtocol(apiUrl)

  // For Anthropic protocol, ensure URL ends with /v1/messages
  let actualUrl = apiUrl
  if (protocol === 'anthropic' && !apiUrl.endsWith('/v1/messages')) {
    actualUrl = apiUrl.replace(/\/+$/, '') + '/v1/messages'
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
      headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }
    }

    console.error(`[Agent] Protocol: ${protocol}`)
    console.error(`[Agent] URL: ${actualUrl}`)
    console.error(`[Agent] Key: ${apiKey?.substring(0, 10)}...`)
    console.error(`[Agent] Body preview:`, JSON.stringify(body).substring(0, 200))

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

app.listen(PORT, () => {
  const protocol = process.env.LLM_API_URL ? getProtocol(process.env.LLM_API_URL) : 'unknown'
  console.log(`Agent server running on http://localhost:${PORT}`)
  console.log(`LLM configured: ${!!(process.env.LLM_API_URL && process.env.LLM_API_KEY)}`)
  console.log(`Protocol: ${protocol}`)
  console.log(`Model: ${process.env.LLM_MODEL}`)
})
