import { describe, it, expect } from 'vitest'
import { buildResonanceRows } from './fundResonanceBoard'
import type { TurnoverRankEntry } from './fundFlow'

const turnoverEntry = (over: Partial<TurnoverRankEntry> = {}): TurnoverRankEntry => ({
  rank: 1, name: '测试', price: 10, changePct: 5, amount: 1e8, netInflow: 1e7, netInflowPct: 5,
  ...over,
})

describe('buildResonanceRows — 资金共振榜(成交额top-N ∩ 净流入top-N)', () => {
  it('只在成交量榜、不在净流入榜的代码被排除', () => {
    const turnover = new Map([
      ['a', turnoverEntry({ rank: 1, name: 'A', netInflow: 5e7 })],
      ['b', turnoverEntry({ rank: 2, name: 'B', netInflow: 3e7 })],
    ])
    const inflowRank = new Map([['a', 1]]) // b 不在净流入榜
    const rows = buildResonanceRows(turnover, inflowRank, 10)
    expect(rows.map((r) => r.code)).toEqual(['a'])
  })

  it('按 netInflow 降序排序', () => {
    const turnover = new Map([
      ['a', turnoverEntry({ rank: 1, name: 'A', netInflow: 2e7 })],
      ['b', turnoverEntry({ rank: 2, name: 'B', netInflow: 9e7 })],
      ['c', turnoverEntry({ rank: 3, name: 'C', netInflow: 5e7 })],
    ])
    const inflowRank = new Map([['a', 3], ['b', 1], ['c', 2]])
    const rows = buildResonanceRows(turnover, inflowRank, 10)
    expect(rows.map((r) => r.code)).toEqual(['b', 'c', 'a'])
  })

  it('topK 截断', () => {
    const turnover = new Map(
      Array.from({ length: 15 }, (_, i) => [`c${i}`, turnoverEntry({ rank: i + 1, name: `N${i}`, netInflow: 15 - i })] as const),
    )
    const inflowRank = new Map(Array.from({ length: 15 }, (_, i) => [`c${i}`, i + 1] as const))
    const rows = buildResonanceRows(turnover, inflowRank, 10)
    expect(rows).toHaveLength(10)
    expect(rows[0].code).toBe('c0') // netInflow 最大
  })

  it('空输入 → 空结果', () => {
    expect(buildResonanceRows(new Map(), new Map(), 10)).toEqual([])
  })

  it('不修改传入的 Map', () => {
    const turnover = new Map([['a', turnoverEntry()]])
    const inflowRank = new Map([['a', 1]])
    buildResonanceRows(turnover, inflowRank, 10)
    expect(turnover.size).toBe(1)
    expect(inflowRank.size).toBe(1)
  })

  it('surveyByCode 提供时行带 surveyOrgs,榜上无调研的代码为 undefined', () => {
    const turnover = new Map([
      ['a', turnoverEntry({ rank: 1, name: 'A', netInflow: 5e7 })],
      ['b', turnoverEntry({ rank: 2, name: 'B', netInflow: 3e7 })],
    ])
    const inflowRank = new Map([['a', 1], ['b', 2]])
    const rows = buildResonanceRows(turnover, inflowRank, 10, new Map([['a', 13]]))
    expect(rows.find((r) => r.code === 'a')?.surveyOrgs).toBe(13)
    expect(rows.find((r) => r.code === 'b')?.surveyOrgs).toBeUndefined()
  })

  it('surveyByCode 缺省(best-effort 失败)时 surveyOrgs 全为 undefined', () => {
    const turnover = new Map([['a', turnoverEntry({ rank: 1, name: 'A' })]])
    const inflowRank = new Map([['a', 1]])
    const rows = buildResonanceRows(turnover, inflowRank, 10)
    expect(rows[0].surveyOrgs).toBeUndefined()
  })
})
