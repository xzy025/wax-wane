import { describe, expect, it } from 'vitest'
import type { ReportAnalysis } from './research'
import {
  REPORT_TEXT_MAX,
  buildDigestPrompt,
  buildReportPrompt,
  isReportAnalysis,
  isResearchDigestFields,
  truncateForLLM,
} from './researchPrompt'

const VALID_FIELDS = {
  stockName: '宁德时代',
  stockCode: '300750',
  industry: '动力电池',
  brokerage: '测试券商',
  rating: '买入',
  targetPrice: '320-350元',
  thesis: ['全球市占率稳定', '储能第二曲线放量'],
  catalysts: ['储能大单落地'],
  risks: ['碳酸锂价格波动'],
  oneLiner: '动力电池龙头,储能打开第二成长曲线。',
}

const mkAnalysis = (over: Partial<ReportAnalysis> = {}): ReportAnalysis => ({
  ...VALID_FIELDS,
  fingerprint: 'a.pdf|1|1',
  fileName: 'a.pdf',
  date: '2026-07-07',
  analyzedAt: '2026-07-07T09:00:00Z',
  truncated: false,
  ...over,
})

describe('truncateForLLM', () => {
  it('keeps short text untouched', () => {
    expect(truncateForLLM('短文')).toBe('短文')
  })
  it('keeps text exactly at the limit untouched', () => {
    const text = 'x'.repeat(REPORT_TEXT_MAX)
    expect(truncateForLLM(text)).toBe(text)
  })
  it('truncates over-limit text and appends marker', () => {
    const out = truncateForLLM('x'.repeat(REPORT_TEXT_MAX + 1))
    expect(out).toHaveLength(REPORT_TEXT_MAX + '\n[正文已截断]'.length)
    expect(out.endsWith('[正文已截断]')).toBe(true)
  })
})

describe('buildReportPrompt', () => {
  it('includes file name (brokerage/target signal) and body', () => {
    const p = buildReportPrompt('中信-宁德时代.pdf', '正文内容')
    expect(p).toContain('中信-宁德时代.pdf')
    expect(p).toContain('正文内容')
  })
})

describe('isReportAnalysis', () => {
  it('accepts a valid LLM payload', () => {
    expect(isReportAnalysis(VALID_FIELDS)).toBe(true)
  })
  it('accepts nulls for optional fields', () => {
    expect(isReportAnalysis({ ...VALID_FIELDS, stockName: null, targetPrice: null, rating: null })).toBe(true)
  })
  it('rejects missing/empty oneLiner', () => {
    expect(isReportAnalysis({ ...VALID_FIELDS, oneLiner: '' })).toBe(false)
    expect(isReportAnalysis({ ...VALID_FIELDS, oneLiner: undefined })).toBe(false)
  })
  it('rejects non-array thesis and non-object payloads', () => {
    expect(isReportAnalysis({ ...VALID_FIELDS, thesis: '不是数组' })).toBe(false)
    expect(isReportAnalysis(null)).toBe(false)
    expect(isReportAnalysis('{}')).toBe(false)
  })
})

describe('isResearchDigestFields', () => {
  const valid = {
    overview: '今日机构聚焦新能源与AI硬件。',
    hotIndustries: ['动力电池', 'AI硬件'],
    keyStocks: [{ name: '宁德时代', code: '300750', reason: '两家券商同日覆盖' }],
    consensus: '共识在储能放量,分歧在估值。',
  }
  it('accepts valid payload (consensus may be null)', () => {
    expect(isResearchDigestFields(valid)).toBe(true)
    expect(isResearchDigestFields({ ...valid, consensus: null })).toBe(true)
    expect(isResearchDigestFields({ ...valid, keyStocks: [{ name: 'x', code: null, reason: 'r' }] })).toBe(true)
  })
  it('rejects empty overview / bad keyStocks', () => {
    expect(isResearchDigestFields({ ...valid, overview: '' })).toBe(false)
    expect(isResearchDigestFields({ ...valid, keyStocks: [{ code: '300750' }] })).toBe(false)
    expect(isResearchDigestFields(null)).toBe(false)
  })
})

describe('buildDigestPrompt', () => {
  it('carries compact fields only, no full thesis tail', () => {
    const a = mkAnalysis({ thesis: ['一', '二', '三', '四'] })
    const p = buildDigestPrompt([a, mkAnalysis({ fileName: 'b.pdf' })])
    expect(p).toContain('共 2 篇')
    expect(p).toContain('宁德时代')
    expect(p).toContain('"一"')
    expect(p).toContain('"二"')
    expect(p).not.toContain('"三"') // thesis 只带前 2 条
    expect(p).not.toContain('analyzedAt') // 元数据不喂 LLM
  })
})
