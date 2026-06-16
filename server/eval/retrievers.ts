// In-memory retrievers for the eval harness.
//
// These run over a fixed document set with no DB / network, so the eval is
// deterministic and runnable anywhere. They reuse the *same* BM25 and RRF code
// as the production hybrid path (rag/bm25.ts, rag/fusion.ts) — only the corpus
// source and the embedder differ. The embedder is injected so the harness can
// compare the app's real fallback embedder against a richer one.

import { Bm25Index } from '../rag/bm25'
import { reciprocalRankFusion } from '../rag/fusion'

export interface EvalDoc {
  id: string
  text: string
}

export type EmbedFn = (text: string) => number[]

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

/** Lexical (BM25) retrieval → ranked doc ids. */
export function lexicalRetrieve(docs: EvalDoc[], query: string, k: number): string[] {
  return new Bm25Index(docs).search(query, k).map((h) => h.id)
}

/**
 * Dense (cosine) retrieval → ranked doc ids. Only returns docs with positive
 * similarity, so a query that embeds to a zero vector yields nothing (the
 * embedder simply has no signal for it) rather than arbitrary noise.
 */
export function denseRetrieve(docs: EvalDoc[], query: string, k: number, embed: EmbedFn): string[] {
  const q = embed(query)
  return docs
    .map((d) => ({ id: d.id, score: cosine(q, embed(d.text)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((r) => r.id)
}

export interface HybridOptions {
  /** Candidates pulled from each retriever before fusion. Default max(k*4, 20). */
  candidateK?: number
  rrfK?: number
  weights?: { dense?: number; lexical?: number }
}

/** Hybrid retrieval: RRF fusion of dense + lexical → ranked doc ids. */
export function hybridRetrieve(
  docs: EvalDoc[],
  query: string,
  k: number,
  embed: EmbedFn,
  options: HybridOptions = {},
): string[] {
  const candidateK = options.candidateK ?? Math.max(k * 4, 20)
  const dense = denseRetrieve(docs, query, candidateK, embed)
  const lexical = lexicalRetrieve(docs, query, candidateK)
  return reciprocalRankFusion(
    [
      { ids: dense, weight: options.weights?.dense ?? 1 },
      { ids: lexical, weight: options.weights?.lexical ?? 1 },
    ],
    { k: options.rrfK ?? 60, topK: k },
  ).map((f) => f.id)
}
