import { describe, it, expect } from 'vitest'
import { shouldGenerateNarrative, isReviewResult, hasReviewContent, type DailyReviewData } from './dailyReview'

describe('shouldGenerateNarrative — LLM 叙事门控(纯时钟判定)', () => {
  it('工作日盘中 → false', () => {
    expect(shouldGenerateNarrative(4, 10 * 60)).toBe(false) // 周四 10:00
    expect(shouldGenerateNarrative(1, 14 * 60)).toBe(false) // 周一 14:00
  })

  it('工作日 15:05 → false(15:10 前留收盘数据定盘缓冲)', () => {
    expect(shouldGenerateNarrative(4, 15 * 60 + 5)).toBe(false)
  })

  it('工作日 15:10 及之后 → true', () => {
    expect(shouldGenerateNarrative(4, 15 * 60 + 10)).toBe(true)
    expect(shouldGenerateNarrative(5, 20 * 60)).toBe(true)
  })

  it('周末任意时刻 → false(非交易日不生成,借用最近存档叙事)', () => {
    expect(shouldGenerateNarrative(6, 9 * 60)).toBe(false) // 周六 09:00
    expect(shouldGenerateNarrative(0, 16 * 60)).toBe(false) // 周日 16:00
  })
})

describe('hasReviewContent — 空壳保护(全空不落盘不进缓存)', () => {
  const empty: DailyReviewData = {
    asof: '2026-07-02',
    generatedAt: '',
    overnight: [],
    asia: [],
    news: [],
    dragonTiger: [],
    calendar: [{ date: '2026-07-03', country: '美国', name: '非农就业报告', star: 3, source: 'builtin' }],
    calendarSource: 'builtin',
    ashare: null,
    structure: null,
    narrative: null,
  }

  it('只有 builtin 日历 → 空壳(日历不计入)', () => {
    expect(hasReviewContent(empty)).toBe(false)
  })

  it('任一数据段有内容 → 有效', () => {
    expect(hasReviewContent({ ...empty, asia: [{ code: 'N225', name: '日经225', price: 1, changePct: 0 }] })).toBe(true)
    expect(hasReviewContent({ ...empty, news: [{ title: 'x', summary: '', source: '财联社', link: '' }] })).toBe(true)
  })

  it('ashare 非 null 但 indices 空 + turnover=0 哨兵 → 仍算空壳', () => {
    const d = { ...empty, ashare: { indices: [], totalTurnover: 0, limitUp: 0, limitDown: 0, advance: 0, decline: 0 } }
    expect(hasReviewContent(d)).toBe(false)
  })

  it('structure 非 null 但象限全 0(上游限流) → 仍算空壳', () => {
    const d = { ...empty, structure: { hsCount: 0, lsCount: 0, hwCount: 0, lwCount: 0, shortUpPct: 0, topHs: [], topLs: [] } }
    expect(hasReviewContent(d)).toBe(false)
  })
})

describe('isReviewResult — 磁盘存档 shape guard', () => {
  it('合法存档 → true', () => {
    expect(isReviewResult({ asof: '2026-07-02', overnight: [], calendar: [] })).toBe(true)
  })

  it('缺 asof / overnight 非数组 / null / 原始类型 → false', () => {
    expect(isReviewResult({ overnight: [], calendar: [] })).toBe(false)
    expect(isReviewResult({ asof: '2026-07-02', overnight: {}, calendar: [] })).toBe(false)
    expect(isReviewResult(null)).toBe(false)
    expect(isReviewResult('x')).toBe(false)
  })
})
