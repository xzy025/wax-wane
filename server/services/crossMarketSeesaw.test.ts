import { describe, expect, it } from 'vitest'
import { assessThemeCycle, buildCapitalSeesaw, buildExternalBasketShock, buildLiquidityRegime, classifyNextThemeOutcome } from './crossMarketSeesaw'

describe('cross-market capital seesaw research rules', () => {
  it('caps one source contribution and lowers confidence for a split CPO basket', () => {
    const shock = buildExternalBasketShock({ id: 'cpo', sources: [
      { ticker: 'LITE', changePct: 8, kind: 'anchor' },
      { ticker: 'MRVL', changePct: 6, kind: 'anchor' },
      { ticker: 'COHR', changePct: 1, kind: 'anchor' },
      { ticker: 'CIEN', changePct: -2, kind: 'anchor' },
      { ticker: 'AVGO', changePct: 0.5, kind: 'anchor' },
    ] })
    expect(shock.score).toBeGreaterThan(0)
    expect(shock.split).toBe(true)
    expect(shock.maxSingleContributionPct).toBeLessThanOrEqual(35)
    expect(shock.confidence).toBeLessThan(100)
  })

  it('uses ETF weakness as a negative modifier instead of a hard veto', () => {
    const shock = buildExternalBasketShock({ id: 'innovative-drug', sources: [
      { ticker: 'XBI', changePct: -4, kind: 'etf' },
      { ticker: 'IBB', changePct: -3, kind: 'etf' },
      { ticker: 'MRNA', changePct: -24, kind: 'anchor' },
      { ticker: 'BNTX', changePct: -2, kind: 'anchor' },
      { ticker: 'LLY', changePct: -3, kind: 'anchor' },
      { ticker: 'NVO', changePct: -1, kind: 'anchor' },
    ] })
    const climax = assessThemeCycle({ returnZ: 2.5, limitUpCount: 5, firstBoardCount: 3, positiveBreadthPct: 80, amountRatio20: 1.4, strongCoreCount: 2 })
    const liquidity = buildLiquidityRegime({ phase: 'auction', cutoffAt: '2026-08-21T09:25:00+08:00', source: 'full-market-clist', totalAmount: 100, baselineAmounts: Array(20).fill(100), advance: 2500, decline: 2500, top50AmountSharePct: 25, baselineTop50Shares: Array(20).fill(25), largeSmallSpreadPct: 0 })
    const matrix = buildCapitalSeesaw({ phase: 'auction', external: { 'innovative-drug': shock }, cycles: { 'innovative-drug': climax }, auctionConfirmation: { 'innovative-drug': 1 }, openConfirmation: {}, liquidity })
    const lane = matrix.lanes.find((row) => row.id === 'innovative-drug')!
    expect(lane.externalShock).toBeLessThan(0)
    expect(lane.auctionConfirmation).toBe(1)
    expect(lane.netResearchScore).toBeGreaterThan(35)
  })

  it('classifies stock crowding and penalizes small themes when tech leads', () => {
    const liquidity = buildLiquidityRegime({ phase: 'open', cutoffAt: '2026-08-21T09:35:00+08:00', source: 'full-market-clist', totalAmount: 100, baselineAmounts: Array(20).fill(100), advance: 1400, decline: 3700, top50AmountSharePct: 35, baselineTop50Shares: Array(20).fill(25), largeSmallSpreadPct: 0.6 })
    expect(liquidity.state).toBe('stock-crowding')
    const matrix = buildCapitalSeesaw({ phase: 'open', external: {}, cycles: {}, auctionConfirmation: { 'hard-tech': 0.8 }, openConfirmation: { 'hard-tech': 1, 'small-theme': -0.5 }, liquidity })
    const small = matrix.lanes.find((row) => row.id === 'small-theme')!
    expect(small.liquidityAdjustment).toBe(-1)
    expect(matrix.transfers.some((row) => row.to === 'hard-tech')).toBe(true)
  })

  it('does not claim crowding when amount and breadth are incremental', () => {
    const liquidity = buildLiquidityRegime({ phase: 'open', cutoffAt: '2026-08-21T09:35:00+08:00', source: 'full-market-clist', totalAmount: 120, baselineAmounts: Array(20).fill(100), advance: 3000, decline: 2000, top50AmountSharePct: 27, baselineTop50Shares: Array(20).fill(25), largeSmallSpreadPct: 0.2 })
    expect(liquidity.state).toBe('incremental-broad')
  })

  it('requires enough cycle and liquidity evidence', () => {
    expect(assessThemeCycle({ returnZ: null, limitUpCount: 3, firstBoardCount: 2, positiveBreadthPct: null, amountRatio20: null, strongCoreCount: 1 }).state).toBe('unavailable')
    expect(buildLiquidityRegime({ phase: 'auction', cutoffAt: '', source: 'full-market-clist', totalAmount: 100, baselineAmounts: Array(5).fill(100), advance: 100, decline: 100, top50AmountSharePct: 20, baselineTop50Shares: Array(5).fill(20), largeSmallSpreadPct: 0 }).state).toBe('unavailable')
    expect(classifyNextThemeOutcome({ priorClimax: true, excessReturnPct: -0.5, positiveBreadthPct: 30, limitUpCount: 1, strongCoreCount: 1 })).toBe('differentiation')
  })
})
