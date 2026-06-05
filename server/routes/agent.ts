// Agent chat (LLM proxy with streaming) + health check.
import { Router } from 'express'
import {
  fetchWithProxy,
  getProtocol,
  getLLMPresetById,
  toAnthropicRequest,
  toOpenAIRequest,
  anthropicToOpenAIStream,
} from '../lib/llm'
import { isDbReady } from '../db/pgDatabase'

const router = Router()

router.post('/api/agent/chat', async (req, res) => {
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
      const msgWithImg = (body.messages as Array<{ content: unknown }>).find((m) =>
        Array.isArray(m.content),
      )
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
router.get('/api/health', (_req, res) => {
  const hasUrl = !!process.env.LLM_API_URL
  const hasKey = !!process.env.LLM_API_KEY
  const protocol = hasUrl ? getProtocol(process.env.LLM_API_URL!) : 'unknown'
  console.log('[Health] LLM_API_URL:', hasUrl, 'LLM_API_KEY:', hasKey)
  res.json({
    status: 'ok',
    configured: hasUrl && hasKey,
    protocol,
    model: process.env.LLM_MODEL,
    db: isDbReady(),
  })
})

export default router
