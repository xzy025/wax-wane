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

  it('knownBy 防前视:披露日晚于 knownBy 的调研不计(调研发生≠当天可知)', () => {
    const lagged: SurveyEvent[] = [
      { date: '2026-06-10', org: '易方达基金', noticeDate: '2026-06-11' }, // 次日披露(典型)
      { date: '2026-06-12', org: '高瓴资本', noticeDate: '2026-07-04' }, // 长尾:滞后近一月
      { date: '2026-06-12', org: '融通基金' }, // 无披露日 → 退回按调研日判断
    ]
    // 信号日 6-12:高瓴 7-04 才披露,实盘查不到 → 只计易方达 + 融通
    expect(countOrgsInRange(lagged, '2026-06-09', '2026-06-12', '2026-06-12')).toBe(2)
    // 信号日 6-10:易方达 6-11 披露也还看不到,融通/高瓴在窗口但未披露或窗口外
    expect(countOrgsInRange(lagged, '2026-06-08', '2026-06-10', '2026-06-10')).toBe(0)
    // 不传 knownBy(live 语义)→ 不做披露过滤
    expect(countOrgsInRange(lagged, '2026-06-09', '2026-06-12')).toBe(3)
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
