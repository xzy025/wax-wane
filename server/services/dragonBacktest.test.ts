import { describe, expect, it } from 'vitest'
import { buildDragonBacktestReport, summarizeDragonBacktest, type DragonBacktestSample } from './dragonBacktest'

const sample = (overrides: Partial<DragonBacktestSample> = {}): DragonBacktestSample => ({
  code: '600001',
  date: '2026-08-18',
  baseRank: 1,
  dragonScore: 78,
  hardGatePassed: true,
  dimensions: { drive: 75, antiDrop: 70 },
  lane: '2进3',
  marketPhase: 'repair',
  forward: {
    available: true,
    promoted: true,
    openGapPct: 3,
    closeReturnPct: 8,
    day3ReturnPct: 12,
    maxFavorablePct: 15,
    maxAdversePct: -2,
  },
  ...overrides,
})

describe('dragonBacktest', () => {
  it('只使用可用的次日及第三日结果计算覆盖率和收益', () => {
    const result = summarizeDragonBacktest([
      sample(),
      sample({ code: '600002', forward: { available: false, promoted: false, openGapPct: null, closeReturnPct: null, day3ReturnPct: null, maxFavorablePct: null, maxAdversePct: null } }),
    ])
    expect(result.samples).toBe(2)
    expect(result.forwardCoveragePct).toBe(50)
    expect(result.promotionRatePct).toBe(100)
    expect(result.avgDay3ReturnPct).toBe(12)
  })

  it('输出基线、增量因子、硬门槛和市场分桶', () => {
    const result = buildDragonBacktestReport([
      sample(),
      sample({ code: '600002', baseRank: 2, dragonScore: 48, dimensions: { drive: 45, antiDrop: 40 }, hardGatePassed: false, marketPhase: 'ebb', forward: { available: true, promoted: false, openGapPct: -2, closeReturnPct: -5, day3ReturnPct: -8, maxFavorablePct: 1, maxAdversePct: -10 } }),
      sample({ code: '600003', baseRank: 11 }),
    ], { topN: 10 })
    expect(result.baseline.samples).toBe(2)
    expect(result.drive.samples).toBe(1)
    expect(result.full.samples).toBe(1)
    expect(result.hardGated.samples).toBe(1)
    expect(result.byLane['2进3'].samples).toBe(1)
    expect(result.byMarketPhase.repair.promotionRatePct).toBe(100)
  })
})
