import { describe, expect, it } from 'vitest'
import { analyzeAuctionBehavior, type AuctionSupportPoint } from './auctionBehavior'

function point(
  checkpoint: AuctionSupportPoint['checkpoint'],
  over: Partial<AuctionSupportPoint> = {},
): AuctionSupportPoint {
  return {
    checkpoint,
    tradeDate: '2026-08-21',
    virtualPrice: 11,
    virtualMatchedQty: 100_000,
    virtualPriceReturnFromClose: 5,
    signedUnmatchedAmount: 0,
    ...over,
  }
}

// 12 亿元支持:19:50 峰值(匹配 609,090,909 股/11 元),09:20 剩 10 亿,09:25 剩 9 亿。
function lockedConfirmPoints(): AuctionSupportPoint[] {
  const at = (checkpoint: AuctionSupportPoint['checkpoint'], qty: number, gain: number, unmatched = 0) =>
    point(checkpoint, { virtualPrice: 11, virtualMatchedQty: qty, virtualPriceReturnFromClose: gain, signedUnmatchedAmount: unmatched })
  return [
    at('auction-initial', 200_000_000, 8, 0),
    at('auction-probe', 400_000_000, 8, 0),
    at('auction-prelock', 600_000_000, 8, 0),
    at('auction-lock', 500_000_000, 8.2, 0),
    at('auction-locked-mid', 500_000_000, 8.2, 0),
    at('auction-prefinal', 470_000_000, 8.1, 0),
    at('auction-final', 450_000_000, 8.0, 0),
  ]
}

describe('auction behavior heuristic-v1 labels', () => {
  it('1. 12亿元支持在09:20保留10亿、09:25保留9亿 → locked-confirmed', () => {
    const result = analyzeAuctionBehavior({
      symbol: '600000',
      tradeDate: '2026-08-21',
      points: lockedConfirmPoints(),
      fullMarketPercentile: 95,
      themePercentile: 90,
    })
    expect(result.lockRetention).not.toBeNull()
    expect(result.finalRetention).not.toBeNull()
    expect(result.labels.some((row) => row.label === 'locked-confirmed')).toBe(true)
    expect(result.labels.some((row) => row.label === 'probe-only')).toBe(false)
    expect(result.heuristicVersion).toBe('heuristic-v1')
  })

  it('2. 09:15强支持、09:20仅剩3000万、09:25仍弱 → probe-only(试盘未进入确认)', () => {
    const points: AuctionSupportPoint[] = [
      point('auction-initial', { virtualMatchedQty: 500_000_000, virtualPriceReturnFromClose: 8 }),
      point('auction-prelock', { virtualMatchedQty: 600_000_000, virtualPriceReturnFromClose: 8 }),
      point('auction-lock', { virtualMatchedQty: 50_000_000, virtualPriceReturnFromClose: 8 }),
      point('auction-final', { virtualMatchedQty: 30_000_000, virtualPriceReturnFromClose: 3 }),
    ]
    const result = analyzeAuctionBehavior({
      symbol: '600000',
      tradeDate: '2026-08-21',
      points,
      fullMarketPercentile: 96,
    })
    expect(result.labels.some((row) => row.label === 'probe-only')).toBe(true)
    // 不得输出「确认撤单12亿元」语义。
    expect(result.labels.some((row) => row.detail.includes('撤单'))).toBe(false)
  })

  it('3. 未匹配量下降但匹配量上升且价格稳定 → absorbed-not-withdrawn', () => {
    const points: AuctionSupportPoint[] = [
      point('auction-initial', { virtualMatchedQty: 100_000, virtualPrice: 11, virtualPriceReturnFromClose: 5, signedUnmatchedAmount: 800_000_000 }),
      point('auction-prelock', { virtualMatchedQty: 100_000, virtualPrice: 11, virtualPriceReturnFromClose: 5, signedUnmatchedAmount: 900_000_000 }),
      point('auction-lock', { virtualMatchedQty: 150_000, virtualPrice: 11, virtualPriceReturnFromClose: 5, signedUnmatchedAmount: 300_000_000 }),
      point('auction-final', { virtualMatchedQty: 600_000, virtualPrice: 11, virtualPriceReturnFromClose: 5, signedUnmatchedAmount: 100_000_000 }),
    ]
    const result = analyzeAuctionBehavior({
      symbol: '600000',
      tradeDate: '2026-08-21',
      points,
      fullMarketPercentile: 80,
    })
    expect(result.labels.some((row) => row.label === 'absorbed-not-withdrawn')).toBe(true)
  })

  it('4. 核心稳定但无助攻时不等于题材认可(仅返回研究标签,不生成交易指令)', () => {
    const result = analyzeAuctionBehavior({
      symbol: '600000',
      tradeDate: '2026-08-21',
      points: lockedConfirmPoints(),
      fullMarketPercentile: null,
      themePercentile: null,
    })
    // 全市场百分位缺失 → 抗拉标签缺条件,只能 insufficient-data,不假装题材认可。
    expect(result.labels.some((row) => row.label === 'insufficient-data')).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('全市场百分位缺失'))).toBe(true)
  })

  it('5. 09:20后成员同步增强 → late-reinforcement', () => {
    const points: AuctionSupportPoint[] = [
      point('auction-initial', { virtualMatchedQty: 100_000, virtualPriceReturnFromClose: 3, signedUnmatchedAmount: 0 }),
      point('auction-prelock', { virtualMatchedQty: 100_000, virtualPriceReturnFromClose: 3, signedUnmatchedAmount: 0 }),
      point('auction-lock', { virtualMatchedQty: 120_000, virtualPriceReturnFromClose: 3.5, signedUnmatchedAmount: 0 }),
      point('auction-final', { virtualMatchedQty: 400_000, virtualPriceReturnFromClose: 6, signedUnmatchedAmount: 50_000_000 }),
    ]
    const result = analyzeAuctionBehavior({
      symbol: '600000',
      tradeDate: '2026-08-21',
      points,
      fullMarketPercentile: 70,
    })
    expect(result.labels.some((row) => row.label === 'late-reinforcement')).toBe(true)
  })

  it('6. 09:15或09:20缺失时不计算保留率 → insufficient-data', () => {
    const missingLock = analyzeAuctionBehavior({
      symbol: '600000',
      tradeDate: '2026-08-21',
      points: lockedConfirmPoints().filter((row) => row.checkpoint !== 'auction-lock'),
      fullMarketPercentile: 95,
    })
    expect(missingLock.lockRetention).toBeNull()
    expect(missingLock.labels.some((row) => row.label === 'insufficient-data')).toBe(true)
  })
})

describe('auction behavior arithmetic safety', () => {
  it('returns null for invalid denominators and missing checkpoints, never 0', () => {
    const result = analyzeAuctionBehavior({
      symbol: '600000',
      tradeDate: '2026-08-21',
      points: [point('auction-final', { virtualMatchedQty: 0, virtualPrice: null })],
    })
    expect(result.preLockPeakEffectiveBuySupport).toBeNull()
    expect(result.finalRetention).toBeNull()
    expect(result.matchedConversion).toBeNull()
  })

  it('labels carry heuristic-v1 evidence, never trading advice', () => {
    const result = analyzeAuctionBehavior({
      symbol: '600000',
      tradeDate: '2026-08-21',
      points: lockedConfirmPoints(),
      fullMarketPercentile: 96,
    })
    for (const label of result.labels) {
      expect(['probe-only', 'locked-confirmed', 'absorbed-not-withdrawn', 'late-reinforcement', 'insufficient-data']).toContain(label.label)
      expect(label.detail).not.toMatch(/建议|买入|打板|仓位/)
    }
  })
})