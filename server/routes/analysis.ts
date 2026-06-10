// Fundamental analysis endpoint: streams an LLM-generated "one-page snapshot"
// built from the vendored cn-finance methodology + East Money data, then
// dual-archives the finished report (markdown file + RAG vector row).
import { Router } from 'express'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  fetchWithProxy,
  getLLMPresetById,
  toAnthropicRequest,
  toOpenAIRequest,
  anthropicToOpenAIStream,
} from '../lib/llm'
import { fetchStockFundamentals } from '../services/ashare'
import { resolveStock } from '../services/stockSearch'
import { isDbReady, addFundamentalReport } from '../db/pgDatabase'
import { embedText } from '../rag/embedding'
import {
  buildFundamentalPrompt,
  makeDeltaAccumulator,
  type CnFinanceKnowledge,
} from './analysisPrompt'

const router = Router()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..', '..')
const KNOWLEDGE_DIR = join(__dirname, '..', 'knowledge', 'cn-finance')
const FUNDAMENTALS_DIR = join(PROJECT_ROOT, 'docs', 'fundamentals')

const MIN_ARCHIVE_LENGTH = 120 // chars; below this we assume an error/empty report

// Load the vendored methodology once at boot. Missing files → degrade gracefully
// and tell the caller to run `npm run sync:cn-finance`.
let knowledge: CnFinanceKnowledge | null = null
let knowledgeError: string | null = null
try {
  knowledge = {
    companyProfile: readFileSync(join(KNOWLEDGE_DIR, 'company-profile.md'), 'utf8'),
    financialStatements: readFileSync(join(KNOWLEDGE_DIR, 'financial-statements.md'), 'utf8'),
    valuationModels: readFileSync(join(KNOWLEDGE_DIR, 'valuation-models.md'), 'utf8'),
  }
} catch {
  knowledgeError =
    'cn-finance 方法论文件缺失，请先运行 `npm run sync:cn-finance` 同步知识库。'
  console.warn(`[Analysis] ${knowledgeError}`)
}

function buildLLMRequest(
  messages: Array<{ role: string; content: string }>,
  preset: ReturnType<typeof getLLMPresetById>,
) {
  const { apiUrl, apiKey, model, protocol } = preset

  const isMiMo = apiUrl.includes('xiaomimimo.com') || apiUrl.includes('mimo')
  const isGemini = apiUrl.includes('googleapis.com')

  let actualUrl = apiUrl
  if (isMiMo) {
    actualUrl = apiUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '')
    if (!actualUrl.endsWith('/v1/chat/completions')) {
      actualUrl = actualUrl + '/v1/chat/completions'
    }
  } else if (isGemini) {
    if (!actualUrl.endsWith('/chat/completions')) {
      actualUrl = actualUrl.replace(/\/+$/, '') + '/chat/completions'
    }
  } else if (protocol === 'anthropic') {
    if (!apiUrl.endsWith('/v1/messages')) {
      actualUrl = apiUrl.replace(/\/+$/, '') + '/v1/messages'
    }
  }

  let body: Record<string, unknown>
  let headers: Record<string, string>
  if (protocol === 'anthropic') {
    body = toAnthropicRequest(messages, [], model)
    headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    }
  } else {
    body = toOpenAIRequest(messages, [], model)
    headers = isMiMo
      ? { 'api-key': apiKey, 'Content-Type': 'application/json' }
      : { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  }

  return { actualUrl, headers, body, protocol }
}

async function archiveReport(args: {
  stockCode: string
  stockName: string
  reportMd: string
}): Promise<{ archived: boolean; warning?: string }> {
  const { stockCode, stockName, reportMd } = args
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  // 1) Markdown file (always, even if DB is down — never lose a report).
  let warning: string | undefined
  try {
    mkdirSync(FUNDAMENTALS_DIR, { recursive: true })
    const filePath = join(FUNDAMENTALS_DIR, `${stockCode}-${date}.md`)
    writeFileSync(filePath, reportMd)
    console.log(`[Analysis] archived markdown: ${filePath}`)
  } catch (err) {
    warning = `markdown 存档失败: ${err instanceof Error ? err.message : String(err)}`
    console.warn(`[Analysis] ${warning}`)
  }

  // 2) RAG vector row (best-effort; only when DB is ready).
  if (!isDbReady()) {
    return { archived: !warning, warning: warning ?? 'DB 未就绪，仅保存了 markdown，未写入向量库。' }
  }
  try {
    const summary = reportMd.replace(/\s+/g, ' ').slice(0, 280)
    const embedding = await embedText(`${stockName} ${stockCode} 基本面速览 ${summary}`)
    await addFundamentalReport({
      id: crypto.randomUUID(),
      stockCode,
      stockName,
      reportMd,
      summary,
      embedding,
    })
    console.log(`[Analysis] archived to RAG: ${stockName}(${stockCode})`)
  } catch (err) {
    warning = `向量库写入失败（markdown 已保存）: ${err instanceof Error ? err.message : String(err)}`
    console.warn(`[Analysis] ${warning}`)
  }

  return { archived: true, warning }
}

router.post('/api/analysis/fundamental', async (req, res) => {
  const { query, stockCode, stockName, llmConfig } = req.body as {
    query?: string
    stockCode?: string
    stockName?: string
    llmConfig?: { id?: string }
  }

  // Accept either a 6-digit code (legacy callers) or a free-text query
  // (code OR name) from the Agent-tab chat. Resolution is deferred until after
  // the SSE stream opens so failures surface as a streamed error frame.
  const rawInput = (query ?? stockCode ?? stockName ?? '').trim()
  if (!rawInput) {
    res.status(400).json({ error: 'query 或 stockCode 不能为空' })
    return
  }
  if (!knowledge) {
    res.status(503).json({ error: knowledgeError })
    return
  }

  const preset = getLLMPresetById(llmConfig?.id)
  if (!preset.apiKey) {
    res.status(500).json({
      error: `API key not configured for model "${llmConfig?.id || 'default'}". Set the key in server/.env`,
    })
    return
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const acc = makeDeltaAccumulator()
  let hadError = false
  // Hoisted so the archive step (after the try/catch) can see the resolved values.
  let code = (stockCode ?? '').trim()
  let name = stockName

  try {
    // Resolve code/name. A bare 6-digit stockCode is used directly; anything
    // else (incl. a Chinese name) goes through the East Money suggest resolver.
    if (!/^\d{6}$/.test(code)) {
      const hit = await resolveStock(rawInput)
      if (!hit) {
        res.write(`data: ${JSON.stringify({ error: `无法识别标的「${rawInput}」，请输入 6 位代码或准确名称` })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      code = hit.code
      name = hit.name || name
    }

    const fundamentals = await fetchStockFundamentals(code)
    if (!fundamentals) {
      res.write(`data: ${JSON.stringify({ error: `无法获取 ${code} 的行情/基本面数据` })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    // Prefer a resolved/caller-provided name (the trade record's name) over the fetched one.
    if (name) fundamentals.name = name

    const { system, user } = buildFundamentalPrompt({ fundamentals, knowledge })
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]

    const { actualUrl, headers, body, protocol } = buildLLMRequest(messages, preset)
    console.log(`[Analysis] ${fundamentals.name}(${code}) protocol=${protocol} url=${actualUrl}`)

    const llmResponse = await fetchWithProxy(actualUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text()
      hadError = true
      res.write(`data: ${JSON.stringify({ error: `LLM API error (${llmResponse.status}): ${errorText}` })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    const responseBody = llmResponse.body!
    const decoder = new TextDecoder()

    if (protocol === 'anthropic') {
      for await (const chunk of anthropicToOpenAIStream(responseBody)) {
        acc.push(chunk)
        res.write(chunk)
      }
    } else {
      for await (const chunk of responseBody) {
        const text = decoder.decode(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk), {
          stream: true,
        })
        acc.push(text)
        res.write(chunk)
      }
    }
  } catch (err) {
    hadError = true
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Analysis] Error:', message)
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  // Archive only a clean, non-trivial report. The SSE stream already ended above
  // (we forwarded the upstream [DONE]); archiving happens after, then we close.
  const reportMd = acc.get()
  if (!hadError && reportMd.trim().length >= MIN_ARCHIVE_LENGTH) {
    const { warning } = await archiveReport({
      stockCode: code,
      stockName: name || code,
      reportMd,
    })
    if (warning) {
      res.write(`data: ${JSON.stringify({ archiveWarning: warning })}\n\n`)
    } else {
      res.write(`data: ${JSON.stringify({ archived: true })}\n\n`)
    }
  }
  res.end()
})

export default router
