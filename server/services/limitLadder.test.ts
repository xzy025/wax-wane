import { describe, expect, it } from 'vitest'
import {
  analyzeTechnical,
  buildAuctionContext,
  buildOutcomeSummary,
  classifyLadderSizeBucket,
  classifyAuctionMarket,
  classifyMarketCycle,
  combineEnvironmentAdjustments,
  computePromotionLanes,
  crossSectionPercentile,
  isAuctionTailBuy,
  isOpeningDirectPullUp,
  isOpeningVolumePriceRebound,
  isLadderSettledWindow,
  isPremarketGateCaptureWindow,
  normalizeLadderImport,
  rankAndClassifyStocks,
  scoreDragonIdentity,
  scoreLadderFundFlow,
  scoreLiquidityStyleGate,
  scoreNextDayConfirmations,
  scoreThemes,
  scoreTurnoverCapacity,
  settleNextDayFromSnapshots,
  shouldWarnMissingPremarketGate,
  type MarketCycle,
  type AuctionMarketStock,
  type LadderAuctionContext,
  type AuctionProcessArchive,
  type LadderOutcomeRow,
  type NormalizedStock,
  type TechnicalEvidence,
  type LadderStockAnalysis,
  type NextDayCandidateConfirmation,
  type ThemeAnchor,
  type ThemeAnalysis,
} from './limitLadder'
import type { KlineBar } from './ashare'
import type { ScreenerLiveQuote } from './screenerScan'
import { buildNextDayRelayPlan } from './limitLadderRelay'
import type { HighBoardRiskContext } from './ladderV4'
import type { MarketRiskGate } from './ladderMarketGate'

describe('isLadderSettledWindow', () => {
  it('只在工作日15:00以后允许生成定盘快照', () => {
    expect(isLadderSettledWindow({ day: 2, minutes: 14 * 60 + 59 })).toBe(false)
    expect(isLadderSettledWindow({ day: 2, minutes: 15 * 60 })).toBe(true)
    expect(isLadderSettledWindow({ day: 6, minutes: 16 * 60 })).toBe(false)
  })
})

describe('limit ladder v6 liquidity style gate', () => {
  const weightLedRepair = {
    state: 'weight-led-repair' as const,
    capturedAt: '2026-08-20T09:25:00+08:00',
    applicable: true,
    confidence: 100,
    largeCapChangePct: 0.6,
    smallCapChangePct: -0.2,
    sizeSpreadPct: 0.8,
    advanceRate: 40,
    largeCapAuctionAmountSharePct: 65,
    highBoardState: 'contraction' as const,
    reasons: [],
    warnings: [],
  }
  const permission = {
    theme: '科技',
    riskClass: 'high-beta' as const,
    state: 'conditional' as const,
    score: 55,
    independentStrength: false,
    directionScore: 55,
    positiveRate: 45,
    assistantCount: 1,
    environmentAdjustment: -4,
    reasons: [],
  }

  it('classifies circulating market cap at the 100/500-yuan boundaries', () => {
    expect(classifyLadderSizeBucket(null)).toBe('unknown')
    expect(classifyLadderSizeBucket(9_999_999_999)).toBe('small')
    expect(classifyLadderSizeBucket(10_000_000_000)).toBe('mid')
    expect(classifyLadderSizeBucket(49_999_999_999)).toBe('mid')
    expect(classifyLadderSizeBucket(50_000_000_000)).toBe('large')
  })

  it('applies -4/-6/-8 only after a high-confidence weight-led repair is confirmed', () => {
    expect(
      scoreLiquidityStyleGate({
        circulatingMarketCap: 8e9,
        heightTier: 'low',
        themePermission: permission,
        highBoardState: 'contraction',
        repairContext: weightLedRepair,
      }),
    ).toMatchObject({ sizeBucket: 'small', adjustment: -4, confirmationCapped: false })
    expect(
      scoreLiquidityStyleGate({
        circulatingMarketCap: 20e9,
        heightTier: 'middle',
        themePermission: { ...permission, riskClass: 'neutral' },
        highBoardState: 'contraction',
        repairContext: weightLedRepair,
      }),
    ).toMatchObject({ sizeBucket: 'mid', adjustment: -6, confirmationCapped: true })
    expect(
      scoreLiquidityStyleGate({
        circulatingMarketCap: 8e9,
        heightTier: 'high',
        themePermission: permission,
        highBoardState: 'contraction',
        repairContext: weightLedRepair,
      }),
    ).toMatchObject({ sizeBucket: 'small', adjustment: -8, confirmationCapped: true })
    expect(
      scoreLiquidityStyleGate({
        circulatingMarketCap: 8e9,
        heightTier: 'high',
        themePermission: permission,
        highBoardState: 'contraction',
        repairContext: { ...weightLedRepair, applicable: false, confidence: 55 },
      }).adjustment,
    ).toBe(0)
  })

  it('halves the penalty and removes the state cap for an independently strong theme', () => {
    const result = scoreLiquidityStyleGate({
      circulatingMarketCap: 8e9,
      heightTier: 'high',
      themePermission: {
        ...permission,
        directionScore: 72,
        positiveRate: 65,
        assistantCount: 2,
      },
      highBoardState: 'divergence',
      repairContext: weightLedRepair,
    })

    expect(result.adjustment).toBe(-4)
    expect(result.independentStrength).toBe(true)
    expect(result.confirmationCapped).toBe(false)
  })

  it('caps combined environment penalties at -12 without letting defensive bonuses erase diversion', () => {
    expect(combineEnvironmentAdjustments(-8, -8)).toBe(-12)
    expect(combineEnvironmentAdjustments(5, -6)).toBe(-6)
  })
})

describe('isPremarketGateCaptureWindow', () => {
  it('freezes external risk only before the A-share auction starts', () => {
    expect(isPremarketGateCaptureWindow({ day: 3, minutes: 8 * 60 + 49 })).toBe(false)
    expect(isPremarketGateCaptureWindow({ day: 3, minutes: 8 * 60 + 50 })).toBe(true)
    expect(isPremarketGateCaptureWindow({ day: 3, minutes: 9 * 60 + 14 })).toBe(true)
    expect(isPremarketGateCaptureWindow({ day: 3, minutes: 9 * 60 + 15 })).toBe(false)
    expect(isPremarketGateCaptureWindow({ day: 6, minutes: 9 * 60 })).toBe(false)
  })
})

describe('shouldWarnMissingPremarketGate', () => {
  it('warns after the capture window without backfilling a missing snapshot', () => {
    expect(
      shouldWarnMissingPremarketGate({
        tradeDate: '2026-08-19',
        nowDate: '2026-08-19',
        clockMinutes: 9 * 60 + 14,
        hasPremarketSnapshot: false,
      }),
    ).toBe(false)
    expect(
      shouldWarnMissingPremarketGate({
        tradeDate: '2026-08-19',
        nowDate: '2026-08-19',
        clockMinutes: 9 * 60 + 15,
        hasPremarketSnapshot: false,
      }),
    ).toBe(true)
    expect(
      shouldWarnMissingPremarketGate({
        tradeDate: '2026-08-19',
        nowDate: '2026-08-20',
        clockMinutes: 8 * 60,
        hasPremarketSnapshot: false,
      }),
    ).toBe(true)
  })

  it('does not warn for future trade dates or archived snapshots', () => {
    expect(
      shouldWarnMissingPremarketGate({
        tradeDate: '2026-08-20',
        nowDate: '2026-08-19',
        clockMinutes: 15 * 60,
        hasPremarketSnapshot: false,
      }),
    ).toBe(false)
    expect(
      shouldWarnMissingPremarketGate({
        tradeDate: '2026-08-19',
        nowDate: '2026-08-19',
        clockMinutes: 15 * 60,
        hasPremarketSnapshot: true,
      }),
    ).toBe(false)
  })
})

describe('scoreLadderFundFlow', () => {
  it('机构和知名游资净买加分，缺失保持不可用', () => {
    expect(scoreLadderFundFlow().score).toBeNull()
    expect(scoreLadderFundFlow().source).toBe('unavailable')
    const score = scoreLadderFundFlow({
      net: 80_000_000, instNet: 50_000_000, instBuy: true,
      hotNet: 30_000_000, hotBuy: true, lhasaNet: 0,
    }).score
    expect(score).toBeGreaterThan(50)
  })

  it('拉萨系净买作为散户集中风险扣分', () => {
    const clean = scoreLadderFundFlow({ net: 20_000_000, instNet: 0, instBuy: false, hotNet: 0, hotBuy: false, lhasaNet: 0 })
    const lhasa = scoreLadderFundFlow({ net: 20_000_000, instNet: 0, instBuy: false, hotNet: 0, hotBuy: false, lhasaNet: 50_000_000 })
    expect(lhasa.score).toBeLessThan(clean.score ?? 0)
  })
})

describe('scoreDragonIdentity', () => {
  it('在题材内把更高板、更早封板且换手稳定的标的识别为更强核心', () => {
    const leader = stock({ code: '600001', consecutiveDays: 3, firstTime: '093100', turnoverRate: 14 })
    const follower = stock({ code: '600002', consecutiveDays: 1, firstTime: '101500', turnoverRate: 6 })
    const leaderScore = scoreDragonIdentity({
      stock: leader,
      theme: theme({ count: 8, promotionRate: 55 }),
      peers: [leader, follower],
      role: 'theme-leader',
      evidence: technical(),
      market: market(),
      turnover: scoreTurnoverCapacity({ turnoverRate: 14, amount: 5e8, circulatingMarketCap: 5e9, boards: 3, laneAmounts: [5e8, 5e8] }),
      followerCount: 4,
      onePrice: false,
    })
    const followerScore = scoreDragonIdentity({
      stock: follower,
      theme: theme({ count: 8, promotionRate: 55 }),
      peers: [leader, follower],
      role: 'follower',
      evidence: technical({ shape: 'high-new-high' }),
      market: market(),
      turnover: scoreTurnoverCapacity({ turnoverRate: 6, amount: 5e8, circulatingMarketCap: 5e9, boards: 1, laneAmounts: [5e8, 5e8] }),
      followerCount: 0,
      onePrice: false,
    })
    expect(leaderScore.score).toBeGreaterThan(followerScore.score)
    expect(leaderScore.dimensions.leadership.score).toBeGreaterThan(followerScore.dimensions.leadership.score)
  })

  it('缺少封板、K线和成交数据时明确标记数据不足', () => {
    const result = scoreDragonIdentity({
      stock: stock({ firstTime: '', amount: 0 }),
      theme: theme({ count: 0, score: 0 }),
      peers: [],
      role: 'follower',
      evidence: technical({ available: false, settled: false }),
      market: market(),
      turnover: scoreTurnoverCapacity({ turnoverRate: 0, amount: 0, circulatingMarketCap: null, boards: 1 }),
      followerCount: 0,
      onePrice: false,
    })
    expect(result.verdict).toBe('insufficient-data')
    expect(result.hardGate.passed).toBe(false)
    expect(result.hardGate.failed).toContain('带动性<40')
  })

  it('一字板不因龙头强度直接扣分，实际可交易性仍由独立评分处理', () => {
    const result = scoreDragonIdentity({
      stock: stock({ importedOnePrice: true }),
      theme: theme(),
      peers: [stock({ importedOnePrice: true })],
      role: 'theme-leader',
      evidence: technical({ onePrice: true }),
      market: market(),
      turnover: scoreTurnoverCapacity({ turnoverRate: 8, amount: 5e8, circulatingMarketCap: 5e9, boards: 1 }),
      followerCount: 2,
      onePrice: true,
    })
    expect(result.evidence.some((item) => item.includes('一字板不扣'))).toBe(true)
    expect(result.hardGate.failed).not.toContain('流动性<35')
  })
})

function stock(overrides: Partial<NormalizedStock> = {}): NormalizedStock {
  return {
    code: '600001',
    name: '测试股份',
    price: 11,
    changePct: 10,
    turnoverRate: 8,
    amount: 5e8,
    circulatingMarketCap: 5e9,
    firstTime: '094000',
    lastTime: '145000',
    openCount: 0,
    consecutiveDays: 1,
    industry: '机器人',
    nDayBoards: '首板',
    themes: ['机器人'],
    subtheme: '',
    importedRole: '',
    reason: '',
    reasonSource: 'none',
    sealAmount: null,
    importedOnePrice: null,
    patternHintAvailable: false,
    onePriceHint: false,
    tBoardHint: false,
    isMarginEligible: false,
    warnings: [],
    ...overrides,
  }
}

function market(overrides: Partial<MarketCycle> = {}): MarketCycle {
  return {
    phase: 'repair',
    score: 75,
    directionAvailable: true,
    reasons: ['修复'],
    current: {
      temperature: 55,
      limitUp: 60,
      limitDown: 10,
      breakRate: 20,
      promotionRate: 35,
      yestLimitPerf: 2,
      advance: 3000,
      decline: 1800,
      maxBoards: 4,
      ladderContinuity: 100,
    },
    ...overrides,
  }
}

function technical(overrides: Partial<TechnicalEvidence> = {}): TechnicalEvidence {
  return {
    available: true,
    settled: true,
    lastDate: '2026-08-11',
    barCount: 160,
    ma20: 10,
    ma60: 9.8,
    ma120: 9.5,
    ma120Rising: true,
    atr14Pct: 3,
    breakout20: true,
    breakout60: true,
    breakout120: false,
    breakoutLine20: 10.2,
    pre20RangePct: 12,
    amountRatio20: 2,
    amountRatioSource: 'amount',
    prePosition120Pct: 25,
    episodeOnsetDate: '2026-08-11',
    episodeReturnPct: 10,
    sessionsFromOnset: 0,
    recognitionLate: false,
    onePrice: false,
    shape: 'low-platform-breakout',
    platformEdge: 10.2,
    onsetLow: 9.9,
    ...overrides,
  }
}

function theme(overrides: Partial<ThemeAnalysis> = {}): ThemeAnalysis {
  return {
    name: '机器人',
    grade: 'A',
    score: 82,
    count: 5,
    firstBoardCount: 3,
    multiBoardCount: 2,
    maxBoards: 3,
    continuity: 100,
    promotionRate: 35,
    sealStability: 90,
    stockCodes: ['600001'],
    ...overrides,
  }
}

function flatBars(): KlineBar[] {
  const start = new Date('2026-03-01T00:00:00Z')
  return Array.from({ length: 141 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    const oldHigh = index === 10 ? 12 : 10.2
    const oldLow = index === 12 ? 9.5 : 9.9
    const last = index === 140
    return {
      date: date.toISOString().slice(0, 10),
      open: last ? 10.5 : 10,
      close: last ? 11 : 10,
      high: last ? 11 : oldHigh,
      low: last ? 10.4 : oldLow,
      volume: last ? 5000 : 1000,
      turnover: last ? 5e8 : 1e8,
      amplitude: last ? 6 : 3,
      changePct: last ? 10 : 0,
    }
  })
}

function nextDayCandidate() {
  return rankAndClassifyStocks({
    stocks: [stock({ consecutiveDays: 2 })],
    themes: [theme()],
    technical: new Map([['600001', technical()]]),
    market: market(),
    degraded: false,
  })[0]
}

function liveQuote(overrides: Partial<ScreenerLiveQuote> = {}): ScreenerLiveQuote {
  return {
    code: '600001',
    name: '测试股份',
    tradeDate: '2026-08-12',
    quoteTime: '09:35:00',
    capturedAt: '2026-08-12T01:35:01.000Z',
    source: 'tencent',
    price: 10.8,
    changePct: 8,
    open: 10.3,
    high: 10.9,
    low: 10.2,
    prevClose: 10,
    volume: 100_000,
    amount: 100_000_000,
    ...overrides,
  }
}

describe('limit ladder market cycle', () => {
  const base = market().current

  it('classifies ice, climax and ebb in priority order', () => {
    expect(classifyMarketCycle({ ...base, temperature: 30, maxBoards: 2, promotionRate: 10 }).phase).toBe('ice')
    expect(classifyMarketCycle({ ...base, temperature: 75, maxBoards: 5, promotionRate: 45, breakRate: 18 }).phase).toBe('climax')
    expect(
      classifyMarketCycle(
        { ...base, temperature: 55, breakRate: 42 },
        { phase: 'climax', current: { ...base, temperature: 75 } },
      ).phase,
    ).toBe('ebb')
  })

  it('marks direction unavailable without an archive', () => {
    expect(classifyMarketCycle(base).directionAvailable).toBe(false)
  })
})

describe('limit ladder theme and technical rules', () => {
  it('scores a broad continuous theme above an isolated theme', () => {
    const strong = [
      stock({ code: '600001', consecutiveDays: 1 }),
      stock({ code: '600002', consecutiveDays: 1 }),
      stock({ code: '600003', consecutiveDays: 2 }),
      stock({ code: '600004', consecutiveDays: 3 }),
      stock({ code: '600005', consecutiveDays: 4 }),
    ]
    const isolated = stock({ code: '600006', themes: ['医药'], industry: '医药' })
    const scored = scoreThemes([...strong, isolated], 40)
    expect(scored[0].name).toBe('机器人')
    expect(scored[0].grade).toBe('A')
    expect(scored.find((item) => item.name === '医药')?.grade).toBe('D')
  })

  it('requires a real high anchor and a continuous ladder for a complete theme', () => {
    const stocks = [
      stock({ code: '600001', consecutiveDays: 1 }),
      stock({ code: '600002', consecutiveDays: 1 }),
      stock({ code: '600003', consecutiveDays: 2 }),
      stock({ code: '600004', consecutiveDays: 3 }),
    ]
    expect(scoreThemes(stocks, 40)[0].complete).toBe(false)
    const anchor: ThemeAnchor = {
      code: '600099',
      name: '高位锚',
      themes: ['机器人'],
      source: 'recent-high-anchor',
      priorMaxBoards: 4,
      recentLimitUps: 3,
      distanceFromFiveDayHighPct: 4,
      active: true,
    }
    expect(scoreThemes(stocks, 40, [], [anchor])[0].complete).toBe(true)
  })

  it('isolates 20cm names from main-board theme and promotion-lane statistics', () => {
    const current = [
      stock({ code: '600001', consecutiveDays: 2 }),
      stock({ code: '300001', consecutiveDays: 2 }),
    ]
    const themes = scoreThemes(current, 40)
    expect(themes[0].count).toBe(1)
    const lanes = computePromotionLanes(
      current,
      themes,
      [
        { code: '600001', consecutiveDays: 1 },
        { code: '300001', consecutiveDays: 1 },
      ],
    )
    expect(lanes[0].promotionTotal).toBe(1)
    expect(lanes[0].promoted).toBe(1)
    expect(lanes[0].promotionRate).toBe(100)
  })

  it('selects the strongest supplied lane dynamically', () => {
    const stocks = [
      stock({ code: '600001', consecutiveDays: 1 }),
      stock({ code: '600002', consecutiveDays: 2 }),
      stock({ code: '600003', consecutiveDays: 2 }),
      stock({ code: '600004', consecutiveDays: 3 }),
    ]
    const themes = [theme({ stockCodes: stocks.map((item) => item.code) })]
    const lanes = computePromotionLanes(
      stocks,
      themes,
      [
        { code: '600001', consecutiveDays: 1 },
        { code: '600002', consecutiveDays: 1 },
        { code: '600003', consecutiveDays: 1 },
        { code: '600004', consecutiveDays: 2 },
      ],
    )
    expect(lanes.filter((lane) => lane.dominant)).toHaveLength(1)
    expect(lanes.find((lane) => lane.dominant)?.label).toBe('2进3')
  })

  it('scores the configured turnover sweet spot and reweights missing float cap', () => {
    const sweet = scoreTurnoverCapacity({
      turnoverRate: 15,
      amount: 5e8,
      circulatingMarketCap: 5e9,
      boards: 2,
      laneAmounts: [1e8, 5e8, 8e8],
    })
    const thin = scoreTurnoverCapacity({
      turnoverRate: 2,
      amount: 5e8,
      circulatingMarketCap: 5e9,
      boards: 2,
      laneAmounts: [1e8, 5e8, 8e8],
    })
    const missingCap = scoreTurnoverCapacity({
      turnoverRate: 15,
      amount: 5e8,
      circulatingMarketCap: null,
      boards: 2,
      laneAmounts: [1e8, 5e8, 8e8],
    })
    expect(sweet.score).toBeGreaterThan(thin.score)
    expect(missingCap.effectiveTurnoverPct).toBe(15)
    expect(missingCap.score).toBeGreaterThan(0)
  })

  it('classifies a low-position 60-day breakout from a tight platform', () => {
    const bars = flatBars()
    const asof = bars[bars.length - 1].date
    const result = analyzeTechnical(bars, '600001', asof)
    expect(result.settled).toBe(true)
    expect(result.breakout20).toBe(true)
    expect(result.breakout60).toBe(true)
    expect(result.amountRatio20).toBeGreaterThan(1.3)
    expect(result.shape).toBe('low-platform-breakout')
  })
})

describe('limit ladder state and import contract', () => {
  it('keeps a qualified first board as a next-day candidate', () => {
    const result = rankAndClassifyStocks({
      stocks: [stock()],
      themes: [theme()],
      technical: new Map([['600001', technical()]]),
      market: market(),
      degraded: false,
    })
    expect(result[0].state).toBe('observe')
  })

  it('caps one-price and four-board names at waiting', () => {
    const onePrice = rankAndClassifyStocks({
      stocks: [stock({ importedOnePrice: true })],
      themes: [theme()],
      technical: new Map([['600001', technical({ onePrice: true })]]),
      market: market(),
      degraded: false,
    })[0]
    const highBoard = rankAndClassifyStocks({
      stocks: [stock({ consecutiveDays: 4 })],
      themes: [theme({ maxBoards: 4 })],
      technical: new Map([['600001', technical()]]),
      market: market(),
      degraded: false,
    })[0]
    expect(onePrice.state).toBe('observe')
    expect(highBoard.state).toBe('observe')
  })

  it('applies opposite one-price effects to promotion and tradability', () => {
    const plain = rankAndClassifyStocks({
      stocks: [stock()],
      themes: [theme()],
      technical: new Map([['600001', technical()]]),
      market: market(),
      degraded: false,
    })[0]
    const onePrice = rankAndClassifyStocks({
      stocks: [stock({ importedOnePrice: true })],
      themes: [theme()],
      technical: new Map([['600001', technical({ onePrice: true, onePriceStreak: 2 })]]),
      market: market(),
      degraded: false,
    })[0]
    expect(onePrice.promotionScore).toBeGreaterThan(plain.promotionScore ?? 0)
    expect(onePrice.tradabilityScore).toBeLessThan((plain.tradabilityScore ?? 0) - 20)
  })

  it('caps formal candidates per lane, per theme, and overall', () => {
    const stocks = Array.from({ length: 14 }, (_, index) =>
      stock({
        code: `600${String(index + 1).padStart(3, '0')}`,
        name: `候选${index + 1}`,
        consecutiveDays: (index % 3) + 1,
        themes: [`题材${index % 7}`],
        industry: `题材${index % 7}`,
      }),
    )
    const themes = Array.from({ length: 7 }, (_, index) =>
      theme({
        name: `题材${index}`,
        stockCodes: stocks
          .filter((item) => item.themes.includes(`题材${index}`))
          .map((item) => item.code),
      }),
    )
    const technicals = new Map(stocks.map((item) => [item.code, technical()]))
    const result = rankAndClassifyStocks({
      stocks,
      themes,
      technical: technicals,
      market: market(),
      degraded: false,
    })
    const candidates = result.filter((item) => item.state === 'candidate')
    expect(candidates.length).toBeLessThanOrEqual(10)
    for (const lane of new Set(candidates.map((item) => item.promotionLane))) {
      expect(candidates.filter((item) => item.promotionLane === lane).length).toBeLessThanOrEqual(3)
    }
    for (const candidateTheme of new Set(candidates.map((item) => item.primaryTheme))) {
      expect(candidates.filter((item) => item.primaryTheme === candidateTheme).length).toBeLessThanOrEqual(2)
    }
  })

  it('deduplicates imported codes and merges themes', () => {
    const result = normalizeLadderImport({
      asof: '2026-08-11',
      stocks: [
        { code: '1', name: '测试股份', themes: ['机器人'] },
        { code: '000001', themes: ['人工智能'], role: '题材龙' },
      ],
    })
    expect(result.stocks).toHaveLength(1)
    expect(result.stocks[0].code).toBe('000001')
    expect(result.stocks[0].themes).toEqual(['机器人', '人工智能'])
    expect(result.stocks[0].role).toBe('题材龙')
  })
})

describe('limit ladder next-day confirmation', () => {
  it('does not confirm a final auction low/flat-open unless 09:35 turns red with volume-price support', () => {
    const candidate = nextDayCandidate()
    const lowAuction = liveQuote({
      quoteTime: '09:25:05',
      indicativePrice: 9.8,
      price: 9.8,
      changePct: -2,
      high: 9.8,
      low: 9.8,
      open: 0,
      amount: 30_000_000,
    })
    const weakOpen = liveQuote({
      quoteTime: '09:35:00',
      price: 9.75,
      open: 9.8,
      high: 9.85,
      low: 9.7,
      changePct: -2.5,
    })
    const weak = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 35,
      quotes: new Map([[candidate.code, weakOpen]]),
      auctionQuotes: { [candidate.code]: lowAuction },
    })
    expect(isOpeningDirectPullUp(weakOpen)).toBe(false)
    expect(weak.candidates[0].openingConfirmationGate).toBe('blocked')
    expect(weak.candidates[0].state).toBe('waiting')
    expect(weak.candidates[0].gateReasons?.join('')).toContain('竞价低开')

    const directOpen = liveQuote({
      quoteTime: '09:35:00',
      price: 10.08,
      open: 9.8,
      high: 10.1,
      low: 9.78,
      changePct: 0.8,
      volume: 110_000,
    })
    const direct = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 35,
      quotes: new Map([[candidate.code, directOpen]]),
      auctionQuotes: { [candidate.code]: lowAuction },
    })
    expect(isOpeningDirectPullUp(directOpen)).toBe(true)
    expect(isOpeningVolumePriceRebound(directOpen)).toBe(true)
    expect(isOpeningDirectPullUp({ ...directOpen, quoteTime: '09:34:57' })).toBe(true)
    expect(direct.candidates[0].openingConfirmationGate).toBe('passed')
    expect(direct.candidates[0].state).toBe('confirmed')

    const lateOpen = { ...directOpen, quoteTime: '09:36:00' }
    expect(isOpeningDirectPullUp(lateOpen)).toBe(false)
  })

  it('keeps a flat auction in waiting and deducts the opening penalty', () => {
    const candidate = nextDayCandidate()
    const flatAuction = liveQuote({
      quoteTime: '09:25:05',
      indicativePrice: 10.02,
      price: 10.02,
      changePct: 0.2,
      high: 10.02,
      low: 10.02,
      open: 0,
    })
    const weakOpen = liveQuote({
      quoteTime: '09:35:00',
      price: 9.98,
      open: 10,
      high: 10.02,
      low: 9.95,
      changePct: -0.2,
    })
    const result = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 35,
      quotes: new Map([[candidate.code, weakOpen]]),
      auctionQuotes: { [candidate.code]: flatAuction },
    })
    expect(result.candidates[0].openingConfirmationGate).toBe('blocked')
    expect(result.candidates[0].openingGapAdjustment).toBe(-6)
    expect(result.candidates[0].state).toBe('waiting')

    const auctionStage = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 25,
      quotes: new Map([[candidate.code, flatAuction]]),
      auctionQuotes: { [candidate.code]: flatAuction },
    })
    expect(auctionStage.candidates[0].openingConfirmationGate).toBe('blocked')
    expect(auctionStage.candidates[0].state).toBe('waiting')
  })

  it('adds a tail-buy bonus but still requires opening volume-price rebound', () => {
    const candidate = nextDayCandidate()
    const tailAuction = liveQuote({
      quoteTime: '09:24:57',
      indicativePrice: 9.9,
      price: 9.9,
      changePct: -1,
      high: 9.9,
      low: 9.9,
      open: 0,
      unmatchedSide: 'buy',
      unmatchedAmount: 2_000_000,
    })
    const reboundOpen = liveQuote({
      quoteTime: '09:35:00',
      price: 10.08,
      open: 9.8,
      high: 10.1,
      low: 9.78,
      changePct: 0.8,
      volume: 110_000,
    })
    const process = {
      code: candidate.code,
      sampleCount: 3,
      strengtheningScore: 65,
      cancellationStabilityScore: 70,
      processScore: 67,
      startGapPct: -1.5,
      finalGapPct: -1,
      finalUnmatchedSide: 'buy' as const,
    }
    expect(isAuctionTailBuy(tailAuction, process)).toBe(true)
    const result = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 35,
      quotes: new Map([[candidate.code, reboundOpen]]),
      auctionQuotes: { [candidate.code]: tailAuction },
      auctionContext: {
        capturedAt: '2026-08-12T01:25:00.000Z',
        snapshotCount: 3,
        coverage: 100,
        lowConfidence: false,
        sources: ['test'],
        marketStyle: null,
        topAmount: [],
        themes: [],
        candidateProcesses: [process],
        warnings: [],
      },
    })
    expect(result.candidates[0].auctionTailBuyConfirmed).toBe(true)
    expect(result.candidates[0].auctionTailBonus).toBe(3)
    expect(result.candidates[0].openingConfirmationGate).toBe('passed')
  })

  it('moves from auction-qualified to confirmed using separate 9:25 and 9:35 data', () => {
    const candidate = nextDayCandidate()
    const auctionQuote = liveQuote({
      quoteTime: '09:25:05',
      price: 10.3,
      changePct: 3,
      high: 10.3,
      low: 10.2,
      amount: 30_000_000,
    })
    const auction = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 25,
      quotes: new Map([[candidate.code, auctionQuote]]),
      auctionQuotes: { [candidate.code]: auctionQuote },
    })
    expect(auction.stage).toBe('auction')
    expect(auction.candidates[0].state).toBe('auction-qualified')

    const open = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 35,
      quotes: new Map([[candidate.code, liveQuote()]]),
      auctionQuotes: { [candidate.code]: auctionQuote },
    })
    expect(open.stage).toBe('open')
    expect(open.candidates[0].openScore).toBeGreaterThanOrEqual(60)
    expect(open.candidates[0].liveScore).toBeGreaterThanOrEqual(70)
    expect(open.candidates[0].state).toBe('confirmed')
  })

  it('caps confirmation when high-board panic is not offset by a theme high-low switch', () => {
    const candidate = nextDayCandidate()
    candidate.roleProfile = {
      code: candidate.code,
      name: candidate.name,
      primaryTheme: candidate.primaryTheme,
      themes: candidate.themes,
      boards: candidate.consecutiveDays,
      marketRole: 'normal',
      themeRole: 'core-assistant',
      heightTier: 'middle',
      lifecycle: 'consensus',
      onePrice: false,
      positionDelta: 2,
      peerCodes: [],
      leadingDays: 0,
      cardedCodes: [],
      wasCardedBy: [],
      followerCount: 2,
      confidence: 80,
      evidence: [],
    }
    const highBoardContext: HighBoardRiskContext = {
      capturedAt: '2026-08-12T01:35:00.000Z',
      phase: 'open',
      score: 20,
      state: 'panic',
      confidence: 80,
      metrics: {
        sampleSize: 5,
        positiveRate: 0,
        nuclearRate: 60,
        onePriceRetentionRate: 0,
        weightedGapPct: -6,
        processStrength: 20,
        vwapHoldRate: 0,
        waterfallRate: 60,
        resealRate: 0,
      },
      members: [],
      themes: [
        {
          theme: candidate.primaryTheme,
          score: 35,
          state: 'contraction',
          confidence: 50,
          sampleSize: 2,
          highLowSwitch: false,
        },
      ],
      warnings: [],
    }
    const result = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 35,
      quotes: new Map([[candidate.code, liveQuote()]]),
      highBoardContext,
    })
    expect(result.candidates[0].state).toBe('waiting')
    expect(result.candidates[0].gateReasons?.join('')).toContain('高标恐慌')
  })

  it('does not let a high individual score override a restricted high-beta market gate', () => {
    const candidate = nextDayCandidate()
    candidate.primaryTheme = '芯片'
    candidate.themes = ['芯片']
    const marketGate: MarketRiskGate = {
      signalDate: '2026-08-11',
      tradeDate: '2026-08-12',
      generatedAt: '2026-08-12T01:25:00.000Z',
      phase: 'auction',
      state: 'restricted',
      riskScore: 72,
      externalRiskScore: 80,
      domesticRiskScore: 68,
      domesticConfirmed: true,
      premarket: null,
      domestic: null,
      themePermissions: [
        {
          theme: '芯片',
          riskClass: 'high-beta',
          state: 'blocked',
          score: 40,
          independentStrength: false,
          directionScore: 40,
          positiveRate: 30,
          assistantCount: 0,
          environmentAdjustment: -8,
          reasons: ['高Beta/利率敏感题材', '上层市场闸门禁止执行'],
        },
      ],
      reasons: ['外盘风险已被A股竞价负反馈确认'],
      warnings: [],
    }
    const result = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 35,
      quotes: new Map([[candidate.code, liveQuote()]]),
      marketGate,
    })

    expect(result.candidates[0].liveScore).toBeGreaterThanOrEqual(70)
    expect(result.candidates[0].state).toBe('blocked')
    expect(result.candidates[0].decisionScore).toBeLessThan(
      result.candidates[0].liveScore ?? 0,
    )
    expect(result.candidates[0].gateReasons?.join('')).toContain('高Beta')
  })

  it('keeps a high-scoring relay candidate waiting until core leadership and assistant breadth are both confirmed', () => {
    const candidate = nextDayCandidate()
    const marketGate: MarketRiskGate = {
      signalDate: '2026-08-11',
      tradeDate: '2026-08-12',
      generatedAt: '2026-08-12T01:25:00.000Z',
      phase: 'open',
      state: 'normal',
      riskScore: 20,
      externalRiskScore: 20,
      domesticRiskScore: 20,
      domesticConfirmed: true,
      premarket: null,
      domestic: null,
      themePermissions: [
        {
          theme: candidate.primaryTheme,
          riskClass: 'neutral',
          state: 'allowed',
          score: 66,
          independentStrength: false,
          directionScore: 66,
          positiveRate: 55,
          assistantCount: 1,
          environmentAdjustment: 0,
          reasons: [],
        },
      ],
      reasons: [],
      warnings: [],
    }
    const result = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 35,
      quotes: new Map([[candidate.code, liveQuote()]]),
      marketGate,
    })

    expect(result.candidates[0].liveScore).toBeGreaterThanOrEqual(70)
    expect(result.candidates[0].state).toBe('waiting')
    expect(result.candidates[0].gateReasons?.join('')).toContain('核心带动')
  })

  it('rejects stale quotes and continued one-price boards', () => {
    const candidate = nextDayCandidate()
    const stale = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 35,
      quotes: new Map([[candidate.code, liveQuote({ quoteTime: '09:25:00' })]]),
    })
    expect(stale.candidates[0].state).toBe('rejected')
    expect(stale.candidates[0].warnings[0]).toContain('时间未到确认节点')

    const tooLate = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 10 * 60,
      quotes: new Map([[candidate.code, liveQuote({ quoteTime: '10:00:00' })]]),
    })
    expect(tooLate.candidates[0].state).toBe('rejected')

    const onePrice = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 35,
      quotes: new Map([
        [
          candidate.code,
          liveQuote({
            price: 11,
            open: 11,
            high: 11,
            low: 11,
            changePct: 10,
          }),
        ],
      ]),
    })
    expect(onePrice.candidates[0].state).toBe('rejected')
    expect(onePrice.candidates[0].inaccessible).toBe(true)
    expect(onePrice.candidates[0].warnings).toContain('次日继续一字，不可达')
  })

  it('reweights the live score when the 9:25 snapshot is missing', () => {
    const candidate = nextDayCandidate()
    const result = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 35,
      quotes: new Map([[candidate.code, liveQuote()]]),
      auctionQuotes: null,
    })
    expect(result.auctionSnapshotAvailable).toBe(false)
    expect(result.warnings.join('')).toContain('竞价快照缺失')
    expect(result.candidates[0].auctionScore).toBeNull()
    expect(result.candidates[0].liveScore).not.toBeNull()
    expect(result.candidates[0].auctionAmount).toBeNull()
  })

  it('settles from frozen snapshots without dropping scores or confirmation state', () => {
    const candidate = nextDayCandidate()
    const auctionQuote = liveQuote({
      quoteTime: '09:25:05',
      price: 10.3,
      changePct: 3,
      high: 10.3,
      low: 10.2,
      amount: 30_000_000,
    })
    const finalSnapshot = {
      capturedAt: '2026-08-12T01:25:05.000Z',
      clockTime: '09:25:05',
      quotes: { [candidate.code]: auctionQuote },
      market: { topAmount: [], topGainers: [] },
      sources: ['tencent'],
      coverage: 100,
      warnings: [],
    } satisfies AuctionProcessArchive['finalSnapshot'] & object
    const result = settleNextDayFromSnapshots({
      signalDate: '2026-08-11',
      tradeDate: '2026-08-12',
      baseRows: [candidate],
      process: {
        signalDate: '2026-08-11',
        tradeDate: '2026-08-12',
        generatedAt: finalSnapshot.capturedAt,
        ruleVersion: 'limit-ladder-v3',
        snapshots: [finalSnapshot],
        finalSnapshot,
      },
      confirmation: {
        signalDate: '2026-08-11',
        tradeDate: '2026-08-12',
        capturedAt: '2026-08-12T01:35:01.000Z',
        ruleVersion: 'limit-ladder-v3',
        quotes: { [candidate.code]: liveQuote() },
      },
    })

    expect(result.stage).toBe('settled')
    expect(result.auctionSnapshotAvailable).toBe(true)
    expect(result.confirmationSnapshotAvailable).toBe(true)
    expect(result.candidates[0].auctionScore).not.toBeNull()
    expect(result.candidates[0].openScore).not.toBeNull()
    expect(result.candidates[0].liveScore).not.toBeNull()
    expect(result.candidates[0].state).not.toBe('pending')
  })

  it('keeps the auction conclusion when the 9:35 snapshot is missing', () => {
    const candidate = nextDayCandidate()
    const auctionQuote = liveQuote({
      quoteTime: '09:25:05',
      price: 10.3,
      changePct: 3,
      high: 10.3,
      low: 10.2,
      amount: 30_000_000,
    })
    const finalSnapshot = {
      capturedAt: '2026-08-12T01:25:05.000Z',
      clockTime: '09:25:05',
      quotes: { [candidate.code]: auctionQuote },
      market: { topAmount: [], topGainers: [] },
      sources: ['tencent'],
      coverage: 100,
      warnings: [],
    }
    const result = settleNextDayFromSnapshots({
      signalDate: '2026-08-11',
      tradeDate: '2026-08-12',
      baseRows: [candidate],
      process: {
        signalDate: '2026-08-11',
        tradeDate: '2026-08-12',
        generatedAt: finalSnapshot.capturedAt,
        ruleVersion: 'limit-ladder-v3',
        snapshots: [finalSnapshot],
        finalSnapshot,
      },
    })

    expect(result.candidates[0].auctionScore).not.toBeNull()
    expect(result.candidates[0].openScore).toBeNull()
    expect(result.candidates[0].state).not.toBe('pending')
    expect(result.warnings.join('')).toContain('9:35确认快照缺失')
  })
})

describe('limit ladder v3 auction context', () => {
  it('keeps a sub-five cross section neutral instead of awarding a singleton 100', () => {
    expect(crossSectionPercentile(10, [10])).toBe(50)
    expect(crossSectionPercentile(10, [5, 10, 20, 30])).toBe(50)
    expect(crossSectionPercentile(50, [10, 20, 30, 40, 50])).toBe(100)
  })

  it('labels concentrated large-cap technology turnover as style evidence', () => {
    const rows: AuctionMarketStock[] = Array.from({ length: 5 }, (_, index) => ({
      code: `60000${index + 1}`,
      name: `科技${index + 1}`,
      industry: '半导体',
      style: 'technology',
      price: 10,
      changePct: 2,
      amount: 1e9 - index * 1e8,
      marketCap: 100e9,
      tradeDate: '2026-08-12',
      quoteTime: '09:25:00',
      source: 'eastmoney',
    }))
    const result = classifyAuctionMarket(rows)
    expect(result?.label).toBe('权重科技回流')
    expect(result?.topFiveConcentrationPct).toBe(100)
    expect(result?.score).toBeLessThanOrEqual(100)
  })

  it('requires a one-price core plus two positive assistants before marking theme leadership', () => {
    const leader = nextDayCandidate()
    const assistantA = {
      ...leader,
      code: '600002',
      name: '助攻甲',
      consecutiveDays: 1,
      promotionLane: '1进2',
    }
    const assistantB = {
      ...leader,
      code: '600003',
      name: '助攻乙',
      consecutiveDays: 1,
      promotionLane: '1进2',
    }
    const at = (
      clockTime: string,
      leaderGap: number,
      unmatchedAmount: number,
      includeAssistants = false,
    ) => ({
      capturedAt: `2026-08-12T${clockTime}+08:00`,
      clockTime,
      quotes: {
        [leader.code]: liveQuote({
          quoteTime: clockTime,
          price: 10 * (1 + leaderGap / 100),
          changePct: leaderGap,
          indicativePrice: 10 * (1 + leaderGap / 100),
          unmatchedSide: 'buy',
          unmatchedAmount,
        }),
        ...(includeAssistants
          ? {
              [assistantA.code]: liveQuote({
                code: assistantA.code,
                name: assistantA.name,
                quoteTime: clockTime,
                price: 10.2,
                changePct: 2,
              }),
              [assistantB.code]: liveQuote({
                code: assistantB.code,
                name: assistantB.name,
                quoteTime: clockTime,
                price: 10.3,
                changePct: 3,
              }),
            }
          : {}),
      },
      market: { topAmount: [], topGainers: [] },
      sources: ['sina'],
      coverage: includeAssistants ? 100 : 33.33,
      warnings: [],
    })
    const snapshots = [
      at('09:15:00', 4, 100e6),
      at('09:20:00', 3, 80e6),
      at('09:25:00', 10, 90e6, true),
    ]
    const process: AuctionProcessArchive = {
      signalDate: '2026-08-11',
      tradeDate: '2026-08-12',
      generatedAt: '2026-08-12T09:25:00+08:00',
      ruleVersion: 'limit-ladder-v3',
      snapshots,
      finalSnapshot: snapshots[2],
    }
    const context = buildAuctionContext({
      process,
      analysisRows: [leader, assistantA, assistantB],
      formalRows: [leader],
    })
    expect(context?.themes[0].state).toBe('leading')
    expect(context?.themes[0].assistantCount).toBe(2)
    expect(context?.candidateProcesses[0].strengtheningScore).toBeGreaterThan(50)
    expect(context?.candidateProcesses[0].cancellationStabilityScore).toBe(80)
  })

  it('caps an isolated one-price core instead of treating it as a leading theme', () => {
    const leader = nextDayCandidate()
    const snapshot = {
      capturedAt: '2026-08-12T09:25:00+08:00',
      clockTime: '09:25:00',
      quotes: {
        [leader.code]: liveQuote({
          quoteTime: '09:25:00',
          price: 11,
          changePct: 10,
          indicativePrice: 11,
        }),
      },
      market: { topAmount: [], topGainers: [] },
      sources: ['tencent'],
      coverage: 100,
      warnings: [],
    }
    const context = buildAuctionContext({
      process: {
        signalDate: '2026-08-11',
        tradeDate: '2026-08-12',
        generatedAt: snapshot.capturedAt,
        ruleVersion: 'limit-ladder-v3',
        snapshots: [snapshot],
        finalSnapshot: snapshot,
      },
      analysisRows: [leader],
      formalRows: [leader],
    })
    expect(context?.themes[0].state).toBe('isolated-one-price')
    expect(context?.themes[0].score).toBeLessThanOrEqual(60)
  })

  it('does not count lane amount percentile twice inside turnover capacity', () => {
    const lowRank = scoreTurnoverCapacity({
      turnoverRate: 15,
      amount: 5e8,
      circulatingMarketCap: 5e9,
      boards: 2,
      laneAmounts: [5e8, 6e8, 7e8, 8e8, 9e8],
    })
    const highRank = scoreTurnoverCapacity({
      turnoverRate: 15,
      amount: 5e8,
      circulatingMarketCap: 5e9,
      boards: 2,
      laneAmounts: [1e8, 2e8, 3e8, 4e8, 5e8],
    })
    expect(lowRank.amountPercentile).toBeLessThan(highRank.amountPercentile)
    expect(lowRank.score).toBe(highRank.score)
  })
})

describe('limit ladder v3 outcome summary', () => {
  const outcome = (
    code: string,
    population: LadderOutcomeRow['population'],
    fromBoards: number,
    resultStatus: LadderOutcomeRow['resultStatus'],
  ): LadderOutcomeRow => ({
    code,
    name: code,
    candidateRank: population === 'formal' ? 1 : null,
    population,
    promotionLane: `${fromBoards}进${fromBoards + 1}`,
    fromBoards,
    targetBoards: fromBoards + 1,
    resultStatus,
    promoted: resultStatus === 'unresolved' ? null : resultStatus === 'promoted',
    tradable: resultStatus === 'unresolved' ? null : true,
    unresolvedReason: resultStatus === 'unresolved' ? 'missing' : '',
    openToClosePct: null,
    mfePct: null,
    maePct: null,
  })

  it('combines all formal lanes while excluding one-price monitors and unresolved rows', () => {
    const summary = buildOutcomeSummary([
      outcome('600001', 'formal', 1, 'promoted'),
      outcome('600002', 'formal', 2, 'failed'),
      outcome('600003', 'formal', 3, 'unresolved'),
      outcome('600004', 'wait-open', 2, 'promoted'),
    ])
    expect(summary.formal).toMatchObject({
      total: 3,
      valid: 2,
      promoted: 1,
      unresolved: 1,
      promotionRate: 50,
    })
    expect(summary.byLane).toHaveLength(3)
    expect(summary.waitOpen.promotionRate).toBe(100)
  })

  it('returns null rather than zero when there is no valid formal outcome', () => {
    const summary = buildOutcomeSummary([
      outcome('600001', 'formal', 1, 'unresolved'),
    ])
    expect(summary.formal.promotionRate).toBeNull()
    expect(summary.formal.coverage).toBe(0)
  })
})

describe('next-day relay research plan', () => {
  const relayStock = (overrides: Record<string, unknown>): LadderStockAnalysis => ({
    ...stock(),
    rank: 1,
    boardType: 'main',
    primaryTheme: '医药',
    themeGrade: 'A',
    themeScore: 80,
    role: 'first-pioneer',
    state: 'candidate',
    score: 80,
    promotionScore: 80,
    tradabilityScore: 80,
    baseScore: 80,
    technical: technical(),
    mainRisk: '研究数据待确认',
    ...overrides,
  } as unknown as LadderStockAnalysis)
  it('keeps a one-price high board as an emotion anchor and upgrades 双鹭 to a medical core observer', () => {
    const formal = relayStock({
      code: '600001',
      name: '医药二板候选',
      consecutiveDays: 2,
      primaryTheme: '医药',
      themes: ['医药'],
      role: 'first-pioneer',
      state: 'candidate',
      promotionLane: '2进3',
      technical: technical(),
    })
    const anchor = relayStock({
      code: '600010',
      name: '汉森制药',
      consecutiveDays: 3,
      primaryTheme: '医药',
      themes: ['医药'],
      role: 'space-leader',
      state: 'exclude',
      onePrice: true,
      promotionLane: '3进4',
    })
    const doubleEgret = relayStock({
      code: '002038',
      name: '双鹭药业',
      consecutiveDays: 2,
      primaryTheme: '疫苗概念',
      themes: ['疫苗概念'],
      role: 'theme-leader',
      state: 'observe',
      promotionLane: '2进3',
      technical: technical(),
    })
    const plan = buildNextDayRelayPlan({
      signalDate: '2026-08-21',
      tradeDate: '2026-08-24',
      stage: 'pending',
      rows: [formal, anchor, doubleEgret],
      formalRows: [formal],
    })
    const anchorItem = plan.items.find((item) => item.code === anchor.code)
    const doubleEgretItem = plan.items.find((item) => item.code === doubleEgret.code)
    expect(anchorItem?.relayRole).toBe('emotion-anchor')
    expect(anchorItem?.executionEligible).toBe(false)
    expect(doubleEgretItem?.relayRole).toBe('theme-core-observer')
    expect(doubleEgretItem?.researchTheme).toBe('医药')
    expect(doubleEgretItem?.primaryTheme).toBe('疫苗概念')
    expect(doubleEgretItem && 'emotionFeedback' in doubleEgretItem).toBe(false)
    expect(doubleEgretItem?.themeFeedback.status).toBe('unavailable')
    expect(doubleEgretItem?.sameLevelFeedback.status).toBe('unavailable')
  })

  it('refreshes theme and same-level feedback only from the current trade date', () => {
    const candidate = relayStock({
      code: '600001',
      name: '医药二板候选',
      consecutiveDays: 2,
      primaryTheme: '医药',
      themes: ['医药'],
      role: 'first-pioneer',
      state: 'candidate',
      promotionLane: '2进3',
      technical: technical(),
    })
    const peer = relayStock({
      code: '600002',
      name: '医药同身位',
      consecutiveDays: 2,
      primaryTheme: '医药',
      themes: ['医药'],
      role: 'first-pioneer',
      state: 'candidate',
      promotionLane: '2进3',
      technical: technical(),
    })
    const additionalPeers = Array.from({ length: 4 }, (_, index) => relayStock({
      code: '60000' + (3 + index),
      name: '医药同身位' + (index + 2),
      consecutiveDays: 2,
      primaryTheme: '医药',
      themes: ['医药'],
      role: 'first-pioneer',
      state: 'candidate',
      promotionLane: '2进3',
      technical: technical(),
    }))
    const quoteRows = [candidate, peer, ...additionalPeers]
    const quotes = new Map(
      quoteRows.map((row, index) => [
        row.code,
        liveQuote({ code: row.code, name: row.name, tradeDate: '2026-08-24', changePct: 7 - index }),
      ]),
    )
    const plan = buildNextDayRelayPlan({
      signalDate: '2026-08-21',
      tradeDate: '2026-08-24',
      stage: 'auction',
      rows: quoteRows,
      formalRows: [candidate, peer],
      quotes,
      auctionContext: {
        themes: [{
          theme: '医药',
          score: 78,
          state: 'resonant',
          positiveRate: 80,
          weightedGapPct: 3,
          amountSharePct: 20,
          coreCode: candidate.code,
          coreName: candidate.name,
          coreOnePrice: false,
          assistantCodes: [peer.code],
          assistantCount: 1,
          coverage: 100,
        }],
        warnings: [],
      } as unknown as LadderAuctionContext,
      confirmations: new Map([
        [candidate.code, { state: 'confirmed', inaccessible: false } as NextDayCandidateConfirmation],
      ]),
    })
    const item = plan.items.find((entry) => entry.code === candidate.code)
    expect(item?.themeFeedback.status).toBe('supportive')
    expect(item?.sameLevelFeedback.status).toBe('supportive')
    expect(item?.sameLevelFeedback.metrics.candidateRelativeRank).toBe(1)
    expect(item?.executionEligible).toBe(false)
    expect(item?.executionGateReasons.join('；')).not.toContain('情绪高标')
    expect(item?.executionGateReasons.join('；')).toContain('缺少市场闸门状态')
    expect(item?.themeFeedback.tradeDate).toBe('2026-08-24')
  })
})
