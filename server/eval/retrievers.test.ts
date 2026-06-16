import { describe, it, expect } from 'vitest'
import { EVAL_DOCS, EVAL_QUERIES, conceptEmbed } from './corpus'
import { lexicalRetrieve, denseRetrieve, hybridRetrieve } from './retrievers'
import { recallAtK, aggregateMetrics } from './metrics'

const K = 5
const lexical = (q: string) => lexicalRetrieve(EVAL_DOCS, q, K)
const dense = (q: string) => denseRetrieve(EVAL_DOCS, q, K, conceptEmbed)
const hybrid = (q: string) => hybridRetrieve(EVAL_DOCS, q, K, conceptEmbed)

function recallFor(retrieve: (q: string) => string[]) {
  return aggregateMetrics(
    EVAL_QUERIES.map((q) => ({ retrieved: retrieve(q.query), relevant: q.relevantIds })),
    K,
  ).recallAtK
}

function query(id: string) {
  const found = EVAL_QUERIES.find((q) => q.id === id)
  if (!found) throw new Error(`unknown eval query: ${id}`)
  return found
}

describe('hybrid retrieval beats either retriever alone', () => {
  it('hybrid recall@5 >= dense and >= lexical', () => {
    const h = recallFor(hybrid)
    expect(h).toBeGreaterThanOrEqual(recallFor(dense))
    expect(h).toBeGreaterThanOrEqual(recallFor(lexical))
  })

  it('hybrid strictly beats the weaker single retriever on this set', () => {
    const h = recallFor(hybrid)
    expect(h).toBeGreaterThan(Math.min(recallFor(dense), recallFor(lexical)))
  })

  it('lexical alone misses the pure-semantic query (q5)', () => {
    const q5 = query('q5')
    expect(recallAtK(lexical(q5.query), q5.relevantIds, K)).toBe(0)
    expect(recallAtK(dense(q5.query), q5.relevantIds, K)).toBe(1)
  })

  it('dense alone misses the exact-code query (q6)', () => {
    const q6 = query('q6')
    expect(recallAtK(dense(q6.query), q6.relevantIds, K)).toBe(0)
    expect(recallAtK(lexical(q6.query), q6.relevantIds, K)).toBe(1)
  })

  it('hybrid recovers BOTH the q5 and q6 cases', () => {
    const q5 = query('q5')
    const q6 = query('q6')
    expect(recallAtK(hybrid(q5.query), q5.relevantIds, K)).toBe(1)
    expect(recallAtK(hybrid(q6.query), q6.relevantIds, K)).toBe(1)
  })
})
