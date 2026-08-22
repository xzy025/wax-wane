import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { appendAuctionReplayEvents } from './auctionL1Replay'
import { buildAuctionBehaviorResearch } from './auctionBehaviorResearch'
import type { AuctionL1Snapshot } from './auctionL1'

function l1(
  symbol: string,
  providerTimestamp: string,
  over: Partial<AuctionL1Snapshot> = {},
): AuctionL1Snapshot {
  return {
    tradeDate: '2026-08-21',
    symbol,
    exchange: 'SSE',
    provider: 'shadow-public',
    providerTimestamp,
    receivedAt: '2026-08-21T01:25:05.000Z',
    previousClose: 10,
    limitUpPrice: 11,
    limitDownPrice: 9,
    virtualPrice: 11,
    virtualMatchedQty: 100_000,
    virtualUnmatchedQty: 0,
    virtualUnmatchedSide: 'balanced',
    rawBidPrices: [11],
    rawBidQty: [100_000],
    rawAskPrices: [11],
    rawAskQty: [100_000],
    marketPhase: 'auction-locked',
    quality: 'full',
    warnings: [],
    sourceTier: 'shadow',
    ...over,
  }
}

const withTempReplay = async (fn: () => Promise<void>): Promise<void> => {
  const prev = process.env.AUCTION_L1_REPLAY_ROOT
  const root = mkdtempSync(join(tmpdir(), 'auction-behavior-research-'))
  process.env.AUCTION_L1_REPLAY_ROOT = root
  try {
    await fn()
  } finally {
    if (prev == null) delete process.env.AUCTION_L1_REPLAY_ROOT
    else process.env.AUCTION_L1_REPLAY_ROOT = prev
    rmSync(root, { recursive: true, force: true })
  }
}

describe('auction behavior research aggregation', () => {
  it('builds research from an incomplete L1 recording with insufficient-data label', async () => {
    await withTempReplay(async () => {
      await appendAuctionReplayEvents('2026-08-21', [
        l1('600000', '09:15:00'),
        l1('600000', '09:25:00'),
      ])
      const result = buildAuctionBehaviorResearch({ tradeDate: '2026-08-21', phase: 'auction' })
      expect(result.tradeDate).toBe('2026-08-21')
      expect(result.behaviors).toHaveLength(1)
      expect(result.behaviors[0].labels.some((row) => row.label === 'insufficient-data')).toBe(true)
      expect(result.warnings.some((warning) => warning.includes('shadow'))).toBe(true)
    })
  })

  it('returns empty when the trade date has no recording', async () => {
    await withTempReplay(async () => {
      const result = buildAuctionBehaviorResearch({ tradeDate: '2026-08-19', phase: 'auction' })
      expect(result.behaviors).toHaveLength(0)
      expect(result.warnings.join(' ')).toContain('无 L1 竞价录制事件')
    })
  })

  it('counts labels across symbols', async () => {
    await withTempReplay(async () => {
      await appendAuctionReplayEvents('2026-08-21', [
        l1('600000', '09:25:00', { virtualPrice: 11, virtualMatchedQty: 300_000 }),
        l1('399001', '09:25:00', { exchange: 'SZSE', virtualPrice: 9, virtualMatchedQty: 1_000 }),
      ])
      const result = buildAuctionBehaviorResearch({ tradeDate: '2026-08-21', phase: 'auction' })
      expect(result.snapshotCount).toBe(2)
      expect(Object.values(result.labels).reduce((sum, n) => sum + n, 0)).toBe(2)
    })
  })
})