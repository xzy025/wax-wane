// Hybrid retrieval orchestrator: dense (pgvector) + lexical (BM25) → RRF fusion
// → optional LLM rerank. Each stage is traced (see observability/tracer.ts) and
// degrades independently: if one retriever throws (e.g. DB in limited mode), the
// span records the error and the other retriever's results still flow through.

import { searchSimilar, getCorpus, type SearchResult } from './vectorStore'
import { Bm25Index } from './bm25'
import { reciprocalRankFusion } from './fusion'
import { llmRerank } from './rerank'
import { tracer, type ActiveTrace } from '../observability/tracer'

export interface HybridSearchOptions {
  topK?: number
  type?: string
  /** Candidates pulled from each retriever before fusion. Default max(topK*4, 20). */
  candidateK?: number
  /** Run the LLM reranker over fused candidates. Default false (adds a round-trip). */
  useRerank?: boolean
  /** RRF dampening constant. Default 60. */
  rrfK?: number
  /** Per-retriever fusion weights. Default { dense: 1, lexical: 1 }. */
  weights?: { dense?: number; lexical?: number }
  /** Reuse an outer trace instead of starting one (the orchestrator won't end it). */
  trace?: ActiveTrace
}

export interface HybridHit extends SearchResult {
  /** RRF fused score. */
  fusedScore: number
  /** 1-based rank within each retriever (absent = not retrieved by that one). */
  ranks: { dense?: number; lexical?: number }
  /** Reranker relevance (0..1) when reranking ran. */
  rerankScore?: number
}

export interface HybridSearchResponse {
  query: string
  results: HybridHit[]
  meta: {
    denseCount: number
    lexicalCount: number
    fusedCount: number
    reranked: boolean
    traceId: string
    tookMs: number
  }
}

export async function hybridSearch(
  query: string,
  options: HybridSearchOptions = {},
): Promise<HybridSearchResponse> {
  const topK = options.topK ?? 5
  const candidateK = options.candidateK ?? Math.max(topK * 4, 20)
  const rrfK = options.rrfK ?? 60
  const wDense = options.weights?.dense ?? 1
  const wLexical = options.weights?.lexical ?? 1

  const ownsTrace = !options.trace
  const trace = options.trace ?? tracer.startTrace('rag.hybridSearch', { query, type: options.type ?? 'all' })

  // Maps every retrieved id to its document, so fused ids resolve to text/metadata.
  const docMap = new Map<string, SearchResult>()

  // ── Stage 1a: dense (semantic) ──
  const denseSpan = trace.startSpan('dense', 'retrieval', { candidateK })
  let dense: SearchResult[] = []
  try {
    dense = await searchSimilar(query, candidateK, options.type)
    for (const d of dense) docMap.set(d.id, d)
    denseSpan.end({ count: dense.length })
  } catch (err) {
    denseSpan.fail(err)
  }

  // ── Stage 1b: lexical (BM25) ──
  const lexSpan = trace.startSpan('lexical', 'lexical', { candidateK })
  let lexical: Array<{ id: string; score: number }> = []
  try {
    const corpus = await getCorpus(options.type)
    const index = new Bm25Index(corpus)
    lexical = index.search(query, candidateK)
    const byId = new Map(corpus.map((d) => [d.id, d]))
    for (const hit of lexical) {
      const doc = byId.get(hit.id)
      if (doc && !docMap.has(hit.id)) docMap.set(hit.id, { ...doc, score: hit.score })
    }
    lexSpan.end({ count: lexical.length, corpusSize: corpus.length })
  } catch (err) {
    lexSpan.fail(err)
  }

  // ── Stage 2: RRF fusion ──
  const fuseSpan = trace.startSpan('fusion', 'fusion', { rrfK, wDense, wLexical })
  const fused = reciprocalRankFusion(
    [
      { ids: dense.map((d) => d.id), weight: wDense },
      { ids: lexical.map((l) => l.id), weight: wLexical },
    ],
    { k: rrfK },
  )
  fuseSpan.end({ fusedCount: fused.length })

  let hits: HybridHit[] = fused.map((f) => {
    const doc = docMap.get(f.id)
    return {
      id: f.id,
      text: doc?.text ?? '',
      metadata: doc?.metadata ?? {},
      score: doc?.score ?? 0,
      fusedScore: f.score,
      ranks: { dense: f.ranks[0], lexical: f.ranks[1] },
    }
  })

  // ── Stage 3: optional rerank ──
  let reranked = false
  if (options.useRerank && hits.length > 0) {
    const rerankSpan = trace.startSpan('rerank', 'rerank', { candidates: hits.length })
    try {
      const result = await llmRerank(
        query,
        hits.map((h) => ({ id: h.id, text: h.text })),
        { topK: candidateK },
      )
      if (result && result.hits.length > 0) {
        const scoreById = new Map(result.hits.map((r) => [r.id, r.score]))
        hits = hits
          .map((h) => ({ ...h, rerankScore: scoreById.get(h.id) }))
          .sort((a, b) => (b.rerankScore ?? -1) - (a.rerankScore ?? -1))
        reranked = true
      }
      rerankSpan.end({ reranked, totalTokens: result?.totalTokens })
    } catch (err) {
      rerankSpan.fail(err)
    }
  }

  const results = hits.slice(0, topK)

  if (ownsTrace) {
    trace.end({ resultCount: results.length, denseCount: dense.length, lexicalCount: lexical.length, reranked })
  }

  return {
    query,
    results,
    meta: {
      denseCount: dense.length,
      lexicalCount: lexical.length,
      fusedCount: fused.length,
      reranked,
      traceId: trace.id,
      tookMs: trace.trace.durationMs ?? (ownsTrace ? 0 : Date.now() - trace.trace.startMs),
    },
  }
}
