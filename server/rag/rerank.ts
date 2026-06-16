// Optional cross-encoder-style reranker (second stage of retrieval).
//
// First stage (BM25 + dense + RRF) is cheap and recall-oriented: cast a wide net
// of candidate_k results. A reranker then re-scores the *query-document pair
// jointly* for precision, so the final top-k is ordered by true relevance rather
// than by fusion rank. Production systems use a cross-encoder (e.g. Cohere Rerank,
// bge-reranker). We don't host one, so we use the configured LLM as the scorer —
// pluggable behind the same interface, and OFF by default (it adds a round-trip).
//
// Graceful by design: if no LLM is configured or the call fails / parses badly,
// rerank() returns null and the caller keeps the fusion ordering.

import { llmComplete, parseJsonFromText, isLLMConfigured } from '../lib/llmComplete'

export interface RerankCandidate {
  id: string
  text: string
}

export interface RerankHit {
  id: string
  /** Relevance score in 0..1. */
  score: number
}

export interface RerankResult {
  hits: RerankHit[]
  totalTokens?: number
}

const SYSTEM_PROMPT =
  'You are a precise search reranker. Given a query and candidate documents, ' +
  'rate each document\'s relevance to the query from 0 (irrelevant) to 10 (perfectly relevant). ' +
  'Respond ONLY with a JSON array of {"id": string, "score": number}. No prose.'

/**
 * Rerank candidates by joint query-document relevance using the configured LLM.
 * Returns null when reranking is unavailable (no LLM) or fails — callers fall
 * back to the pre-rerank order.
 */
export async function llmRerank(
  query: string,
  candidates: RerankCandidate[],
  options: { topK?: number; llmId?: string; maxChars?: number } = {},
): Promise<RerankResult | null> {
  if (candidates.length === 0) return { hits: [] }
  if (!isLLMConfigured(options.llmId)) return null

  const maxChars = options.maxChars ?? 500
  const docLines = candidates
    .map((c, i) => `[${i}] id=${c.id}\n${c.text.slice(0, maxChars).replace(/\s+/g, ' ').trim()}`)
    .join('\n\n')

  const prompt = `Query: ${query}\n\nCandidates:\n${docLines}\n\nReturn the JSON array of {id, score} now.`

  const completion = await llmComplete(prompt, {
    system: SYSTEM_PROMPT,
    maxTokens: 800,
    temperature: 0,
    llmId: options.llmId,
  })
  if (!completion) return null

  const parsed = parseJsonFromText<Array<{ id: string; score: number }>>(completion.text)
  if (!Array.isArray(parsed)) return null

  // Keep only ids we actually sent; normalize 0..10 -> 0..1; clamp.
  const valid = new Map(candidates.map((c) => [c.id, true]))
  const hits: RerankHit[] = parsed
    .filter((r) => r && valid.has(r.id) && typeof r.score === 'number')
    .map((r) => ({ id: r.id, score: Math.min(1, Math.max(0, r.score / 10)) }))

  if (hits.length === 0) return null

  hits.sort((a, b) => b.score - a.score)
  const topK = options.topK ?? hits.length
  return { hits: hits.slice(0, topK), totalTokens: completion.totalTokens }
}
