import { describe, it, expect } from 'vitest'
import {
  recallAtK,
  precisionAtK,
  hitRateAtK,
  reciprocalRank,
  averagePrecisionAtK,
  ndcgAtK,
  aggregateMetrics,
  mean,
} from './metrics'

describe('retrieval metrics', () => {
  it('recallAtK = relevant found in top-k / total relevant', () => {
    expect(recallAtK(['a', 'b', 'c'], ['a', 'c'], 3)).toBe(1)
    expect(recallAtK(['a', 'x', 'y'], ['a', 'c'], 3)).toBe(0.5)
    expect(recallAtK(['x', 'y', 'a'], ['a', 'c'], 2)).toBe(0) // a is beyond k=2
  })

  it('precisionAtK = relevant in top-k / k', () => {
    expect(precisionAtK(['a', 'b', 'c'], ['a'], 3)).toBeCloseTo(1 / 3)
    expect(precisionAtK(['a', 'b'], ['a', 'b'], 2)).toBe(1)
  })

  it('hitRateAtK is 1 if any relevant in top-k', () => {
    expect(hitRateAtK(['x', 'a'], ['a'], 2)).toBe(1)
    expect(hitRateAtK(['x', 'y'], ['a'], 2)).toBe(0)
  })

  it('reciprocalRank reflects the first relevant position', () => {
    expect(reciprocalRank(['a'], ['a'])).toBe(1)
    expect(reciprocalRank(['x', 'a'], ['a'])).toBe(0.5)
    expect(reciprocalRank(['x', 'y'], ['a'])).toBe(0)
  })

  it('averagePrecisionAtK rewards early relevant docs', () => {
    // both relevant, ranked 1 and 2 → AP = (1/1 + 2/2)/2 = 1
    expect(averagePrecisionAtK(['a', 'b', 'x'], ['a', 'b'], 3)).toBeCloseTo(1)
    // relevant ranked 1 and 3 → AP = (1/1 + 2/3)/2 = 0.833
    expect(averagePrecisionAtK(['a', 'x', 'b'], ['a', 'b'], 3)).toBeCloseTo((1 + 2 / 3) / 2)
  })

  it('ndcgAtK is 1 for ideal ordering and lower otherwise', () => {
    expect(ndcgAtK(['a', 'b', 'x'], ['a', 'b'], 3)).toBeCloseTo(1)
    const reversed = ndcgAtK(['x', 'a', 'b'], ['a', 'b'], 3)
    expect(reversed).toBeLessThan(1)
    expect(reversed).toBeGreaterThan(0)
  })

  it('handles empty relevant set without NaN', () => {
    expect(recallAtK(['a'], [], 3)).toBe(0)
    expect(ndcgAtK(['a'], [], 3)).toBe(0)
  })

  it('aggregateMetrics averages across cases', () => {
    const m = aggregateMetrics(
      [
        { retrieved: ['a', 'b'], relevant: ['a'] },
        { retrieved: ['x', 'y'], relevant: ['z'] },
      ],
      2,
    )
    expect(m.recallAtK).toBe(0.5) // (1 + 0) / 2
    expect(mean([1, 0])).toBe(0.5)
  })
})
