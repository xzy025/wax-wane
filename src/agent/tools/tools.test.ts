import { describe, it, expect } from 'vitest'
import { calculateMetrics } from './calculateMetrics'
import { findPatterns } from './findPatterns'
import { getRiskAlerts } from './getRiskAlerts'
import { queryTrades } from './queryTrades'
import { getTradeGroups } from './getTradeGroups'
import type { AppState } from '../../store'
import type { TradeGroup, ReviewNote, ParsedTrade } from '../../types'

// Helper to call tool execute
async function callTool(tool: { execute: (args: Record<string, unknown>, state: AppState) => unknown }, args: Record<string, unknown>, state: AppState) {
  return tool.execute(args, state)
}

// ── Helpers ─────────────────────────────────────────────────────

function trade(overrides: Partial<ParsedTrade> = {}): ParsedTrade {
  return {
    tradeDate: '2026-05-01',
    stockCode: '600519',
    stockName: '贵州茅台',
    side: 'buy',
    quantity: 100,
    price: 1800,
    grossAmount: 180000,
    commission: 50,
    stampTax: 0,
    transferFee: 1,
    otherFee: 0,
    netAmount: 180051,
    raw: {},
    ...overrides,
  }
}

function group(overrides: Partial<TradeGroup> = {}): TradeGroup {
  return {
    id: 'tg-001',
    code: '600519',
    name: '贵州茅台',
    opened: '2026-05-01',
    closed: '2026-05-10',
    pnl: 5000,
    returnRate: 2.78,
    days: 9,
    totalFee: 120,
    strategy: 'Pullback',
    mistakes: [],
    status: 'Reviewed',
    ...overrides,
  }
}

function note(overrides: Partial<ReviewNote> = {}): ReviewNote {
  return {
    buyReason: '突破前高',
    sellReason: '达到目标价',
    executionReview: '执行良好',
    lesson: '耐心等待确认',
    ...overrides,
  }
}

function createState(overrides: Partial<AppState> = {}): AppState {
  return {
    trades: [],
    tradeGroups: [],
    reviewNotes: {},
    importBatches: [],
    ...overrides,
  }
}

// ── calculateMetrics ────────────────────────────────────────────

describe('calculateMetrics', () => {
  it('returns zero metrics for empty state', async () => {
    const result = await callTool(calculateMetrics, {}, createState()) as Record<string, unknown>
    expect(result.totalGroups).toBe(0)
    expect(result.winRate).toBe(0)
    expect(result.totalPnl).toBe(0)
  })

  it('calculates correct metrics for trade groups', async () => {
    const state = createState({
      tradeGroups: [
        group({ pnl: 5000 }),
        group({ id: 'tg-002', pnl: -2000 }),
        group({ id: 'tg-003', pnl: 3000 }),
      ],
    })
    const result = await callTool(calculateMetrics, {}, state) as Record<string, unknown>
    expect(result.totalGroups).toBe(3)
    expect(result.winRate).toBeCloseTo(66.67, 1)
    expect(result.totalPnl).toBe(6000)
  })

  it('includes discipline score', async () => {
    const state = createState({
      tradeGroups: [group()],
      reviewNotes: { 'tg-001': note() },
    })
    const result = await callTool(calculateMetrics, {}, state) as Record<string, unknown>
    expect(result.disciplineScore).toBeDefined()
    expect(typeof result.disciplineScore).toBe('number')
  })
})

// ── findPatterns ────────────────────────────────────────────────

describe('findPatterns', () => {
  it('finds trades by mistake tag', async () => {
    const state = createState({
      tradeGroups: [
        group({ mistakes: ['Chasing high'] }),
        group({ id: 'tg-002', mistakes: ['Early profit taking'] }),
        group({ id: 'tg-003', mistakes: ['Chasing high'] }),
      ],
    })
    const result = await callTool(findPatterns, { mistakeTag: 'Chasing high' }, state) as unknown[]
    expect(result.length).toBe(2)
  })

  it('finds trades by strategy', async () => {
    const state = createState({
      tradeGroups: [
        group({ strategy: 'Pullback' }),
        group({ id: 'tg-002', strategy: 'Breakout' }),
      ],
    })
    const result = await callTool(findPatterns, { strategy: 'Pullback' }, state) as unknown[]
    expect(result.length).toBe(1)
  })

  it('returns empty for no matches', async () => {
    const state = createState({
      tradeGroups: [group({ mistakes: [] })],
    })
    const result = await callTool(findPatterns, { mistakeTag: 'Chasing high' }, state) as unknown[]
    expect(result.length).toBe(0)
  })
})

// ── getRiskAlerts ───────────────────────────────────────────────

describe('getRiskAlerts', () => {
  it('detects unreviewed trades', async () => {
    const state = createState({
      tradeGroups: [group({ status: 'Not reviewed', mistakes: [] })],
    })
    const result = await callTool(getRiskAlerts, {}, state) as Record<string, unknown>
    const alerts = result.alerts as Array<Record<string, unknown>>
    const unreviewedAlert = alerts.find((a) => a.title === 'Unreviewed trades')
    expect(unreviewedAlert).toBeDefined()
  })

  it('detects open losing positions', async () => {
    const state = createState({
      tradeGroups: [group({ closed: null, pnl: -500 })],
    })
    const result = await callTool(getRiskAlerts, {}, state) as Record<string, unknown>
    expect((result.alerts as unknown[]).length).toBeGreaterThan(0)
  })

  it('returns no alerts for healthy portfolio', async () => {
    const state = createState({
      tradeGroups: [group({ status: 'Reviewed', pnl: 10000, closed: '2026-05-10', mistakes: [], totalFee: 10 })],
      reviewNotes: { 'tg-001': note() },
    })
    const result = await callTool(getRiskAlerts, {}, state) as Record<string, unknown>
    const alerts = result.alerts as Array<Record<string, unknown>>
    // Should only have "No risk signals" alert
    expect(alerts.length).toBe(1)
    expect(alerts[0].severity).toBe('none')
  })
})

// ── queryTrades ─────────────────────────────────────────────────

describe('queryTrades', () => {
  it('returns all trades when no filter', async () => {
    const state = createState({
      trades: [trade(), trade({ stockCode: '300750' })],
    })
    const result = await callTool(queryTrades, {}, state) as unknown[]
    expect(result.length).toBe(2)
  })

  it('filters by stock code', async () => {
    const state = createState({
      trades: [
        trade({ stockCode: '600519' }),
        trade({ stockCode: '300750' }),
      ],
    })
    const result = await callTool(queryTrades, { stockCode: '600519' }, state) as unknown[]
    expect(result.length).toBe(1)
  })

  it('filters by side', async () => {
    const state = createState({
      trades: [
        trade({ side: 'buy' }),
        trade({ side: 'sell' }),
      ],
    })
    const result = await callTool(queryTrades, { side: 'buy' }, state) as unknown[]
    expect(result.length).toBe(1)
  })
})

// ── getTradeGroups ──────────────────────────────────────────────

describe('getTradeGroups', () => {
  it('returns trade group by id', async () => {
    const state = createState({
      tradeGroups: [group(), group({ id: 'tg-002' })],
    })
    const result = await callTool(getTradeGroups, { groupId: 'tg-001' }, state) as Record<string, unknown>
    expect(result).not.toBeNull()
    expect(result!.id).toBe('tg-001')
  })

  it('returns trade group by stock code', async () => {
    const state = createState({
      tradeGroups: [group(), group({ id: 'tg-002', code: '300750' })],
    })
    const result = await callTool(getTradeGroups, { stockCode: '600519' }, state) as Record<string, unknown>
    expect(result).not.toBeNull()
    expect(result!.stockCode).toBe('600519')
  })

  it('includes review notes when available', async () => {
    const state = createState({
      tradeGroups: [group()],
      reviewNotes: { 'tg-001': note() },
    })
    const result = await callTool(getTradeGroups, { groupId: 'tg-001' }, state) as Record<string, unknown>
    expect(result!.reviewNote).toBeDefined()
    expect((result!.reviewNote as Record<string, unknown>).buyReason).toBe('突破前高')
  })

  it('returns null for non-existent group', async () => {
    const state = createState({
      tradeGroups: [group()],
    })
    const result = await callTool(getTradeGroups, { groupId: 'tg-999' }, state)
    expect(result).toBeNull()
  })
})
