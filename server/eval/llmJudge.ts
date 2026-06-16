// LLM-as-judge — the generation-quality half of eval.
//
// Retrieval metrics (metrics.ts) score *which docs* came back. They can't score
// a free-text answer. LLM-as-judge does: a strong model rates an answer's
// faithfulness (is it grounded in the retrieved context, or hallucinated?) and
// relevancy (does it actually answer the question?). This is the standard
// RAGAS-style approach; here it's a thin, provider-agnostic wrapper.
//
// Returns null when no LLM is configured or the call/parse fails, so callers
// treat judging as an optional layer rather than a hard dependency.

import { llmComplete, parseJsonFromText, isLLMConfigured } from '../lib/llmComplete'

export interface JudgeInput {
  query: string
  answer: string
  /** Retrieved context the answer was supposed to be grounded in. */
  context: string[]
}

export interface JudgeVerdict {
  /** 0..1 — is the answer supported by the context (no hallucination)? */
  faithfulness: number
  /** 0..1 — does the answer address the query? */
  relevancy: number
  /** Mean of the two, for quick ranking. */
  score: number
  reasoning: string
}

const SYSTEM_PROMPT =
  'You are a strict RAG answer judge. Given a question, the retrieved context, and an answer, ' +
  'score the answer on two axes from 0.0 to 1.0:\n' +
  '- faithfulness: is every claim supported by the context? Penalize anything not in the context.\n' +
  '- relevancy: does the answer actually address the question?\n' +
  'Respond ONLY with JSON: {"faithfulness": number, "relevancy": number, "reasoning": string}.'

export function isJudgeAvailable(llmId?: string): boolean {
  return isLLMConfigured(llmId)
}

export async function judgeAnswer(input: JudgeInput, llmId?: string): Promise<JudgeVerdict | null> {
  if (!isLLMConfigured(llmId)) return null

  const prompt = [
    `Question:\n${input.query}`,
    `Retrieved context:\n${input.context.map((c, i) => `[${i + 1}] ${c}`).join('\n')}`,
    `Answer:\n${input.answer}`,
    'Return the JSON verdict now.',
  ].join('\n\n')

  const completion = await llmComplete(prompt, { system: SYSTEM_PROMPT, maxTokens: 400, temperature: 0, llmId })
  if (!completion) return null

  const parsed = parseJsonFromText<{ faithfulness: number; relevancy: number; reasoning?: string }>(completion.text)
  if (!parsed || typeof parsed.faithfulness !== 'number' || typeof parsed.relevancy !== 'number') return null

  const faithfulness = clamp01(parsed.faithfulness)
  const relevancy = clamp01(parsed.relevancy)
  return {
    faithfulness,
    relevancy,
    score: (faithfulness + relevancy) / 2,
    reasoning: parsed.reasoning ?? '',
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}
