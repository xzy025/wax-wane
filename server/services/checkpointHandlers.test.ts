import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { auctionSnapshotFromQuote, resolveAuctionUniverse } from './checkpointHandlers'
import type { ScreenerLiveQuote } from './screenerScan'
import { persistScreenerUniverse } from './screenerUniverseStore'

const row = (code: string) => ({ f12: code, f2: 10, f14: `股票${code}` })

const withStore = async (fn: (path: string) => Promise<void> | void): Promise<void> => {
  const previous = process.env.SCREENER_UNIVERSE_STORE
  const root = mkdtempSync(join(tmpdir(), 'auction-universe-'))
  const path = join(root, 'universe.json')
  process.env.SCREENER_UNIVERSE_STORE = path
  try {
    await fn(path)
  } finally {
    if (previous == null) delete process.env.SCREENER_UNIVERSE_STORE
    else process.env.SCREENER_UNIVERSE_STORE = previous
    rmSync(root, { recursive: true, force: true })
  }
}

describe('auction snapshot recording', () => {
  it('passes bid2/ask2 depth through to the L1 decoder', () => {
    const quote: ScreenerLiveQuote = {
      code: '600000',
      name: '浦发银行',
      tradeDate: '2026-08-21',
      quoteTime: '09:21:00',
      capturedAt: '2026-08-21T01:21:00.000Z',
      source: 'sina',
      price: 11,
      changePct: 10,
      open: 11,
      high: 11,
      low: 11,
      prevClose: 10,
      volume: 1000,
      amount: 1_100_000,
      bid1Price: 11,
      bid1Volume: 300_000,
      bid2Volume: 80_000,
      ask1Price: 11,
      ask1Volume: 300_000,
      ask2Volume: null,
      marketPhase: 'auction-locked',
      sourceTier: 'shadow',
    }
    const snapshot = auctionSnapshotFromQuote(
      '2026-08-21',
      quote,
      'auction-lock',
      '2026-08-21T01:21:01.000Z',
    )
    expect(snapshot.virtualUnmatchedSide).toBe('buy')
    expect(snapshot.virtualUnmatchedQty).toBe(80_000)
  })
})
describe('auction candidate universe', () => {
  it('keeps an explicitly injected candidate pool for replay and tests', () => {
    expect(resolveAuctionUniverse({ codes: ['000001'], source: 'test' })).toEqual({
      codes: ['000001'],
      source: 'test',
    })
  })

  it('uses only a validated full-market last-good pool by default', async () => {
    await withStore(async () => {
      persistScreenerUniverse({
        rows: [row('000001'), row('600000')],
        tradeDate: '2026-08-21',
        expectedTotal: 2,
        sources: ['test'],
      })
      expect(resolveAuctionUniverse()).toEqual({
        codes: ['000001', '600000'],
        source: 'screener-last-good:2026-08-21',
      })
    })
  })

  it('keeps an absent, legacy, or under-covered pool unavailable', async () => {
    await withStore(async (path) => {
      expect(resolveAuctionUniverse()).toEqual({
        codes: [],
        source: 'last-good-missing',
      })

      persistScreenerUniverse({
        rows: [row('000001')],
        tradeDate: '2026-08-21',
        expectedTotal: 2,
        sources: ['test'],
      })
      expect(resolveAuctionUniverse().codes).toEqual([])
      expect(resolveAuctionUniverse().source).toBe('last-good-coverage-insufficient')

      writeFileSync(path, JSON.stringify({
        savedAt: '2026-08-21T00:00:00.000Z',
        rows: [row('000001')],
      }))
      expect(resolveAuctionUniverse()).toEqual({
        codes: [],
        source: 'last-good-legacy',
      })
    })
  })
})
