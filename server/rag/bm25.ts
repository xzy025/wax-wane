// Okapi BM25 lexical search — the sparse half of hybrid retrieval.
//
// Dense (pgvector) retrieval is great at paraphrase but blind to rare exact
// tokens: a stock code "300750", a tag "追高", or "Wyckoff" can be semantically
// "averaged away" in embedding space. BM25 nails exact-term matches and is a
// well-known complement to dense retrieval. We fuse the two rankings with RRF
// (see fusion.ts) rather than picking one.
//
// Pure and dependency-free: builds an in-memory index over a document set and
// scores queries. The corpus here is small (a single trader's review history),
// so a full in-process index is simpler and faster than wiring Postgres FTS
// (which would also need a Chinese parser extension like zhparser/pg_jieba).

import { tokenize } from './tokenize'

export interface Bm25Doc {
  id: string
  text: string
}

export interface Bm25Hit {
  id: string
  score: number
}

export interface Bm25Options {
  /** Term-frequency saturation. Higher = TF matters more. Default 1.5. */
  k1?: number
  /** Length normalization. 0 = off, 1 = full. Default 0.75. */
  b?: number
}

export class Bm25Index {
  private readonly k1: number
  private readonly b: number
  private readonly docIds: string[] = []
  private readonly docTerms: Map<string, number>[] = [] // per-doc term -> tf
  private readonly docLen: number[] = []
  private readonly df = new Map<string, number>() // term -> # docs containing it
  private avgdl = 0

  constructor(docs: Bm25Doc[], options: Bm25Options = {}) {
    this.k1 = options.k1 ?? 1.5
    this.b = options.b ?? 0.75

    let totalLen = 0
    for (const doc of docs) {
      const terms = tokenize(doc.text)
      const tf = new Map<string, number>()
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1)

      this.docIds.push(doc.id)
      this.docTerms.push(tf)
      this.docLen.push(terms.length)
      totalLen += terms.length

      for (const term of tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1)
    }

    this.avgdl = docs.length > 0 ? totalLen / docs.length : 0
  }

  get size(): number {
    return this.docIds.length
  }

  /** Probabilistic IDF with the standard +0.5 smoothing, floored at 0 to avoid
   *  negative weights for terms present in more than half the corpus. */
  private idf(term: string): number {
    const n = this.docIds.length
    const df = this.df.get(term) ?? 0
    return Math.max(0, Math.log(1 + (n - df + 0.5) / (df + 0.5)))
  }

  /** Score every document against the query and return the top-K by BM25 score. */
  search(query: string, topK = 5): Bm25Hit[] {
    const queryTerms = [...new Set(tokenize(query))]
    if (queryTerms.length === 0 || this.docIds.length === 0) return []

    const hits: Bm25Hit[] = []
    for (let i = 0; i < this.docIds.length; i++) {
      const tf = this.docTerms[i]
      const len = this.docLen[i]
      let score = 0
      for (const term of queryTerms) {
        const freq = tf.get(term)
        if (!freq) continue
        const idf = this.idf(term)
        if (idf === 0) continue
        const denom = freq + this.k1 * (1 - this.b + (this.b * len) / (this.avgdl || 1))
        score += idf * ((freq * (this.k1 + 1)) / denom)
      }
      if (score > 0) hits.push({ id: this.docIds[i], score })
    }

    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, topK)
  }
}

/** Convenience: one-shot BM25 search over an ad-hoc document set. */
export function bm25Search(
  docs: Bm25Doc[],
  query: string,
  topK = 5,
  options?: Bm25Options,
): Bm25Hit[] {
  return new Bm25Index(docs, options).search(query, topK)
}
