import { describe, it, expect } from 'vitest'
import {
  computeWinRate,
  computePayoff,
  computeTotalFees,
  computeTotalPnl,
  computeConsecutiveLosses,
  computeAvgHoldingDays,
  computeDisciplineScore,
} from './metrics'
import type { TradeGroup, ReviewNote } from '../types'

function group(overrides: Partial<TradeGroup> = {}): TradeGroup {
  return {
    id: '1',
    code: '600519',
    name: 'Test',
    opened: '2026-05-01',
    closed: '2026-05-10',
    pnl: 100,
    returnRate: 5,
    days: 9,
    totalFee: 10,
    strategy: 'Pullback',
    mistakes: [],
    status: 'Reviewed',
    ...overrides,
  }
}

describe('computeWinRate', () => {
  it('returns 0 for empty array', () => {
    expect(computeWinRate([])).toBe(0)
  })

  it('calculates correct win rate', () => {
    const groups = [group({ pnl: 100 }), group({ pnl: -50 }), group({ pnl: 200 })]
    expect(computeWinRate(groups)).toBeCloseTo(66.67, 1)
  })

  it('returns 100 when all winners', () => {
    expect(computeWinRate([group({ pnl: 100 })])).toBe(100)
  })
})

describe('computePayoff', () => {
  it('returns 0 for empty array', () => {
    expect(computePayoff([])).toBe(0)
  })

  it('returns 0 when no losers', () => {
    expect(computePayoff([group({ pnl: 100 })])).toBe(0)
  })

  it('calculates correct payoff ratio', () => {
    const groups = [group({ pnl: 200 }), group({ pnl: -100 })]
    // avgWin = 200, avgLoss = 100, payoff = 2.0
    expect(computePayoff(groups)).toBeCloseTo(2.0, 1)
  })
})

describe('computeTotalFees', () => {
  it('sums fees', () => {
    expect(computeTotalFees([group({ totalFee: 10 }), group({ totalFee: 20 })])).toBe(30)
  })

  it('handles undefined totalFee', () => {
    expect(computeTotalFees([group({ totalFee: undefined as unknown as number })])).toBe(0)
  })
})

describe('computeTotalPnl', () => {
  it('sums PnL', () => {
    expect(computeTotalPnl([group({ pnl: 100 }), group({ pnl: -30 })])).toBe(70)
  })
})

describe('computeConsecutiveLosses', () => {
  it('returns 0 for empty', () => {
    expect(computeConsecutiveLosses([])).toBe(0)
  })

  it('finds max consecutive losses', () => {
    const groups = [
      group({ pnl: 100 }),
      group({ pnl: -50 }),
      group({ pnl: -30 }),
      group({ pnl: -20 }),
      group({ pnl: 100 }),
      group({ pnl: -10 }),
    ]
    expect(computeConsecutiveLosses(groups)).toBe(3)
  })
})

describe('computeAvgHoldingDays', () => {
  it('returns 0 for empty', () => {
    expect(computeAvgHoldingDays([])).toBe(0)
  })

  it('calculates average', () => {
    expect(computeAvgHoldingDays([group({ days: 5 }), group({ days: 15 })])).toBe(10)
  })
})

describe('computeDisciplineScore', () => {
  it('returns 0 score for empty', () => {
    expect(computeDisciplineScore([], {}).score).toBe(0)
  })

  it('returns 100 for fully reviewed groups with no mistakes', () => {
    const groups = [group({ id: '1', mistakes: [] })]
    const notes: Record<string, ReviewNote> = {
      '1': { buyReason: 'test', sellReason: '', executionReview: '', lesson: '' },
    }
    expect(computeDisciplineScore(groups, notes).score).toBe(100)
  })

  it('deducts for unreviewed groups', () => {
    const groups = [group({ id: '1', mistakes: [] }), group({ id: '2', mistakes: [] })]
    const notes: Record<string, ReviewNote> = {
      '1': { buyReason: 'test', sellReason: '', executionReview: '', lesson: '' },
    }
    // 1 of 2 reviewed = 50% rate, deduction = round((1-0.5)*20) = 10
    expect(computeDisciplineScore(groups, notes).score).toBe(90)
  })

  it('deducts for mistake patterns', () => {
    const groups = [group({ id: '1', mistakes: ['Late stop loss'] })]
    const notes: Record<string, ReviewNote> = {
      '1': { buyReason: 'test', sellReason: '', executionReview: '', lesson: '' },
    }
    // 1 occurrence * 5 = 5, cap is 15, so deduction = 5
    expect(computeDisciplineScore(groups, notes).score).toBe(95)
  })

  it('returns penalties array', () => {
    const groups = [group({ id: '1', mistakes: ['Late stop loss'] })]
    const result = computeDisciplineScore(groups, {})
    expect(result.penalties.length).toBeGreaterThan(0)
  })
})
