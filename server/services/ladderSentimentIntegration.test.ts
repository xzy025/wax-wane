import { describe, expect, it } from 'vitest'
import {
  rankAndClassifyStocks,
  scoreNextDayConfirmations,
  type MarketCycle,
  type NormalizedStock,
  type TechnicalEvidence,
} from './limitLadder'
import { buildLadderSentimentQuantSnapshot } from './ladderSentimentQuant'
import type { ScreenerLiveQuote } from './screenerScan'

const stock = (): NormalizedStock => ({
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
  consecutiveDays: 2,
  industry: '机器人',
  nDayBoards: '2连板',
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
})

const technical = (): TechnicalEvidence => ({
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
})

const market = (): MarketCycle => ({
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
})

const quote = (): ScreenerLiveQuote => ({
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
})

function jointClimaxSnapshot() {
  const previousFirstBoards = Array.from({ length: 5 }, (_, index) => ({
    code: `first-${index}`,
    changePct: 1,
  }))
  const previousLadderBoards = Array.from({ length: 5 }, (_, index) => ({
    code: `relay-${index}`,
    changePct: 1,
    isLimitUp: true,
  }))
  const currentMarks = Object.fromEntries(
    [...previousFirstBoards, ...previousLadderBoards].map((row) => [row.code, row]),
  )
  return buildLadderSentimentQuantSnapshot({
    asof: '2026-08-11',
    market: {
      limitUpCount: 40,
      ladderCount: 12,
      previousLadderCount: 10,
      down5Count: 80,
      advanceCount: 250,
      declineCount: 200,
      flatCount: 50,
    },
    previousFirstBoards,
    previousLadderBoards,
    currentMarks,
    crowding: null,
    source: 'test',
  })
}

describe('ladder expectation and dual-climax integration', () => {
  it('blocks confirmation and execution when B=12 and M=10', () => {
    const candidate = rankAndClassifyStocks({
      stocks: [stock()],
      themes: [{
        name: '机器人', grade: 'A', score: 82, count: 5, firstBoardCount: 3,
        multiBoardCount: 2, maxBoards: 3, continuity: 80, promotionRate: 60, sealStability: 80,
        stockCodes: ['600001'],
      }],
      technical: new Map([['600001', technical()]]),
      market: market(),
      degraded: false,
    })[0]
    const sentimentQuant = jointClimaxSnapshot()
    expect(sentimentQuant).toMatchObject({ B: 12, M: 10, C: 22, gateState: 'JOINT_CLIMAX', noNewRelay: true })

    const result = scoreNextDayConfirmations({
      baseRows: [candidate],
      tradeDate: '2026-08-12',
      clockMinutes: 9 * 60 + 35,
      quotes: new Map([[candidate.code, quote()]]),
      auctionQuotes: { [candidate.code]: quote() },
      sentimentQuant,
    })

    expect(result.candidates[0].state).toBe('blocked')
    expect(result.candidates[0].executionEligible).toBe(false)
    expect(result.candidates[0].gateReasons?.join('')).toContain('NO_NEW_RELAY')
  })
})
