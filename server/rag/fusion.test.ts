import { describe, it, expect } from 'vitest'
import { reciprocalRankFusion, weightedScoreFusion } from './fusion'

describe('reciprocalRankFusion', () => {
  it('rewards items that rank well across multiple lists', () => {
    // b is rank 2 in A and rank 1 in B → highest combined RRF score
    const fused = reciprocalRankFusion([
      { ids: ['a', 'b', 'c'] },
      { ids: ['b', 'd', 'a'] },
    ])
    expect(fused[0].id).toBe('b')
  })

  it('records the per-list 1-based rank of each id', () => {
    const fused = reciprocalRankFusion([
      { ids: ['a', 'b', 'c'] },
      { ids: ['b', 'd', 'a'] },
    ])
    const a = fused.find((f) => f.id === 'a')!
    expect(a.ranks).toEqual({ 0: 1, 1: 3 })
    const d = fused.find((f) => f.id === 'd')!
    expect(d.ranks).toEqual({ 1: 2 })
  })

  it('weights can promote a list', () => {
    const fused = reciprocalRankFusion([
      { ids: ['a', 'b'], weight: 5 },
      { ids: ['b', 'a'] },
    ])
    // a is rank 1 in the heavily-weighted list → should win
    expect(fused[0].id).toBe('a')
  })

  it('unions ids across lists', () => {
    const fused = reciprocalRankFusion([{ ids: ['a'] }, { ids: ['b'] }])
    expect(new Set(fused.map((f) => f.id))).toEqual(new Set(['a', 'b']))
  })

  it('respects topK', () => {
    const fused = reciprocalRankFusion([{ ids: ['a', 'b', 'c', 'd'] }], { topK: 2 })
    expect(fused.length).toBe(2)
  })

  it('uses k to dampen rank weight', () => {
    const small = reciprocalRankFusion([{ ids: ['a', 'b'] }], { k: 1 })
    const large = reciprocalRankFusion([{ ids: ['a', 'b'] }], { k: 1000 })
    // larger k flattens the gap between rank 1 and rank 2
    const gapSmall = small[0].score - small[1].score
    const gapLarge = large[0].score - large[1].score
    expect(gapSmall).toBeGreaterThan(gapLarge)
  })
})

describe('weightedScoreFusion', () => {
  it('min-max normalizes then sums weighted scores', () => {
    const fused = weightedScoreFusion([
      { hits: [{ id: 'a', score: 100 }, { id: 'b', score: 0 }] },
      { hits: [{ id: 'b', score: 10 }, { id: 'a', score: 5 }] },
    ])
    // a: norm 1.0 (list1) + norm 0.0 (list2) = 1.0 ; b: 0.0 + 1.0 = 1.0 → tie, both present
    expect(new Set(fused.map((f) => f.id))).toEqual(new Set(['a', 'b']))
  })

  it('ignores empty lists without throwing', () => {
    const fused = weightedScoreFusion([{ hits: [] }, { hits: [{ id: 'a', score: 1 }] }])
    expect(fused[0].id).toBe('a')
  })
})
