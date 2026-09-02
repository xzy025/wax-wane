import { describe, expect, it } from 'vitest'
import {
  auditDailyBars,
  computeSourceShock,
  parseEastmoneyAdjustedDailyKlines,
  parseStooqDailyCsv,
  parseStockanalysisDailyHistory,
  parseYahooAdjustedDailyChart,
  robustZ,
} from './crossMarketData'

describe('cross-market public data adapters', () => {
  it('parses and sorts the free EOD CSV shape without silently filling rows', () => {
    const bars = parseStooqDailyCsv('Date,Open,High,Low,Close,Volume\n2026-01-02,2,3,1,2.5,100\n2026-01-01,1,2,0.5,1.5,200')
    expect(bars.map((bar) => bar.date)).toEqual(['2026-01-01', '2026-01-02'])
    expect(bars[0].dollarVolume).toBe(300)
    expect(parseStooqDailyCsv('Date,Open,High,Low,Close,Volume\n2026-01-01,NA,2,1,1.5,100')).toEqual([])
  })

  it('marks raw free EOD data degraded until adjustment is solved', () => {
    const audit = auditDailyBars({ source: 'stooq', requestedBars: 3, bars: [{ date: '2026-01-01', open: 1, high: 1, low: 1, close: 1, volume: 1, dollarVolume: 1 }], adjustment: 'raw' })
    expect(audit.status).toBe('degraded')
    expect(audit.warnings[0]).toContain('未复权')
  })

  it('parses Eastmoney front-adjusted US daily bars and preserves reported amount', () => {
    expect(
      parseEastmoneyAdjustedDailyKlines([
        '2026-08-20,10,11,12,9,1000,10800',
        'invalid',
      ]),
    ).toEqual([
      {
        date: '2026-08-20',
        open: 10,
        close: 11,
        high: 12,
        low: 9,
        volume: 1000,
        dollarVolume: 10800,
      },
    ])
  })

  it('normalizes Yahoo adjusted close into one consistent adjusted OHLC series', () => {
    const bars = parseYahooAdjustedDailyChart({
      chart: {
        result: [{
          timestamp: [1_767_312_000],
          indicators: {
            quote: [{ open: [100], high: [110], low: [90], close: [100], volume: [200] }],
            adjclose: [{ adjclose: [50] }],
          },
        }],
      },
    })
    expect(bars).toHaveLength(1)
    expect(bars[0]).toMatchObject({ open: 50, high: 55, low: 45, close: 50, volume: 200 })
    expect(bars[0].dollarVolume).toBe(10_000)
  })

  it('normalizes stockanalysis.com adjusted close and sorts by date', () => {
    const bars = parseStockanalysisDailyHistory({
      data: [
        { t: '2026-08-20', o: 10, h: 11, l: 9, c: 10, v: 100, a: 5 },
        { t: '2026-08-19', o: 12, h: 13, l: 11, c: 12, v: 200, a: 6 },
        { t: 'bad', o: 1, h: 1, l: 1, c: 1, v: 1, a: 1 },
      ],
    })
    expect(bars.map((bar) => bar.date)).toEqual(['2026-08-19', '2026-08-20'])
    expect(bars[0]).toMatchObject({ open: 6, high: 6.5, low: 5.5, close: 6, volume: 200 })
    expect(bars[0].dollarVolume).toBe(6 * 200)
    expect(parseStockanalysisDailyHistory(null)).toEqual([])
    expect(parseStockanalysisDailyHistory({ data: 'not-array' })).toEqual([])
  })

  it('uses robust median/MAD and rejects short histories', () => {
    expect(robustZ(3, Array.from({ length: 20 }, () => 1))).toBe(20000)
    expect(robustZ(3, [1, 2])).toBeNull()
  })

  it('computes an abnormal-return research feature only with enough aligned controls', () => {
    const bars = Array.from({ length: 65 }, (_, index) => ({
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100 + index,
      volume: 1000 + index,
      dollarVolume: (1000 + index) * (100 + index),
    }))
    const controls = bars.slice(1).map((bar) => ({ date: bar.date, returnPct: 0 }))
    const latest = bars.at(-1)
    expect(latest).toBeDefined()
    const shock = computeSourceShock({ ticker: 'AXTI', sessionDate: latest?.date ?? '', bars, marketReturns: controls, sectorReturns: controls, eventFlag: true })
    expect(shock.sourceAvailable).toBe(true)
    expect(shock.returnPct).toBeGreaterThan(0)
    expect(shock.eventFlag).toBe(true)
  })
})
