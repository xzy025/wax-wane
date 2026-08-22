import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  decodeAuctionLevel1,
  markLegacyUnverified,
  marketPhaseForClockTime,
  marketPhaseForShanghaiClock,
  AUCTION_LEGACY_UNVERIFIED,
  type AuctionL1Snapshot,
} from './auctionL1'
import {
  appendAuctionReplayEvents,
  readAuctionReplayDay,
  ReplayAuctionProvider,
  auctionL1ReplayRoot,
} from './auctionL1Replay'

function snapshotOverrides(partial: Partial<AuctionL1Snapshot>): AuctionL1Snapshot {
  return {
    tradeDate: '2026-08-22',
    symbol: '600000',
    exchange: 'SSE',
    provider: 'authorized-test',
    providerTimestamp: '09:20:05',
    receivedAt: '2026-08-22T01:20:05.000Z',
    previousClose: 10,
    limitUpPrice: 11,
    limitDownPrice: 9,
    virtualPrice: 10.5,
    virtualMatchedQty: 100_000,
    virtualUnmatchedQty: 0,
    virtualUnmatchedSide: 'balanced',
    rawBidPrices: [10.5],
    rawBidQty: [100_000],
    rawAskPrices: [10.5],
    rawAskQty: [100_000],
    marketPhase: 'auction-locked',
    quality: 'full',
    warnings: [],
    sourceTier: 'authorized',
    ...partial,
  }
}

describe('auction Level-1 market phase', () => {
  it('classifies 09:15–09:20 as cancellable and 09:20–09:25 as locked', () => {
    expect(marketPhaseForClockTime('09:15:00')).toBe('auction-cancellable')
    expect(marketPhaseForClockTime('09:19:59')).toBe('auction-cancellable')
    expect(marketPhaseForClockTime('09:20:00')).toBe('auction-locked')
    expect(marketPhaseForClockTime('09:24:59')).toBe('auction-locked')
    expect(marketPhaseForClockTime('09:30:00')).toBe('continuous')
    expect(marketPhaseForClockTime('13:01:00')).toBe('continuous')
    expect(marketPhaseForClockTime('07:50:00')).toBeNull()
    expect(marketPhaseForClockTime('12:00:00')).toBeNull()
  })

  it('uses the provided minutes directly (testability)', () => {
    expect(marketPhaseForShanghaiClock(0, 9 * 60 + 15)).toBe('auction-cancellable')
    expect(marketPhaseForShanghaiClock(0, 9 * 60 + 20)).toBe('auction-locked')
    expect(marketPhaseForShanghaiClock(0, 9 * 60 + 35)).toBe('continuous')
  })
})

describe('auction Level-1 virtual field decoding', () => {
  it('decodes bid1/ask1 as virtual reference price and matched qty', () => {
    const snapshot = decodeAuctionLevel1({
      tradeDate: '2026-08-22',
      symbol: '600000',
      exchange: 'SSE',
      provider: 'authorized-test',
      providerTimestamp: '09:20:05',
      receivedAt: '2026-08-22T01:20:05.000Z',
      previousClose: 10,
      marketPhase: 'auction-locked',
      rawBidPrices: [11],
      rawBidQty: [300_000],
      rawAskPrices: [11],
      rawAskQty: [300_000],
    })
    expect(snapshot.virtualPrice).toBe(11)
    expect(snapshot.virtualMatchedQty).toBe(300_000)
    expect(snapshot.virtualUnmatchedSide).toBe('balanced')
    expect(snapshot.virtualUnmatchedQty).toBe(0)
    expect(snapshot.quality).toBe('full')
  })

  it('reads unmatched quantity and direction from bid2/ask2, not bid1-ask1 difference', () => {
    // 买盘未匹配:买一量=卖一量(匹配量),买二量非空、卖二量空。
    const buyUnmatched = decodeAuctionLevel1({
      tradeDate: '2026-08-22',
      symbol: '300001',
      exchange: 'SZSE',
      provider: 'authorized-test',
      providerTimestamp: '09:15:05',
      receivedAt: '2026-08-22T01:15:05.000Z',
      previousClose: 20,
      marketPhase: 'auction-cancellable',
      rawBidPrices: [22, 21],
      rawBidQty: [100_000, 50_000],
      rawAskPrices: [22],
      rawAskQty: [100_000],
    })
    expect(buyUnmatched.virtualUnmatchedSide).toBe('buy')
    expect(buyUnmatched.virtualUnmatchedQty).toBe(50_000)

    // 卖盘未匹配。
    const sellUnmatched = decodeAuctionLevel1({
      tradeDate: '2026-08-22',
      symbol: '300001',
      exchange: 'SZSE',
      provider: 'authorized-test',
      providerTimestamp: '09:17:30',
      receivedAt: '2026-08-22T01:17:30.000Z',
      previousClose: 20,
      marketPhase: 'auction-cancellable',
      rawBidPrices: [22],
      rawBidQty: [100_000],
      rawAskPrices: [22, 23],
      rawAskQty: [100_000, 60_000],
    })
    expect(sellUnmatched.virtualUnmatchedSide).toBe('sell')
    expect(sellUnmatched.virtualUnmatchedQty).toBe(60_000)
  })

  it('rejects bid2+ask2 both non-empty as unknown direction', () => {
    const snapshot = decodeAuctionLevel1({
      tradeDate: '2026-08-22',
      symbol: '600000',
      exchange: 'SSE',
      provider: 'authorized-test',
      providerTimestamp: '09:19:50',
      receivedAt: '2026-08-22T01:19:50.000Z',
      previousClose: 10,
      marketPhase: 'auction-cancellable',
      rawBidPrices: [11, 10.9],
      rawBidQty: [100_000, 40_000],
      rawAskPrices: [11, 11.1],
      rawAskQty: [100_000, 30_000],
    })
    expect(snapshot.virtualUnmatchedSide).toBe('unknown')
    expect(snapshot.virtualUnmatchedQty).toBeNull()
    expect(snapshot.warnings.join(' ')).toContain('未匹配方向无法确认')
  })

  it('returns degraded when the virtual reference price cannot be confirmed', () => {
    const snapshot = decodeAuctionLevel1({
      tradeDate: '2026-08-22',
      symbol: '600000',
      exchange: 'SSE',
      provider: 'authorized-test',
      providerTimestamp: '09:15:05',
      receivedAt: '2026-08-22T01:15:05.000Z',
      previousClose: 10,
      marketPhase: 'auction-cancellable',
      rawBidPrices: [11],
      rawBidQty: [100_000],
      rawAskPrices: [10.5],
      rawAskQty: [100_000],
    })
    expect(snapshot.virtualPrice).toBeNull()
    expect(snapshot.quality).toBe('degraded')
  })

  it('never merges continuous-auction order book fields after 09:25', () => {
    const snapshot = decodeAuctionLevel1({
      tradeDate: '2026-08-22',
      symbol: '600000',
      exchange: 'SSE',
      provider: 'authorized-test',
      providerTimestamp: '09:35:00',
      receivedAt: '2026-08-22T01:35:00.000Z',
      previousClose: 10,
      marketPhase: 'continuous',
      rawBidPrices: [10.8],
      rawBidQty: [100_000],
      rawAskPrices: [10.9],
      rawAskQty: [80_000],
    })
    expect(snapshot.virtualPrice).toBeNull()
    expect(snapshot.virtualMatchedQty).toBeNull()
    expect(snapshot.virtualUnmatchedQty).toBeNull()
    expect(snapshot.warnings.join(' ')).toContain('连续竞价阶段')
  })
})

describe('auction Level-1 legacy-unverified isolation', () => {
  it('marks legacy fields without deleting or reinterpreting them', () => {
    const snapshot = markLegacyUnverified(snapshotOverrides({}), [
      'unmatchedAmount',
      'unmatchedSide',
    ])
    expect(snapshot.legacyUnverified).toContain('unmatchedAmount')
    expect(snapshot.legacyUnverified).toContain('unmatchedSide')
    expect(snapshot.warnings.join(' ')).toContain(AUCTION_LEGACY_UNVERIFIED)
    expect(snapshot.quality).toBe('degraded')
    // 原始字段保持不变。
    expect(snapshot.virtualPrice).toBe(10.5)
  })
})

describe('auction replay player', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'auction-l1-replay-'))

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('records, reloads and replays the same normalized snapshots', async () => {
    const prevRoot = auctionL1ReplayRoot()
    try {
      process.env.AUCTION_L1_REPLAY_ROOT = join(tempRoot, 'raw')
      const snapshots = [
        snapshotOverrides({ symbol: '600000' }),
        snapshotOverrides({
          symbol: '300001',
          exchange: 'SZSE',
          providerTimestamp: '09:25:05',
          receivedAt: '2026-08-22T01:25:05.000Z',
        }),
      ]
      const added = await appendAuctionReplayEvents('2026-08-22', snapshots)
      expect(added).toBe(2)

      const day = readAuctionReplayDay('2026-08-22')
      expect(day).not.toBeNull()
      expect(day?.events).toHaveLength(2)
      expect(day?.warnings).toEqual([])
      expect(day?.events[0].snapshot).toMatchObject(snapshotOverrides({ symbol: '600000' }))

      const provider = new ReplayAuctionProvider()
      await provider.connect()
      const received: AuctionL1Snapshot[] = []
      provider.onSnapshot((snapshot) => received.push(snapshot))
      const count = await provider.replay('2026-08-22')
      expect(count).toBe(2)
      expect(received).toHaveLength(2)
      expect(provider.getHealth().quality).toBe('full')
      expect(provider.getHealth().providerTimestamp).toBe('09:25:05')
      await provider.disconnect()
    } finally {
      delete process.env.AUCTION_L1_REPLAY_ROOT
      void prevRoot
    }
  })

  it('is idempotent: duplicate events are not re-appended', async () => {
    process.env.AUCTION_L1_REPLAY_ROOT = join(tempRoot, 'raw2')
    const snapshot = snapshotOverrides({ symbol: '600000' })
    const first = await appendAuctionReplayEvents('2026-08-22', [snapshot])
    const second = await appendAuctionReplayEvents('2026-08-22', [
      snapshot,
      snapshotOverrides({ symbol: '300001' }),
    ])
    expect(first).toBe(1)
    expect(second).toBe(1)
    expect(readAuctionReplayDay('2026-08-22')?.events).toHaveLength(2)
    delete process.env.AUCTION_L1_REPLAY_ROOT
  })

  it('returns no events and degraded health for a day without recordings', async () => {
    process.env.AUCTION_L1_REPLAY_ROOT = join(tempRoot, 'raw3')
    const provider = new ReplayAuctionProvider()
    const count = await provider.replay('2026-08-19')
    expect(count).toBe(0)
    expect(provider.getHealth().quality).toBe('unavailable')
    expect(provider.getHealth().warnings.join(' ')).toContain('无竞价录制文件')
    delete process.env.AUCTION_L1_REPLAY_ROOT
  })

  it('rejects unsafe dates', async () => {
    process.env.AUCTION_L1_REPLAY_ROOT = join(tempRoot, 'raw4')
    await expect(appendAuctionReplayEvents('2026/08/22', [snapshotOverrides({})])).rejects.toThrow()
    expect(() => readAuctionReplayDay('2026-08-22T00:00')).toThrow()
    delete process.env.AUCTION_L1_REPLAY_ROOT
  })
})