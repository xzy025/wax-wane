import { describe, it, expect } from 'vitest'
import { isInstitution, countOrgsInRange, aggregateSurvey, type SurveyEvent } from './orgSurvey'

describe('isInstitution', () => {
  it('保留真机构,剔除媒体/通讯社', () => {
    expect(isInstitution('易方达基金')).toBe(true)
    expect(isInstitution('高瓴资本')).toBe(true)
    expect(isInstitution('中国证券报')).toBe(false)
    expect(isInstitution('证券时报')).toBe(false)
    expect(isInstitution('第一财经')).toBe(true) // 不含媒体子串
    expect(isInstitution('财经网')).toBe(false)
    expect(isInstitution('  ')).toBe(false)
  })
})

const ev = (date: string, org: string): SurveyEvent => ({ date, org })

describe('countOrgsInRange', () => {
  const events: SurveyEvent[] = [
    ev('2026-06-10', '易方达基金'),
    ev('2026-06-12', '高瓴资本'),
    ev('2026-06-12', '易方达基金'), // 重复机构,distinct 计 1
    ev('2026-06-12', '证券时报'), // 媒体,不计
    ev('2026-06-25', '景林资产'), // 窗口外
  ]

  it('窗口内 distinct 机构家数(去重 + 剔媒体)', () => {
    expect(countOrgsInRange(events, '2026-06-09', '2026-06-15')).toBe(2) // 易方达 + 高瓴
  })

  it('端点含(inclusive)', () => {
    expect(countOrgsInRange(events, '2026-06-12', '2026-06-12')).toBe(2) // 高瓴 + 易方达,媒体不计
  })

  it('窗口外不计', () => {
    expect(countOrgsInRange(events, '2026-06-01', '2026-06-05')).toBe(0)
  })
})

describe('aggregateSurvey', () => {
  it('聚合 distinct 机构 / 调研日 / 最近日', () => {
    const agg = aggregateSurvey([
      ev('2026-06-10', '易方达基金'),
      ev('2026-06-10', '高瓴资本'),
      ev('2026-06-12', '易方达基金'),
      ev('2026-06-12', '中国证券报'), // 媒体不计入 orgs
    ])
    expect(agg.orgs).toBe(2) // 易方达 + 高瓴
    expect(agg.surveyDays).toBe(2) // 06-10, 06-12
    expect(agg.latestDate).toBe('2026-06-12')
  })
})
