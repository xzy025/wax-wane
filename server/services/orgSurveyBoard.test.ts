import { describe, it, expect } from 'vitest'
import { rankOrgSurveyRows } from './orgSurveyBoard'
import type { OrgSurveyAgg } from './orgSurvey'
import type { IndexQuote } from './emQuotes'

const agg = (over: Partial<OrgSurveyAgg> = {}): OrgSurveyAgg => ({ orgs: 1, surveyDays: 1, latestDate: '2026-06-20', ...over })
const quote = (over: Partial<IndexQuote> = {}): IndexQuote => ({
  code: '000001', name: '测试', price: 10, changePct: 1, changeAmt: 0.1,
  volume: 1000, turnover: 1e7, high: 11, low: 9, open: 10, prevClose: 9.9,
  ...over,
})

describe('rankOrgSurveyRows — 机构调研榜', () => {
  it('按 orgs 降序排序', () => {
    const aggMap = new Map([
      ['a', agg({ orgs: 3 })],
      ['b', agg({ orgs: 8 })],
      ['c', agg({ orgs: 5 })],
    ])
    const quotes = new Map([
      ['a', quote({ code: 'a', name: 'A' })],
      ['b', quote({ code: 'b', name: 'B' })],
      ['c', quote({ code: 'c', name: 'C' })],
    ])
    const rows = rankOrgSurveyRows(aggMap, quotes, 40)
    expect(rows.map((r) => r.code)).toEqual(['b', 'c', 'a'])
  })

  it('orgs 并列时按 latestDate 新到旧', () => {
    const aggMap = new Map([
      ['a', agg({ orgs: 5, latestDate: '2026-06-10' })],
      ['b', agg({ orgs: 5, latestDate: '2026-06-25' })],
    ])
    const quotes = new Map([
      ['a', quote({ code: 'a', name: 'A' })],
      ['b', quote({ code: 'b', name: 'B' })],
    ])
    const rows = rankOrgSurveyRows(aggMap, quotes, 40)
    expect(rows.map((r) => r.code)).toEqual(['b', 'a'])
  })

  it('max 截断', () => {
    const aggMap = new Map(Array.from({ length: 50 }, (_, i) => [`c${i}`, agg({ orgs: 50 - i })] as const))
    const quotes = new Map(Array.from({ length: 50 }, (_, i) => [`c${i}`, quote({ code: `c${i}`, name: `N${i}` })] as const))
    const rows = rankOrgSurveyRows(aggMap, quotes, 40)
    expect(rows).toHaveLength(40)
    expect(rows[0].code).toBe('c0') // orgs 最大
  })

  it('agg 有但 quotes 查无名称的 code 被丢弃(不渲染空白行)', () => {
    const aggMap = new Map([
      ['a', agg({ orgs: 5 })],
      ['b', agg({ orgs: 3 })], // 无对应 quote
    ])
    const quotes = new Map([['a', quote({ code: 'a', name: 'A' })]])
    const rows = rankOrgSurveyRows(aggMap, quotes, 40)
    expect(rows.map((r) => r.code)).toEqual(['a'])
  })

  it('quotes 里 name 为空字符串的也丢弃', () => {
    const aggMap = new Map([['a', agg({ orgs: 5 })]])
    const quotes = new Map([['a', quote({ code: 'a', name: '' })]])
    expect(rankOrgSurveyRows(aggMap, quotes, 40)).toEqual([])
  })
})
