import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  computeReportAge,
  getFundamentalReport,
  REPORT_STALE_DAYS,
} from './getFundamentalReport'
import type { AppState } from '../../store'

const NOW = new Date('2026-06-10T12:00:00Z')
const state = {} as AppState

describe('computeReportAge', () => {
  it('parses date-only createdAt (file archive format)', () => {
    expect(computeReportAge('2026-06-01', NOW)).toEqual({ ageDays: 9, stale: false })
  })

  it('parses full ISO datetime (DB row format)', () => {
    expect(computeReportAge('2026-05-30T08:30:00.000Z', NOW)).toEqual({
      ageDays: 11,
      stale: false,
    })
  })

  it('is not stale at exactly the threshold, stale one day past it', () => {
    const atThreshold = new Date(NOW.getTime() - REPORT_STALE_DAYS * 86_400_000)
    expect(computeReportAge(atThreshold.toISOString(), NOW)?.stale).toBe(false)
    const pastThreshold = new Date(NOW.getTime() - (REPORT_STALE_DAYS + 1) * 86_400_000)
    expect(computeReportAge(pastThreshold.toISOString(), NOW)?.stale).toBe(true)
  })

  it('clamps future dates to age 0', () => {
    expect(computeReportAge('2026-07-01', NOW)).toEqual({ ageDays: 0, stale: false })
  })

  it('returns null for garbage input', () => {
    expect(computeReportAge('不是日期', NOW)).toBeNull()
    expect(computeReportAge('', NOW)).toBeNull()
  })
})

describe('getFundamentalReport.execute', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch(response: { ok: boolean; json?: unknown; text?: string }) {
    const mock = vi.fn().mockResolvedValue({
      ok: response.ok,
      json: () => Promise.resolve(response.json),
      text: () => Promise.resolve(response.text ?? ''),
    })
    vi.stubGlobal('fetch', mock)
    return mock
  }

  it('enriches a found report with ageDays/stale', async () => {
    stubFetch({
      ok: true,
      json: {
        found: true,
        stockCode: '300750',
        stockName: '宁德时代',
        reportMd: '# 宁德时代 (300750)',
        summary: '摘要',
        createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        source: 'file',
      },
    })
    const result = (await getFundamentalReport.execute({ stockCode: '300750' }, state)) as Record<
      string,
      unknown
    >
    expect(result.found).toBe(true)
    expect(result.reportMd).toContain('宁德时代')
    expect(typeof result.ageDays).toBe('number')
    expect(result.stale).toBe(false)
  })

  it('adds a generation hint when no report is archived', async () => {
    stubFetch({ ok: true, json: { found: false, stockCode: '600519' } })
    const result = (await getFundamentalReport.execute({ query: '600519' }, state)) as Record<
      string,
      unknown
    >
    expect(result.found).toBe(false)
    expect(result.hint).toContain('基本面分析')
  })

  it('passes the query through URL-encoded', async () => {
    const mock = stubFetch({ ok: true, json: { found: false } })
    await getFundamentalReport.execute({ query: '宁德时代' }, state)
    expect(mock).toHaveBeenCalledWith(
      `/api/analysis/fundamental/latest?query=${encodeURIComponent('宁德时代')}`,
    )
  })

  it('returns an error object on HTTP failure', async () => {
    stubFetch({ ok: false, text: 'boom' })
    const result = (await getFundamentalReport.execute({ stockCode: '300750' }, state)) as Record<
      string,
      unknown
    >
    expect(result.error).toContain('boom')
  })

  it('rejects calls without stockCode or query', async () => {
    const result = (await getFundamentalReport.execute({}, state)) as Record<string, unknown>
    expect(result.error).toBeTruthy()
  })
})
