import { describe, it, expect } from 'vitest'
import {
  parseReportFilename,
  pickLatestReportFile,
  extractStockNameFromReport,
  summarizeReport,
} from './fundamentalArchive'

describe('parseReportFilename', () => {
  it('parses a valid archive filename', () => {
    expect(parseReportFilename('300750-2026-06-10.md')).toEqual({
      filename: '300750-2026-06-10.md',
      code: '300750',
      date: '2026-06-10',
    })
  })

  it('rejects non-archive files', () => {
    expect(parseReportFilename('README.md')).toBeNull()
    expect(parseReportFilename('30075-2026-06-10.md')).toBeNull() // 5-digit code
    expect(parseReportFilename('300750-2026-6-10.md')).toBeNull() // non-padded date
    expect(parseReportFilename('300750-2026-06-10.txt')).toBeNull()
    expect(parseReportFilename('300750-2026-06-10.md.bak')).toBeNull()
  })
})

describe('pickLatestReportFile', () => {
  const files = [
    '300750-2025-10-24.md',
    '300750-2026-06-10.md',
    '600519-2026-01-01.md',
    'README.md',
  ]

  it('picks the newest report for the requested code', () => {
    expect(pickLatestReportFile(files, '300750')?.date).toBe('2026-06-10')
  })

  it('is order-independent', () => {
    expect(pickLatestReportFile([...files].reverse(), '300750')?.date).toBe('2026-06-10')
  })

  it('sorts dates across year/month boundaries', () => {
    const refs = ['000001-2025-12-31.md', '000001-2026-01-01.md']
    expect(pickLatestReportFile(refs, '000001')?.date).toBe('2026-01-01')
  })

  it('returns null when the code has no reports', () => {
    expect(pickLatestReportFile(files, '000001')).toBeNull()
    expect(pickLatestReportFile([], '300750')).toBeNull()
  })
})

describe('extractStockNameFromReport', () => {
  it('extracts the name from a real report heading (half-width parens)', () => {
    const md = '# 宁德时代 (300750) — 一页纸速览 (2025-10-24)\n\n## 公司概况\n…'
    expect(extractStockNameFromReport(md)).toBe('宁德时代')
  })

  it('handles full-width parentheses', () => {
    expect(extractStockNameFromReport('# 贵州茅台（600519）速览')).toBe('贵州茅台')
  })

  it('finds the heading even after leading blank lines', () => {
    expect(extractStockNameFromReport('\n\n# 平安银行 (000001) 速览')).toBe('平安银行')
  })

  it('returns null when no code-bearing heading exists', () => {
    expect(extractStockNameFromReport('随便一段文本，没有标题')).toBeNull()
    expect(extractStockNameFromReport('# 没有代码的标题')).toBeNull()
  })
})

describe('summarizeReport', () => {
  it('collapses whitespace and newlines', () => {
    expect(summarizeReport('# 标题\n\n正文  多空格\t制表')).toBe('# 标题 正文 多空格 制表')
  })

  it('truncates at maxLen', () => {
    expect(summarizeReport('x'.repeat(500))).toHaveLength(280)
    expect(summarizeReport('x'.repeat(500), 10)).toHaveLength(10)
  })

  it('leaves short text untouched', () => {
    expect(summarizeReport('短文本')).toBe('短文本')
  })
})
