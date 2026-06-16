import { describe, it, expect } from 'vitest'
import { tokenize, hasHan } from './tokenize'
import { Bm25Index, bm25Search } from './bm25'

describe('tokenize', () => {
  it('produces Han unigrams and adjacent bigrams', () => {
    const tokens = tokenize('白酒板块')
    expect(tokens).toEqual(expect.arrayContaining(['白', '酒', '板', '块', '白酒', '酒板', '板块']))
  })

  it('does not form bigrams across non-Han boundaries', () => {
    // 白酒 and 板块 are separated by a space → no 酒板 bigram
    const tokens = tokenize('白酒 板块')
    expect(tokens).toContain('白酒')
    expect(tokens).toContain('板块')
    expect(tokens).not.toContain('酒板')
  })

  it('lowercases latin words and keeps numeric codes whole', () => {
    const tokens = tokenize('Wyckoff 300750 20.5%')
    expect(tokens).toContain('wyckoff')
    expect(tokens).toContain('300750')
    expect(tokens).toContain('20.5')
  })

  it('returns empty for empty input', () => {
    expect(tokenize('')).toEqual([])
  })

  it('hasHan detects Chinese characters', () => {
    expect(hasHan('追高')).toBe(true)
    expect(hasHan('wyckoff')).toBe(false)
  })
})

describe('Bm25Index', () => {
  const docs = [
    { id: 'a', text: '白酒 追高 亏损 茅台' },
    { id: 'b', text: '白酒 板块 轮动' },
    { id: 'c', text: '半导体 突破 放量' },
    { id: 'd', text: '宁德时代 300750 动力电池' },
  ]

  it('only returns docs that contain query terms', () => {
    const hits = new Bm25Index(docs).search('追高亏损', 5)
    expect(hits.map((h) => h.id)).toEqual(['a'])
  })

  it('ranks the doc with more/ rarer matches first', () => {
    const hits = new Bm25Index(docs).search('白酒', 5)
    const ids = hits.map((h) => h.id)
    expect(ids).toEqual(expect.arrayContaining(['a', 'b']))
    expect(ids).not.toContain('c')
  })

  it('matches rare exact tokens like a stock code', () => {
    const hits = bm25Search(docs, '300750', 5)
    expect(hits.map((h) => h.id)).toEqual(['d'])
  })

  it('returns nothing for a query with no overlapping terms', () => {
    expect(bm25Search(docs, '新能源汽车', 5)).toEqual([])
  })

  it('respects topK', () => {
    expect(bm25Search(docs, '白酒 半导体 300750', 1).length).toBe(1)
  })

  it('handles an empty corpus', () => {
    expect(new Bm25Index([]).search('白酒').length).toBe(0)
  })

  it('produces positive, finite scores', () => {
    const hits = bm25Search(docs, '白酒 追高', 5)
    for (const h of hits) {
      expect(h.score).toBeGreaterThan(0)
      expect(Number.isFinite(h.score)).toBe(true)
    }
  })
})
