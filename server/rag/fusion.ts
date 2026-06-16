// Rank fusion — combine several ranked result lists into one.
//
// We default to Reciprocal Rank Fusion (RRF). RRF is rank-based, not score-
// based, which is exactly what we want when fusing BM25 scores (unbounded) with
// cosine similarities (0..1): the two score scales are incomparable, but their
// *rankings* are. RRF is also robust — a single list ranking an item #1 can't
// dominate just because its raw scores happen to be large.
//
//   score(d) = Σ_lists  weight_list / (k + rank_list(d))     (rank is 1-based)
//
// k (default 60, from the original Cormack et al. paper) dampens the weight of
// top ranks so lower-ranked agreements still count.

export interface FusionInput {
  /** Ordered list of document ids, best first. */
  ids: string[]
  /** Optional weight for this list (default 1). */
  weight?: number
}

export interface FusedHit {
  id: string
  score: number
  /** 1-based rank of this id within each contributing list (id -> rank). */
  ranks: Record<number, number>
}

export interface RrfOptions {
  /** Rank dampening constant. Default 60. */
  k?: number
  /** Cap the output length. Default: all fused ids. */
  topK?: number
}

/**
 * Reciprocal Rank Fusion over N ranked id lists.
 * Returns ids sorted by fused score (desc), each annotated with its per-list rank.
 */
export function reciprocalRankFusion(lists: FusionInput[], options: RrfOptions = {}): FusedHit[] {
  const k = options.k ?? 60
  const acc = new Map<string, FusedHit>()

  lists.forEach((list, listIndex) => {
    const weight = list.weight ?? 1
    list.ids.forEach((id, i) => {
      const rank = i + 1 // 1-based
      const entry = acc.get(id) ?? { id, score: 0, ranks: {} }
      entry.score += weight / (k + rank)
      entry.ranks[listIndex] = rank
      acc.set(id, entry)
    })
  })

  const fused = [...acc.values()].sort((a, b) => b.score - a.score)
  return options.topK ? fused.slice(0, options.topK) : fused
}

/**
 * Min-max normalize each list's scores to 0..1, then take a weighted sum.
 * Offered as an alternative to RRF when callers genuinely want score magnitudes
 * (not just ranks) to influence the blend. RRF is the default elsewhere.
 */
export function weightedScoreFusion(
  lists: Array<{ hits: Array<{ id: string; score: number }>; weight?: number }>,
  topK?: number,
): Array<{ id: string; score: number }> {
  const acc = new Map<string, number>()

  for (const { hits, weight = 1 } of lists) {
    if (hits.length === 0) continue
    const scores = hits.map((h) => h.score)
    const min = Math.min(...scores)
    const max = Math.max(...scores)
    const range = max - min
    for (const h of hits) {
      const norm = range > 0 ? (h.score - min) / range : 1
      acc.set(h.id, (acc.get(h.id) ?? 0) + weight * norm)
    }
  }

  const fused = [...acc.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
  return topK ? fused.slice(0, topK) : fused
}
