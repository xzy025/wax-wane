import { describe, expect, it } from 'vitest'
import {
  analyzeTechnical,
  classifyMarketCycle,
  isLadderSettledWindow,
  normalizeLadderImport,
  rankAndClassifyStocks,
  scoreLadderFundFlow,
  scoreThemes,
  type MarketCycle,
  type NormalizedStock,
  type TechnicalEvidence,
  type ThemeAnalysis,
} from './limitLadder'
import type { KlineBar } from './ashare'

describe('isLadderSettledWindow', () => {
  it('只在工作日15:00以后允许生成定盘快照', () => {
    expect(isLadderSettledWindow({ day: 2, minutes: 14 * 60 + 59 })).toBe(false)
    expect(isLadderSettledWindow({ day: 2, minutes: 15 * 60 })).toBe(true)
    expect(isLadderSettledWindow({ day: 6, minutes: 16 * 60 })).toBe(false)
  })
})

describe('scoreLadderFundFlow', () => {
  it('机构和知名游资净买加分，缺失保持中性', () => {
    expect(scoreLadderFundFlow().score).toBe(50)
    const score = scoreLadderFundFlow({
      net: 80_000_000, instNet: 50_000_000, instBuy: true,
      hotNet: 30_000_000, hotBuy: true, lhasaNet: 0,
    }).score
    expect(score).toBeGreaterThan(50)
  })

  it('拉萨系净买作为散户集中风险扣分', () => {
    const clean = scoreLadderFundFlow({ net: 20_000_000, instNet: 0, instBuy: false, hotNet: 0, hotBuy: false, lhasaNet: 0 })
    const lhasa = scoreLadderFundFlow({ net: 20_000_000, instNet: 0, instBuy: false, hotNet: 0, hotBuy: false, lhasaNet: 50_000_000 })
    expect(lhasa.score).toBeLessThan(clean.score)
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
    expect(result[0].state).toBe('candidate')
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
    expect(onePrice.state).toBe('waiting')
    expect(highBoard.state).toBe('waiting')
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
