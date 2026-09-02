import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  assessBackfillCoverage,
  dailyLogReturns,
  detectSplitAnomalies,
  readUsDailyArchiveFile,
  runUsDailyBackfill,
  writeUsDailyBackfillReport,
  type UsDailyBackfillReport,
  type UsDailyBar,
} from './crossMarketBackfill'

describe('cross-market US daily backfill', () => {
  const roots: string[] = []
  const tempRoot = () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-backfill-'))
    roots.push(dir)
    return dir
  }
  afterAll(() => {
    for (const dir of roots) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Windows holds open file handles transiently; treat as best-effort.
      }
    }
  })

  function bars(count: number, startOffsetDays: number): UsDailyBar[] {
    const out: UsDailyBar[] = []
    const anchor = Date.UTC(2026, 7, 1) + startOffsetDays * 86_400_000
    for (let index = 0; index < count; index++) {
      const date = new Date(anchor + index * 86_400_000).toISOString().slice(0, 10)
      out.push({ date, open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, volume: 1000 + index, dollarVolume: (1000 + index) * (100 + index) })
    }
    return out
  }

  it('computes daily log returns and skips invalid prior closes', () => {
    const rows = dailyLogReturns([
      { date: '2026-08-01', open: 1, high: 1, low: 1, close: 0, volume: 1, dollarVolume: 0 },
      { date: '2026-08-02', open: 1, high: 1, low: 1, close: 10, volume: 1, dollarVolume: 10 },
    ])
    expect(rows).toHaveLength(0)
    expect(dailyLogReturns(bars(3, 0))[0].value).toBeGreaterThan(0)
  })

  it('marks a split-style jump but keeps a normal series clean', () => {
    const series = bars(12, 0)
    const jump = [...series]
    jump[6] = { ...jump[6], close: jump[5].close * 2 }
    jump[6].high = jump[6].close + 1
    jump[6].low = jump[6].close - 1
    jump[6].dollarVolume = jump[6].close * jump[6].volume
    const anomalies = detectSplitAnomalies(jump)
    expect(anomalies.length).toBeGreaterThan(0)
    expect(anomalies[0]).toContain('疑似拆分')
    expect(detectSplitAnomalies(series)).toEqual([])
  })

  it('scores coverage against the reference calendar in the window', () => {
    const reference = bars(60, 0)
    expect(assessBackfillCoverage({ tickerBars: reference, referenceBars: reference, startDate: reference[5].date }).status).toBe('full')
    const short = bars(30, 0)
    const audit = assessBackfillCoverage({ tickerBars: short, referenceBars: reference, startDate: reference[5].date })
    expect(audit.status).toBe('degraded')
    expect(audit.coveragePct).toBeLessThan(60)
    expect(assessBackfillCoverage({ tickerBars: [], referenceBars: reference, startDate: '2026-01-01' }).status).toBe('unavailable')
    expect(assessBackfillCoverage({ tickerBars: bars(5, 0), referenceBars: [], startDate: '2026-01-01' }).status).toBe('degraded')
  })

  it('backfills via the degrade chain, archives raw bars, and reuses them', async () => {
    const root = tempRoot()
    const reportRoot = join(root, 'reports')
    const archiveRoot = join(root, 'raw')
    const source = bars(80, 0)
    const deps = {
      fetchEastmoney: async () => [] as UsDailyBar[],
      fetchStockanalysis: async () => source,
      fetchYahoo: async () => [] as UsDailyBar[],
      fetchStooq: async () => [] as UsDailyBar[],
    }
    const report = await runUsDailyBackfill({ tickers: ['AXTI'], archiveRoot, reportRoot, now: Date.UTC(2026, 7, 1) }, deps)
    expect(report.rows[0].source).toBe('stockanalysis')
    expect(report.rows[0].status).toBe('full')
    expect(report.rows[0]?.ticker).toBe('SPY')
    const archived = readUsDailyArchiveFile(archiveRoot, 'stockanalysis', report.runDate, 'AXTI')
    expect(archived?.bars).toHaveLength(80)
    expect(report.rows.some((row) => row.ticker === 'AXTI')).toBe(true)

    const second = await runUsDailyBackfill({ tickers: ['AXTI'], archiveRoot, reportRoot, now: Date.UTC(2026, 7, 1) }, deps)
    expect(second.summary.reused).toBeGreaterThanOrEqual(1)
    expect(second.rows.find((row) => row.ticker === 'AXTI')?.warnings.some((warning) => warning.includes('复用'))).toBe(true)
  })

  it('uses eastmoney first when it has enough bars', async () => {
    const root = tempRoot()
    const reportRoot = join(root, 'reports')
    const archiveRoot = join(root, 'raw')
    const emBars = bars(90, 0)
    const report = await runUsDailyBackfill({ tickers: ['LITE'], archiveRoot, reportRoot, now: Date.UTC(2026, 7, 1) }, {
      fetchEastmoney: async () => emBars,
      fetchStockanalysis: async () => bars(100, -10),
      fetchStooq: async () => bars(100, -10),
      fetchYahoo: async () => [] as UsDailyBar[],
    })
    const row = report.rows.find((item) => item.ticker === 'LITE')
    expect(row?.source).toBe('eastmoney')
    expect(row?.adjustment).toBe('adjusted')
  })

  it('falls to stockanalysis when eastmoney has too few bars', async () => {
    const root = tempRoot()
    const reportRoot = join(root, 'reports')
    const archiveRoot = join(root, 'raw')
    const report = await runUsDailyBackfill({ tickers: ['LITE'], archiveRoot, reportRoot, now: Date.UTC(2026, 7, 1) }, {
      fetchEastmoney: async () => [] as UsDailyBar[],
      fetchStockanalysis: async () => bars(80, 0),
      fetchStooq: async () => [] as UsDailyBar[],
      fetchYahoo: async () => [] as UsDailyBar[],
    })
    const row = report.rows.find((item) => item.ticker === 'LITE')
    expect(row?.source).toBe('stockanalysis')
    expect(row?.adjustment).toBe('adjusted')
  })

  it('marks stooq raw data degraded and refuses null sources with unavailable', async () => {
    const root = tempRoot()
    const reportRoot = join(root, 'reports')
    const archiveRoot = join(root, 'raw')
    const report = await runUsDailyBackfill({ tickers: ['MRNA', 'SPY'], archiveRoot, reportRoot, now: Date.UTC(2026, 7, 1) }, {
      fetchEastmoney: async () => [] as UsDailyBar[],
      fetchStockanalysis: () => Promise.reject(new Error('stockanalysis down')),
      fetchStooq: async (ticker: string) => (ticker === 'MRNA' ? bars(70, 0) : []),
      fetchYahoo: () => Promise.reject(new Error('yahoo down')),
    })
    const mrna = report.rows.find((row) => row.ticker === 'MRNA')
    expect(mrna?.source).toBe('stooq')
    expect(mrna?.adjustment).toBe('raw')
    expect(mrna?.status).toBe('degraded')
    const spy = report.rows.find((row) => row.ticker === 'SPY')
    expect(spy?.source).toBeNull()
    expect(spy?.status).toBe('unavailable')
    expect(report.rows.length).toBe(2)
  })

  it('writes a report file with summary counts', async () => {
    const root = tempRoot()
    const reportRoot = join(root, 'reports')
    const archiveRoot = join(root, 'raw')
    const deps = { fetchEastmoney: async () => [] as UsDailyBar[], fetchStockanalysis: async () => bars(80, 0), fetchYahoo: async () => [] as UsDailyBar[], fetchStooq: async () => [] as UsDailyBar[] }
    const report = await runUsDailyBackfill({ tickers: ['AXTI', 'LITE'], archiveRoot, reportRoot, now: Date.UTC(2026, 7, 1) }, deps)
    const files = readdirSync(reportRoot)
    expect(files.some((file) => file.includes(`us-daily-backfill-${report.runDate}`))).toBe(true)
    expect(report.summary.fullCount + report.summary.degradedCount + report.summary.unavailableCount).toBe(report.rows.length)
    const serialized = readFileSync(join(reportRoot, `us-daily-backfill-${report.runDate}.json`), 'utf8')
    const parsed = JSON.parse(serialized) as UsDailyBackfillReport
    expect(parsed.summary.archived).toBe(report.summary.archived)
  })

  it('writes a report through the direct writer helper', async () => {
    const root = tempRoot()
    const reportRoot = join(root, 'reports')
    const now = Date.UTC(2026, 7, 1)
    const runDate = new Date(now + 8 * 3_600_000).toISOString().slice(0, 10)
    const report = writeUsDailyBackfillReport({
      runDate,
      generatedAt: new Date().toISOString(),
      modelVersion: 'v',
      referenceTicker: 'SPY',
      startDate: '2023-08-01',
      targetYears: 3,
      requestedTickers: 1,
      rows: [],
      summary: { archived: 0, reused: 0, fullCount: 0, degradedCount: 0, unavailableCount: 0, adjustedOnlyCount: 0, rawOnlyCount: 0, sources: {}, warnings: [] },
    }, reportRoot)
    expect(readFileSync(report, 'utf8').length).toBeGreaterThan(10)
  })
})