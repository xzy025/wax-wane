import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCrossMarketResearchSnapshot,
  resetCrossMarketInFlight,
  resolveCrossMarketSnapshot,
} from './crossMarketRuntime'
import { emFetch } from '../lib/emFetch'
import { fetchTradingDates } from './moneyflow'
import { fetchUSStockQuotes } from './us'

vi.mock('../lib/emFetch', () => ({
  emFetch: vi.fn().mockRejectedValue(new Error('network-down-for-test')),
}))

vi.mock('./moneyflow', () => ({
  fetchTradingDates: vi.fn().mockResolvedValue([]),
}))

vi.mock('./us', () => ({
  fetchUSStockQuotes: vi.fn().mockResolvedValue([]),
}))

vi.mock('./crossMarketData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./crossMarketData')>()
  return {
    ...actual,
    fetchEastmoneyUsAdjustedDailyBars: vi.fn().mockResolvedValue([]),
    fetchStockanalysisAdjustedDailyBars: vi.fn().mockResolvedValue([]),
    fetchStooqDailyBars: vi.fn().mockResolvedValue([]),
    fetchYahooAdjustedDailyBars: vi.fn().mockResolvedValue([]),
  }
})

vi.mock('./limitLadder', () => ({
  fetchLimitLadderAnalysis: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./ladderMarketGate', () => ({
  fetchDomesticMarketSnapshot: vi.fn().mockResolvedValue(undefined),
}))

const withTempArchive = async (fn: (root: string) => Promise<void> | void): Promise<void> => {
  const previousRoot = process.env.CROSS_MARKET_ARCHIVE_ROOT
  const root = mkdtempSync(join(tmpdir(), 'cross-market-runtime-'))
  process.env.CROSS_MARKET_ARCHIVE_ROOT = root
  try {
    await fn(root)
  } finally {
    if (previousRoot == null) delete process.env.CROSS_MARKET_ARCHIVE_ROOT
    else process.env.CROSS_MARKET_ARCHIVE_ROOT = previousRoot
    rmSync(root, { recursive: true, force: true })
  }
}

const archiveFiles = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(join(root, entry.name)).map((file) =>
        join(entry.name, file).replace(/\\/g, '/'),
      ),
    )
    .sort()

const AUCTION_WINDOW = Date.parse('2026-08-21T09:25:30+08:00')

describe('cross-market snapshot time-bounded capture', () => {
  beforeEach(() => {
    resetCrossMarketInFlight()
    vi.mocked(emFetch).mockClear()
    vi.mocked(fetchUSStockQuotes).mockClear()
    vi.mocked(fetchTradingDates).mockClear()
  })

  it('persists exactly one on-time auction snapshot for concurrent in-window builds', async () => {
    await withTempArchive(async (root) => {
      const [first, second] = await Promise.all([
        buildCrossMarketResearchSnapshot({
          tradeDate: '2026-08-21',
          phase: 'auction',
          nowMs: AUCTION_WINDOW,
        }),
        buildCrossMarketResearchSnapshot({
          tradeDate: '2026-08-21',
          phase: 'auction',
          nowMs: AUCTION_WINDOW,
        }),
      ])

      expect(first).toBe(second)
      expect(first.captureStatus).toBe('on-time')
      expect(first.scheduledCutoffAt).toBe('2026-08-21T09:25:00.000+08:00')
      expect(archiveFiles(root)).toEqual(['2026-08-21/auction.json'])
    })
  })

  it('marks an out-of-window build late-live and never writes an archive', async () => {
    await withTempArchive(async (root) => {
      const snap = await buildCrossMarketResearchSnapshot({
        tradeDate: '2026-08-21',
        phase: 'auction',
        nowMs: Date.parse('2026-08-21T14:00:00+08:00'),
      })
      expect(snap.captureStatus).toBe('late-live')
      expect(snap.warnings.join(' ')).toContain('晚于规定截点')
      expect(archiveFiles(root)).toEqual([])
    })
  })

  it('returns unavailable for a missing phase without rebuilding or writing files', async () => {
    await withTempArchive(async (root) => {
      const snap = await resolveCrossMarketSnapshot('2026-08-21', 'auction')
      expect(snap.captureStatus).toBe('unavailable')
      expect(snap.probabilityStatus).toBe('unavailable')
      expect(archiveFiles(root)).toEqual([])
      expect(vi.mocked(emFetch)).not.toHaveBeenCalled()
      expect(vi.mocked(fetchUSStockQuotes)).not.toHaveBeenCalled()
    })
  })

  it('keeps archived reads available and non-archived historical dates untouched', async () => {
    await withTempArchive(async (root) => {
      await buildCrossMarketResearchSnapshot({
        tradeDate: '2026-08-21',
        phase: 'auction',
        nowMs: AUCTION_WINDOW,
      })
      const archived = await resolveCrossMarketSnapshot('2026-08-21', 'auction')
      expect(archived.captureStatus).toBe('on-time')
      expect(archiveFiles(root)).toEqual(['2026-08-21/auction.json'])
    })
  })
})