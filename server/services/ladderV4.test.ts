import { describe, expect, it } from 'vitest'
import type { ScreenerLiveQuote } from './screenerScan'
import {
  applyEventReactionToRiskContext,
  buildEventReaction,
  buildHighBoardRiskContext,
  buildLadderRoleMap,
  buildPromotionStatistics,
  classifyLadderRiskEvent,
  type LadderEventFact,
  type RoleStockInput,
} from './ladderV4'

function stock(
  code: string,
  boards: number,
  theme = '消费',
  overrides: Partial<RoleStockInput> = {},
): RoleStockInput {
  return {
    code,
    name: code,
    consecutiveDays: boards,
    primaryTheme: theme,
    themes: [theme],
    firstTime: '093100',
    openCount: 0,
    onePrice: false,
    ...overrides,
  }
}

function quote(
  code: string,
  changePct: number,
  overrides: Partial<ScreenerLiveQuote> = {},
): ScreenerLiveQuote {
  const prevClose = 10
  const price = prevClose * (1 + changePct / 100)
  return {
    code,
    name: code,
    tradeDate: '2026-08-18',
    quoteTime: '09:25:00',
    capturedAt: '2026-08-18T01:25:00.000Z',
    source: 'tencent',
    price,
    changePct,
    open: price,
    high: price,
    low: price,
    prevClose,
    volume: 100_000,
    amount: 100_000_000,
    indicativePrice: price,
    matchedAmount: 50_000_000,
    ...overrides,
  }
}

function fact(
  title: string,
  code: string,
  overrides: Partial<LadderEventFact> = {},
): LadderEventFact {
  return {
    id: title,
    publishedAt: '2026-08-18T07:00:00.000Z',
    source: 'exchange',
    sourceUrl: '',
    title,
    summary: '',
    codes: [code],
    important: true,
    official: true,
    ...overrides,
  }
}

describe('limit ladder v4 role map', () => {
  it('separates market, theme, dynamic height and carding roles', () => {
    const current = [
      stock('600001', 5, '科技'),
      stock('600002', 4, '科技'),
      stock('600003', 3, '消费'),
      stock('600004', 1, '消费'),
    ]
    const map = buildLadderRoleMap({
      stocks: current,
      histories: [
        {
          asof: '2026-08-17',
          stocks: [
            { code: '600009', consecutiveDays: 4, primaryTheme: '科技' },
            { code: '600003', consecutiveDays: 2, primaryTheme: '消费' },
          ],
        },
      ],
      anchors: [
        {
          code: '600008',
          name: '断板锚',
          themes: ['科技'],
          priorMaxBoards: 6,
          active: true,
        },
      ],
    })

    expect(map.spaceLeaderCodes).toEqual(['600001'])
    expect(map.profiles.find((row) => row.code === '600001')).toMatchObject({
      marketRole: 'space-leader',
      themeRole: 'theme-position-leader',
      heightTier: 'high',
      cardedCodes: ['600009'],
    })
    expect(map.profiles.find((row) => row.code === '600003')?.heightTier).toBe(
      'middle',
    )
    expect(map.profiles.find((row) => row.code === '600004')?.heightTier).toBe(
      'low',
    )
    expect(map.brokenAnchors[0]).toMatchObject({
      marketRole: 'high-anchor',
      lifecycle: 'broken-maintain',
    })
  })

  it('marks tied maximum boards as co-space leaders', () => {
    const map = buildLadderRoleMap({
      stocks: [stock('600001', 4), stock('600002', 4)],
    })
    expect(map.profiles.map((row) => row.marketRole)).toEqual([
      'co-space-leader',
      'co-space-leader',
    ])
  })
})

describe('limit ladder v4 event gate rules', () => {
  const stocks = [stock('603221', 3, '家居')]

  it('treats related-account restrictions as a risk cap, not a hard block', () => {
    const event = classifyLadderRiskEvent(
      fact('相关账户因异常交易被限制交易', '603221'),
      stocks,
    )
    expect(event).toMatchObject({
      category: 'regulatory-restriction',
      action: 'risk-cap',
      severity: 4,
    })
  })

  it('hard-blocks a confirmed stock suspension', () => {
    const event = classifyLadderRiskEvent(
      fact('公司股票自明日起停牌', '603221'),
      stocks,
    )
    expect(event?.action).toBe('hard-block')
  })

  it('downgrades unverified risk claims to informational', () => {
    const event = classifyLadderRiskEvent(
      fact('市场传闻公司被重点监控', '603221', {
        source: 'rumor',
        important: false,
        official: false,
      }),
      stocks,
    )
    expect(event?.action).toBe('informational')
  })

  it('does not treat a restricted-share incentive plan as industry policy', () => {
    const event = classifyLadderRiskEvent(
      fact('关于2026年限制性股票激励计划的公告', '603221'),
      stocks,
    )
    expect(event).toMatchObject({
      category: 'other',
      action: 'informational',
    })
  })
})

describe('limit ladder v4 promotion calibration', () => {
  it('does not expose a raw 1/1 rate as a 100% decision probability', () => {
    const statistics = buildPromotionStatistics([
      { signalDate: '2026-08-17', lane: '2进3', promoted: true },
    ])
    const lane = statistics.byLane['2进3'].day20
    expect(lane.rawRate).toBe(100)
    expect(lane.adjustedRate).toBeLessThan(60)
    expect(lane.confidence).toBe('low')
    expect(lane.valid).toBe(1)
  })

  it('builds cycle, role and theme-state slices', () => {
    const statistics = buildPromotionStatistics([
      {
        signalDate: '2026-08-17',
        lane: '1进2',
        promoted: true,
        marketCycle: 'repair',
        marketRole: 'normal',
        themeState: 'expansion',
      },
    ])
    expect(statistics.byMarketCycle.repair.day1.valid).toBe(1)
    expect(statistics.byRole.normal.day1.valid).toBe(1)
    expect(statistics.byThemeState.expansion.day1.valid).toBe(1)
  })
})

describe('limit ladder v4 high-board risk appetite', () => {
  it('detects expansion and one-price retention from a broad strong basket', () => {
    const roleMap = buildLadderRoleMap({
      stocks: Array.from({ length: 6 }, (_, index) =>
        stock(`60000${index + 1}`, 3 + (index % 2), '科技', {
          onePrice: index === 0,
        }),
      ),
    })
    const quotes = Object.fromEntries(
      roleMap.profiles.map((profile, index) => [
        profile.code,
        quote(profile.code, index === 0 ? 10 : 3, {
          unmatchedSide: index === 0 ? 'buy' : null,
        }),
      ]),
    )
    const context = buildHighBoardRiskContext({
      roleMap,
      auctionQuotes: quotes,
      capturedAt: '2026-08-18T01:25:00.000Z',
    })
    expect(context.state).toBe('expansion')
    expect(context.metrics.onePriceRetentionRate).toBe(100)
  })

  it('detects panic and a theme-level high-low switch', () => {
    const roleMap = buildLadderRoleMap({
      stocks: [
        stock('600001', 4, '消费'),
        stock('600002', 1, '消费'),
        stock('600003', 1, '消费'),
      ],
    })
    const context = buildHighBoardRiskContext({
      roleMap,
      auctionQuotes: {
        '600001': quote('600001', -9),
        '600002': quote('600002', 3),
        '600003': quote('600003', 2),
      },
      capturedAt: '2026-08-18T01:25:00.000Z',
    })
    expect(context.state).toBe('panic')
    expect(context.themes[0].highLowSwitch).toBe(true)
  })

  it('records a 9:35 reopen-and-reseal feedback', () => {
    const roleMap = buildLadderRoleMap({
      stocks: [stock('600001', 4, '科技')],
    })
    const context = buildHighBoardRiskContext({
      roleMap,
      auctionQuotes: { '600001': quote('600001', 3) },
      liveQuotes: {
        '600001': quote('600001', 10, {
          quoteTime: '09:35:00',
          open: 10.3,
          low: 10.2,
          high: 11,
          price: 11,
        }),
      },
      capturedAt: '2026-08-18T01:35:00.000Z',
    })
    expect(context.members[0].resealed).toBe(true)
    expect(context.metrics.resealRate).toBe(100)
  })

  it('cross-validates regulatory pressure with price reaction', () => {
    const roleMap = buildLadderRoleMap({
      stocks: [stock('600001', 4), stock('600002', 3), stock('600003', 3)],
    })
    const gate = {
      generatedAt: '',
      coverage: 100,
      sourceStatus: {},
      events: [],
      hardBlockedCodes: [],
      riskCappedCodes: ['600001', '600002'],
      themeAdjustments: {},
      marketRisk: 'severe' as const,
      warnings: [],
    }
    const quotes = {
      '600001': quote('600001', -8),
      '600002': quote('600002', -6),
      '600003': quote('600003', 1),
    }
    const reaction = buildEventReaction({ gate, quotes })
    const raw = buildHighBoardRiskContext({
      roleMap,
      auctionQuotes: quotes,
      capturedAt: '2026-08-18T01:25:00.000Z',
    })
    const adjusted = applyEventReactionToRiskContext(raw, gate, reaction)
    expect(reaction.state).toBe('amplified')
    expect(adjusted.score).toBeLessThan(raw.score)
  })
})
