// Information-retrieval metrics — the offline yardstick for retrieval quality.
//
// "It returned something" tells you nothing; these tell you whether the right
// documents came back and how highly they ranked. All pure functions over a
// ranked list of ids and a set of relevant ids, so they're trivially testable
// and reusable across lexical / dense / hybrid runs.

function relevantSet(relevant: Iterable<string>): Set<string> {
  return relevant instanceof Set ? relevant : new Set(relevant)
}

/** Fraction of all relevant docs that appear in the top-k. */
export function recallAtK(retrieved: string[], relevant: Iterable<string>, k: number): number {
  const rel = relevantSet(relevant)
  if (rel.size === 0) return 0
  const hits = retrieved.slice(0, k).filter((id) => rel.has(id)).length
  return hits / rel.size
}

/** Fraction of the top-k that are relevant. */
export function precisionAtK(retrieved: string[], relevant: Iterable<string>, k: number): number {
  if (k <= 0) return 0
  const rel = relevantSet(relevant)
  const top = retrieved.slice(0, k)
  if (top.length === 0) return 0
  return top.filter((id) => rel.has(id)).length / top.length
}

/** 1 if any relevant doc is in the top-k, else 0. */
export function hitRateAtK(retrieved: string[], relevant: Iterable<string>, k: number): number {
  const rel = relevantSet(relevant)
  return retrieved.slice(0, k).some((id) => rel.has(id)) ? 1 : 0
}

/** Reciprocal of the rank (1-based) of the first relevant doc; 0 if none found. */
export function reciprocalRank(retrieved: string[], relevant: Iterable<string>): number {
  const rel = relevantSet(relevant)
  for (let i = 0; i < retrieved.length; i++) {
    if (rel.has(retrieved[i])) return 1 / (i + 1)
  }
  return 0
}

/** Average Precision at k — rewards placing relevant docs early. */
export function averagePrecisionAtK(retrieved: string[], relevant: Iterable<string>, k: number): number {
  const rel = relevantSet(relevant)
  if (rel.size === 0) return 0
  let hits = 0
  let sum = 0
  const top = retrieved.slice(0, k)
  for (let i = 0; i < top.length; i++) {
    if (rel.has(top[i])) {
      hits++
      sum += hits / (i + 1)
    }
  }
  return sum / Math.min(rel.size, k)
}

/** Discounted Cumulative Gain at k (binary relevance). */
export function dcgAtK(retrieved: string[], relevant: Iterable<string>, k: number): number {
  const rel = relevantSet(relevant)
  let dcg = 0
  const top = retrieved.slice(0, k)
  for (let i = 0; i < top.length; i++) {
    if (rel.has(top[i])) dcg += 1 / Math.log2(i + 2) // i=0 → rank 1 → log2(2)
  }
  return dcg
}

/** Normalized DCG at k (binary relevance), 0..1. */
export function ndcgAtK(retrieved: string[], relevant: Iterable<string>, k: number): number {
  const rel = relevantSet(relevant)
  if (rel.size === 0) return 0
  const dcg = dcgAtK(retrieved, relevant, k)
  let idcg = 0
  for (let i = 0; i < Math.min(rel.size, k); i++) idcg += 1 / Math.log2(i + 2)
  return idcg === 0 ? 0 : dcg / idcg
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

export interface RetrievalMetrics {
  recallAtK: number
  precisionAtK: number
  mrr: number
  ndcgAtK: number
  mapAtK: number
}

/** Aggregate the standard metric bundle across a set of (retrieved, relevant) cases. */
export function aggregateMetrics(
  cases: Array<{ retrieved: string[]; relevant: Iterable<string> }>,
  k: number,
): RetrievalMetrics {
  return {
    recallAtK: mean(cases.map((c) => recallAtK(c.retrieved, c.relevant, k))),
    precisionAtK: mean(cases.map((c) => precisionAtK(c.retrieved, c.relevant, k))),
    mrr: mean(cases.map((c) => reciprocalRank(c.retrieved, c.relevant))),
    ndcgAtK: mean(cases.map((c) => ndcgAtK(c.retrieved, c.relevant, k))),
    mapAtK: mean(cases.map((c) => averagePrecisionAtK(c.retrieved, c.relevant, k))),
  }
}
