import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CORE_US_ASSET_UNIVERSE,
  SEED_EVIDENCE_EDGES,
  assessCrossMarketDataQuality,
  buildThemeLabels,
  createUnavailableSnapshot,
  listCrossMarketSnapshots,
  readCrossMarketSnapshot,
  readCrossMarketSettlement,
  resolveAshareTradeDateForUsSession,
  writeCrossMarketSettlement,
  writeCrossMarketSnapshot,
  type CrossMarketPhase,
  type CrossMarketSnapshot,
} from './crossMarketMapping'

const onTimeSnapshot = (over: Partial<CrossMarketSnapshot> = {}): CrossMarketSnapshot => {
  const tradeDate = over.tradeDate ?? '2026-08-21'
  const phase: CrossMarketPhase = over.phase ?? 'auction'
  return {
    ...createUnavailableSnapshot({ tradeDate, phase }),
    ...over,
    captureStatus: 'on-time',
  }
}

const withTempArchive = async (fn: (root: string) => Promise<void> | void): Promise<void> => {
  const previousRoot = process.env.CROSS_MARKET_ARCHIVE_ROOT
  const root = mkdtempSync(join(tmpdir(), 'cross-market-archive-'))
  process.env.CROSS_MARKET_ARCHIVE_ROOT = root
  try {
    await fn(root)
  } finally {
    if (previousRoot == null) delete process.env.CROSS_MARKET_ARCHIVE_ROOT
    else process.env.CROSS_MARKET_ARCHIVE_ROOT = previousRoot
    rmSync(root, { recursive: true, force: true })
  }
}

describe('cross-market mapping research contract', () => {
  it('keeps a 300-name source registry and three seed edges in research', () => {
    expect(CORE_US_ASSET_UNIVERSE).toHaveLength(300)
    expect(new Set(CORE_US_ASSET_UNIVERSE.map((asset) => asset.ticker)).size).toBe(300)
    expect(SEED_EVIDENCE_EDGES.map((edge) => edge.fromTicker)).toEqual(['AXTI', 'LITE', 'MRNA'])
    expect(SEED_EVIDENCE_EDGES.every((edge) => edge.status === 'research' && !edge.modelEligible)).toBe(true)
  })

  it('maps a US session to the next A-share trading date, including weekends', () => {
    expect(resolveAshareTradeDateForUsSession('2026-08-20', ['2026-08-20', '2026-08-21', '2026-08-24'])).toBe('2026-08-21')
    expect(resolveAshareTradeDateForUsSession('2026-08-21', ['2026-08-21', '2026-08-24', '2026-08-25'])).toBe('2026-08-24')
  })

  it('keeps burst and tradable labels separate', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      code: `${index}`,
      limitUp: index < 3,
      firstBoard: index < 2,
      onePriceLimitUp: index === 0,
      suspended: false,
      st: false,
      tradable: true,
      themeReturnPct: index === 0 ? 10 : index < 16 ? 2 : 0,
      benchmarkReturnPct: 0,
    }))
    const labels = buildThemeLabels(rows)
    expect(labels.burst).toBe(1)
    expect(labels.tradable).toBe(1)
    expect(labels.validTradableStockCount).toBe(19)
  })

  it('downgrades missing or stale sources and never turns them neutral', () => {
    expect(assessCrossMarketDataQuality({ sourceCoveragePct: 90, staleSources: ['AXTI'], warnings: ['stale'] }).status).toBe('degraded')
    expect(assessCrossMarketDataQuality({ sourceCoveragePct: 100, missingSources: ['critical:model'], criticalReady: false }).status).toBe('unavailable')
    expect(createUnavailableSnapshot({ tradeDate: '2026-08-21', phase: 'premarket' }).probabilityStatus).toBe('unavailable')
  })

  it('archives 09:25 and 09:35 as separate immutable phase files', async () => {
    await withTempArchive(async () => {
      const auction = onTimeSnapshot({
        phase: 'auction',
        scheduledCutoffAt: '2026-08-21T09:25:00.000+08:00',
        capturedAt: '2026-08-21T09:25:10.000+08:00',
      })
      const open = onTimeSnapshot({
        phase: 'open',
        scheduledCutoffAt: '2026-08-21T09:35:00.000+08:00',
        capturedAt: '2026-08-21T09:35:10.000+08:00',
      })
      writeCrossMarketSnapshot(auction)
      writeCrossMarketSnapshot(open)

      expect(readCrossMarketSnapshot('2026-08-21', 'auction')?.scheduledCutoffAt).toBe(
        '2026-08-21T09:25:00.000+08:00',
      )
      expect(readCrossMarketSnapshot('2026-08-21', 'open')?.scheduledCutoffAt).toBe(
        '2026-08-21T09:35:00.000+08:00',
      )
    })
  })

  it('archives a separate 15:10 settled-label layer without changing phase snapshots', async () => {
    await withTempArchive(async () => {
      const open = onTimeSnapshot({
        phase: 'open',
        scheduledCutoffAt: '2026-08-21T09:35:00.000+08:00',
      })
      writeCrossMarketSnapshot(open)
      writeCrossMarketSettlement({
        tradeDate: '2026-08-21',
        generatedAt: '2026-08-21T15:10:00+08:00',
        modelVersion: 'cross-market-v1-research',
        status: 'degraded',
        themes: [],
        warnings: ['历史基线不足'],
      })

      expect(readCrossMarketSettlement('2026-08-21')?.status).toBe('degraded')
      expect(readCrossMarketSnapshot('2026-08-21', 'open')?.scheduledCutoffAt).toBe(
        '2026-08-21T09:35:00.000+08:00',
      )
    })
  })

  it('refuses to persist any non on-time snapshot, so late data can never rewrite history', async () => {
    await withTempArchive(async () => {
      expect(() =>
        writeCrossMarketSnapshot(
          createUnavailableSnapshot({ tradeDate: '2026-08-21', phase: 'auction' }),
        ),
      ).toThrow(/非 on-time/)
      expect(() =>
        writeCrossMarketSnapshot({
          ...onTimeSnapshot({ phase: 'auction' }),
          captureStatus: 'late-live',
        }),
      ).toThrow(/非 on-time/)
    })
  })

  it('only feeds verified on-time snapshots into the same-time baseline list', async () => {
    await withTempArchive(async (root) => {
      writeCrossMarketSnapshot(onTimeSnapshot({ tradeDate: '2026-08-19', phase: 'auction' }))
      writeCrossMarketSnapshot(onTimeSnapshot({ tradeDate: '2026-08-20', phase: 'auction' }))
      // Simulate a stray on-disk archive written by an older process without
      // capture status; it must be readable but excluded from the baseline.
      const { mkdirSync, writeFileSync } = await import('node:fs')
      const { join: pathJoin } = await import('node:path')
      const strayDir = pathJoin(root, '2026-08-21')
      mkdirSync(strayDir, { recursive: true })
      writeFileSync(
        pathJoin(strayDir, 'auction.json'),
        JSON.stringify({
          tradeDate: '2026-08-21',
          phase: 'auction',
          cutoffAt: '2026-08-21T09:25:10+08:00',
          generatedAt: '2026-08-21T09:25:10Z',
          modelVersion: 'cross-market-v1-research',
          graphVersion: 'evidence-graph-v1',
          probabilityStatus: 'research-score',
          researchStatus: 'research',
          dataQuality: { status: 'degraded' },
          sourceShocks: [],
          themePredictions: [],
          stockPredictions: [],
          rejectedMappings: [],
          warnings: [],
        }),
      )

      const dates = listCrossMarketSnapshots('auction', '9999-12-31', 20).map((s) => s.tradeDate)
      expect(dates).not.toContain('2026-08-21')
      expect(dates).toContain('2026-08-20')
      expect(dates).toContain('2026-08-19')
      // The stray legacy file stays readable, normalized to unavailable.
      const stray = readCrossMarketSnapshot('2026-08-21', 'auction')
      expect(stray?.captureStatus).toBe('unavailable')
      expect(stray?.scheduledCutoffAt).toBe('2026-08-21T09:25:00.000+08:00')
    })
  })
})
