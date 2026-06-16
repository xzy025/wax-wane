// Non-streaming LLM completion helper.
//
// The agent chat route (routes/agent.ts) streams SSE to the browser. A few
// server-side features — the RAG reranker (rag/rerank.ts) and the eval judge
// (eval/llmJudge.ts) — instead need a single blocking call that returns text.
// This factors out the same URL/header resolution agent.ts uses (MiMo OpenAI-
// compatible by default) with `stream: false`.
//
// Contract: every failure mode degrades to `null` rather than throwing, so
// callers can treat the LLM as a best-effort enhancement that is simply skipped
// when unconfigured or unreachable.

import { fetchWithProxy, getLLMPresetById } from './llm'

export interface LlmCompleteOptions {
  system?: string
  maxTokens?: number
  temperature?: number
  /** Preset id (claude/codex/gemini/xiaomi-mimo). Defaults to env preset. */
  llmId?: string
  /** Abort after this many ms. Default 20s. */
  timeoutMs?: number
}

/** Whether an LLM API key is configured for the default preset. */
export function isLLMConfigured(llmId?: string): boolean {
  return !!getLLMPresetById(llmId).apiKey
}

/** Resolve the OpenAI-compatible chat-completions URL for a preset (mirrors agent.ts). */
function resolveChatUrl(apiUrl: string, protocol: string): string {
  const isMiMo = apiUrl.includes('xiaomimimo.com') || apiUrl.includes('mimo')
  const isGemini = apiUrl.includes('googleapis.com')
  if (isMiMo) {
    const base = apiUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '')
    return base.endsWith('/v1/chat/completions') ? base : `${base}/v1/chat/completions`
  }
  if (isGemini) {
    return apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl.replace(/\/+$/, '')}/chat/completions`
  }
  if (protocol === 'anthropic') {
    return apiUrl.endsWith('/v1/messages') ? apiUrl : `${apiUrl.replace(/\/+$/, '')}/v1/messages`
  }
  return apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl.replace(/\/+$/, '')}/v1/chat/completions`
}

export interface LlmCompleteResult {
  text: string
  /** Total tokens if the provider reports usage (for cost/observability). */
  totalTokens?: number
}

/** Minimal shape of an OpenAI- or Anthropic-style completion response. */
interface CompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
  content?: Array<{ type?: string; text?: string }>
  usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number }
}

/**
 * Make a single non-streaming completion call. Returns null if no API key is
 * configured or the request fails — callers should handle null as "skip".
 */
export async function llmComplete(
  prompt: string,
  options: LlmCompleteOptions = {},
): Promise<LlmCompleteResult | null> {
  const preset = getLLMPresetById(options.llmId)
  if (!preset.apiKey) return null

  const isMiMo = preset.apiUrl.includes('xiaomimimo.com') || preset.apiUrl.includes('mimo')
  const url = resolveChatUrl(preset.apiUrl, preset.protocol)
  const isAnthropic = preset.protocol === 'anthropic' && !isMiMo

  const messages = [
    ...(options.system ? [{ role: 'system', content: options.system }] : []),
    { role: 'user', content: prompt },
  ]

  let headers: Record<string, string>
  let body: Record<string, unknown>

  if (isAnthropic) {
    headers = { 'x-api-key': preset.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    body = {
      model: preset.model,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0,
      ...(options.system ? { system: options.system } : {}),
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }
  } else {
    headers = isMiMo
      ? { 'api-key': preset.apiKey, 'Content-Type': 'application/json' }
      : { Authorization: `Bearer ${preset.apiKey}`, 'Content-Type': 'application/json' }
    body = {
      model: preset.model,
      messages,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0,
      stream: false,
    }
  }

  try {
    const res = await fetchWithProxy(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as CompletionResponse

    // OpenAI-compatible shape
    let text: string | undefined = data.choices?.[0]?.message?.content
    // Anthropic shape
    if (text === undefined && Array.isArray(data.content)) {
      text = data.content.map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('')
    }
    if (typeof text !== 'string' || text.length === 0) return null

    const usage = data.usage
    const totalTokens =
      usage?.total_tokens ??
      (usage?.input_tokens != null && usage?.output_tokens != null
        ? usage.input_tokens + usage.output_tokens
        : undefined)

    return { text, totalTokens }
  } catch {
    return null
  }
}

/** Extract the first JSON value (object or array) from a possibly-fenced LLM reply. */
export function parseJsonFromText<T = unknown>(text: string): T | null {
  if (!text) return null
  // Strip ```json fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  // Find the first balanced-looking JSON span.
  const start = candidate.search(/[[{]/)
  if (start === -1) return null
  const open = candidate[start]
  const close = open === '{' ? '}' : ']'
  const end = candidate.lastIndexOf(close)
  if (end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
