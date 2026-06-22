import { describe, it, expect } from 'vitest'
import {
  computeTechnical,
  deriveHoldingAction,
  buildPortfolioSummary,
  THRESHOLDS,
  type TechnicalView,
  type HoldingSignal,
} from './holdingsReview'
import type { Holding } from '../engine/holdings'

function tech(overrides: Partial<TechnicalView> = {}): TechnicalView {
  return {
    support: 90,
    resistance: 120,
    ma5: 100,
    volumeRatio: 1,
    volumeSignal: 'normal',
    trend: 'flat',
    signal: 'neutral',
    positionPct: 50,
    change5d: 0,
    ...overrides,
  }
}

describe('computeTechnical', () => {
  it('returns null for too few bars', () => {
    expect(computeTechnical([])).toBeNull()
    expect(computeTechnical([{ close: 1, high: 1, low: 1, volume: 1, changePct: 0 }])).toBeNull()
  })

  it('derives support/resistance from the 20-day range', () => {
    const klines = Array.from({ length: 30 }, (_, i) => ({
      close: 100 + i,
      high: 105 + i,
      low: 95 + i,
      volume: 1000,
      changePct: 1,
    }))
    const t = computeTechnical(klines)!
    expect(t.support).toBe(95 + 10) // low of last 20 bars (index 10..29)
    expect(t.resistance).toBe(105 + 29)
    expect(t.trend).toBe('up')
  })
})

describe('deriveHoldingAction', () => {
  it('watches when data is missing', () => {
    expect(deriveHoldingAction({ unrealizedPct: null, changePct: null, price: null, technical: null }).action).toBe(
      'watch',
    )
  })

  it('stops out when price breaks support', () => {
    const a = deriveHoldingAction({ unrealizedPct: 2, changePct: -1, price: 88, technical: tech({ support: 90 }) })
    expect(a.action).toBe('stopLoss')
    expect(a.stopLoss).toBe(90)
  })

  it('stops out when unrealized loss breaches the hard limit', () => {
    const a = deriveHoldingAction({
      unrealizedPct: THRESHOLDS.stopLossPct - 1,
      changePct: -2,
      price: 100,
      technical: tech(),
    })
    expect(a.action).toBe('stopLoss')
  })

  it('takes profit on rich gains near resistance', () => {
    const a = deriveHoldingAction({
      unrealizedPct: 30,
      changePct: 0,
      price: 119,
      technical: tech({ resistance: 120 }),
    })
    expect(a.action).toBe('takeProfit')
    expect(a.target).toBe(120)
  })

  it('reduces on bearish trend below the 5-day line', () => {
    const a = deriveHoldingAction({
      unrealizedPct: 5,
      changePct: -1,
      price: 98,
      technical: tech({ signal: 'bearish', ma5: 100 }),
    })
    expect(a.action).toBe('reduce')
  })

  it('adds when a strong stock dips to support', () => {
    const a = deriveHoldingAction({
      unrealizedPct: 3,
      changePct: 1,
      price: 91, // within dipBuyBand above support 90
      technical: tech({ signal: 'bullish', support: 90 }),
    })
    expect(a.action).toBe('add')
  })

  it('holds a healthy trend by default', () => {
    const a = deriveHoldingAction({
      unrealizedPct: 5,
      changePct: 1,
      price: 105,
      technical: tech({ signal: 'bullish', support: 90, resistance: 120, ma5: 100 }),
    })
    expect(a.action).toBe('hold')
  })
})

describe('buildPortfolioSummary', () => {
  const holding = (over: Partial<Holding>): Holding => ({
    code: '000001',
    name: '平安银行',
    quantity: 100,
    avgCost: 10,
    costBasis: 1000,
    source: 'auto',
    ...over,
  })

  function sig(over: Partial<HoldingSignal>): HoldingSignal {
    return {
      holding: holding({}),
      price: 11,
      changePct: 1,
      marketValue: 1100,
      unrealizedPnl: 100,
      unrealizedPct: 10,
      technical: tech(),
      action: { action: 'hold', reason: '' },
      ...over,
    }
  }

  it('aggregates market value, P&L and a weighted today change', () => {
    const signals = [
      sig({ marketValue: 1000, unrealizedPnl: 100, changePct: 2, holding: holding({ costBasis: 900 }) }),
      sig({ marketValue: 3000, unrealizedPnl: -300, changePct: -2, holding: holding({ code: '600519', costBasis: 3300 }) }),
    ]
    const s = buildPortfolioSummary(signals)
    expect(s.count).toBe(2)
    expect(s.totalMarketValue).toBe(4000)
    expect(s.totalUnrealizedPnl).toBe(-200)
    // weighted: (1000*2 + 3000*-2) / 4000 = -1
    expect(s.todayChangePct).toBeCloseTo(-1, 5)
  })

  it('flags the worst holding and surfaces risk actions in the plan', () => {
    const signals = [
      sig({ unrealizedPct: 12, action: { action: 'hold', reason: 'ok' } }),
      sig({
        holding: holding({ code: '600519', name: '茅台' }),
        unrealizedPct: -9,
        action: { action: 'stopLoss', reason: '止损' },
      }),
    ]
    const s = buildPortfolioSummary(signals)
    expect(s.worst?.code).toBe('600519')
    expect(s.risks).toHaveLength(1)
    expect(s.plan[0].action).toBe('stopLoss') // highest priority first
  })
})
