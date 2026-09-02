import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  auctionBriefPhaseForMinutes,
  buildAuctionBrief,
  generateAndDispatchAuctionBrief,
  readAuctionBriefState,
  renderAuctionBrief,
  sendNotificationWithRetry,
  type NotificationProvider,
} from './auctionBrief'
import type {
  LadderAuctionContext,
  LadderStockAnalysis,
  LimitLadderAnalysis,
  LimitLadderNextDay,
  NextDayCandidateConfirmation,
} from './limitLadder'

const originalEnv = {
  archiveRoot: process.env.LADDER_ARCHIVE_ROOT,
  pushEnabled: process.env.AUCTION_PUSH_ENABLED,
  aiEnabled: process.env.AUCTION_BRIEF_AI_ENABLED,
  sendKey: process.env.SERVERCHAN_SEND_KEY,
}
let archiveRoot = ''

function stock(overrides: Partial<LadderStockAnalysis> = {}): LadderStockAnalysis {
  return {
    rank: 1,
    code: '600001',
    name: '测试股份',
    price: 11,
    changePct: 10,
    boardType: 'main',
    consecutiveDays: 2,
    nDayBoards: '2板',
    themes: ['机器人'],
    primaryTheme: '机器人',
    subtheme: '',
    themeGrade: 'A',
    themeScore: 82,
    role: 'theme-leader',
    reason: '',
    firstTime: '09:40:00',
    lastTime: '14:30:00',
    openCount: 0,
    turnoverRate: 12,
    amount: 500_000_000,
    sealAmount: null,
    onePrice: false,
    tBoard: false,
    isMarginEligible: false,
    reasonSource: 'none',
    state: 'candidate',
    score: 78,
    promotionLane: '2进3',
    promotionScore: 80,
    tradabilityScore: 72,
    baseScore: 76.8,
    technical: {
      available: false,
      settled: true,
      lastDate: '2026-08-17',
      barCount: 0,
      ma20: null,
      ma60: null,
      ma120: null,
      ma120Rising: null,
      atr14Pct: null,
      breakout20: null,
      breakout60: null,
      breakout120: null,
      breakoutLine20: null,
      pre20RangePct: null,
      amountRatio20: null,
      amountRatioSource: 'missing',
      prePosition120Pct: null,
      episodeOnsetDate: null,
      episodeReturnPct: null,
      sessionsFromOnset: null,
      recognitionLate: false,
      onePrice: false,
      shape: 'insufficient',
      platformEdge: null,
      onsetLow: null,
    },
    dimensions: {
      market: { score: 70, note: '' },
      theme: { score: 82, note: '' },
      ladder: { score: 78, note: '' },
      technical: { score: 50, note: '' },
      fundFlow: { score: 50, note: '' },
      seal: { score: 80, note: '' },
    },
    fundFlow: {
      available: false,
      score: 50,
      net: 0,
      instNet: 0,
      hotNet: 0,
      lhasaNet: 0,
      note: '',
      source: 'missing-neutral',
    },
    penalties: [],
    warnings: [],
    trigger: '',
    invalidation: '',
    mainRisk: '',
    ...overrides,
  }
}

function confirmation(
  overrides: Partial<NextDayCandidateConfirmation> = {},
): NextDayCandidateConfirmation {
  return {
    code: '600001',
    name: '测试股份',
    baseState: 'candidate',
    promotionLane: '2进3',
    baseScore: 76.8,
    promotionScore: 80,
    tradabilityScore: 72,
    auctionScore: 78,
    openScore: null,
    liveScore: 77,
    state: 'auction-qualified',
    tradeDate: '2026-08-18',
    quoteTime: '09:25:00',
    openGapPct: 3,
    auctionAmount: 50_000_000,
    currentAmount: 50_000_000,
    currentPrice: 10.3,
    vwap: null,
    inaccessible: false,
    warnings: [],
    ...overrides,
  }
}

function context(
  overrides: Partial<LadderAuctionContext> = {},
): LadderAuctionContext {
  return {
    capturedAt: '2026-08-18T01:25:00.000Z',
    snapshotCount: 20,
    coverage: 100,
    lowConfidence: false,
    sources: ['tencent', 'eastmoney'],
    marketStyle: {
      style: 'technology',
      label: '权重科技回流',
      score: 80,
      confidence: 100,
      topFiveConcentrationPct: 100,
      weightedSharePct: 100,
      evidence: ['仅作市场风格证据'],
    },
    topAmount: [
      {
        code: '600010',
        name: '科技权重',
        industry: '半导体',
        style: 'technology',
        price: 10,
        changePct: 2,
        amount: 1_000_000_000,
        marketCap: 100_000_000_000,
        tradeDate: '2026-08-18',
        quoteTime: '09:25:00',
        source: 'eastmoney',
      },
    ],
    themes: [
      {
        theme: '机器人',
        score: 58,
        state: 'weak',
        positiveRate: 50,
        weightedGapPct: 1,
        amountSharePct: 10,
        coreCode: '600001',
        coreName: '测试股份',
        coreOnePrice: false,
        assistantCodes: [],
        assistantCount: 0,
        coverage: 100,
      },
    ],
    candidateProcesses: [],
    warnings: [],
    ...overrides,
  }
}

function fixtures(overrides: {
  auctionSnapshotAvailable?: boolean
  confirmationSnapshotAvailable?: boolean
  auctionContext?: LadderAuctionContext | null
  candidate?: NextDayCandidateConfirmation
} = {}): {
  analysis: LimitLadderAnalysis
  nextDay: LimitLadderNextDay
} {
  const candidateStock = stock()
  return {
    analysis: {
      asof: '2026-08-17',
      generatedAt: '2026-08-17T07:10:00.000Z',
      ruleVersion: 'limit-ladder-v3',
      archived: true,
      market: {
        cycle: {
          phase: 'repair',
          score: 70,
          directionAvailable: true,
          reasons: [],
          current: {
            temperature: 50,
            limitUp: 50,
            limitDown: 5,
            breakRate: 20,
            promotionRate: 30,
            yestLimitPerf: 1,
            advance: 3000,
            decline: 2000,
            maxBoards: 4,
            ladderContinuity: 80,
          },
        },
        limitUp: 50,
        limitDown: 5,
        breakRate: 20,
        promotionRate: 30,
        advance: 3000,
        decline: 2000,
        maxBoards: 4,
      },
      themes: [],
      nextDayCandidates: [candidateStock],
      levels: [{ boards: 2, stocks: [candidateStock] }],
      firstBoards: [],
      stocks: [candidateStock],
      quality: {
        source: 'mixed',
        sourceDate: '2026-08-17',
        sentimentSource: 'kaipanla',
        sentimentStatus: 'full',
        limitFieldsComplete: true,
        klineComplete: 1,
        klineTotal: 1,
        degraded: false,
        fundFlowComplete: false,
        warnings: [],
      },
      warnings: [],
    },
    nextDay: {
      signalDate: '2026-08-17',
      tradeDate: '2026-08-18',
      generatedAt: '2026-08-18T01:28:00.000Z',
      ruleVersion: 'limit-ladder-v3',
      stage: 'auction',
      auctionSnapshotAvailable: overrides.auctionSnapshotAvailable ?? true,
      confirmationSnapshotAvailable:
        overrides.confirmationSnapshotAvailable ?? false,
      auctionContext:
        overrides.auctionContext === undefined ? context() : overrides.auctionContext,
      outcome: null,
      candidates: [overrides.candidate ?? confirmation()],
      warnings: [],
    },
  }
}

beforeEach(() => {
  archiveRoot = mkdtempSync(join(tmpdir(), 'auction-brief-'))
  process.env.LADDER_ARCHIVE_ROOT = archiveRoot
  process.env.AUCTION_PUSH_ENABLED = 'true'
  process.env.AUCTION_BRIEF_AI_ENABLED = 'false'
})

afterEach(() => {
  rmSync(archiveRoot, { recursive: true, force: true })
  process.env.LADDER_ARCHIVE_ROOT = originalEnv.archiveRoot
  process.env.AUCTION_PUSH_ENABLED = originalEnv.pushEnabled
  process.env.AUCTION_BRIEF_AI_ENABLED = originalEnv.aiEnabled
  if (originalEnv.sendKey == null) delete process.env.SERVERCHAN_SEND_KEY
  else process.env.SERVERCHAN_SEND_KEY = originalEnv.sendKey
  vi.restoreAllMocks()
})

describe('auction brief rules', () => {
  it('treats concentrated technology turnover as style evidence, not a main line', () => {
    const { analysis, nextDay } = fixtures()
    const brief = buildAuctionBrief({
      phase: 'auction-final',
      analysis,
      nextDay,
    })
    expect(brief.marketStyle?.label).toBe('权重科技回流')
    expect(brief.primaryDirection).toContain('仅市场风格证据')
    expect(brief.primaryDirection).not.toContain('主线')
    expect(brief.candidates[0].verdict).toBe('accept')
    expect(brief.candidates[0].reasons.join('；')).not.toContain('严格实战闸门')
  })

  it('only marks a theme as leading when the scored context has core support', () => {
    const leading = context({
      themes: [
        {
          ...context().themes[0],
          state: 'leading',
          score: 82,
          coreOnePrice: true,
          assistantCodes: ['600002', '600003'],
          assistantCount: 2,
        },
      ],
    })
    const { analysis, nextDay } = fixtures({ auctionContext: leading })
    const brief = buildAuctionBrief({
      phase: 'auction-final',
      analysis,
      nextDay,
    })
    expect(brief.primaryDirection).toBe('机器人题材引领')
    expect(brief.renderedText).toContain('助攻2只')
  })

  it('includes the frozen v6 repair structure in the rule summary', () => {
    const { analysis, nextDay } = fixtures()
    nextDay.ruleVersion = 'limit-ladder-v6'
    nextDay.marketGate = {
      signalDate: analysis.asof,
      tradeDate: nextDay.tradeDate,
      generatedAt: nextDay.generatedAt,
      phase: 'auction',
      state: 'cautious',
      riskScore: 55,
      externalRiskScore: 45,
      domesticRiskScore: 60,
      domesticConfirmed: true,
      premarket: null,
      domestic: null,
      repairContext: {
        state: 'weight-led-repair',
        capturedAt: '2026-08-18T09:25:00+08:00',
        applicable: true,
        confidence: 100,
        largeCapChangePct: 0.6,
        smallCapChangePct: -0.2,
        sizeSpreadPct: 0.8,
        advanceRate: 40,
        largeCapAuctionAmountSharePct: 65,
        highBoardState: 'contraction',
        reasons: [],
        warnings: [],
      },
      themePermissions: [],
      reasons: [],
      warnings: [],
    }

    const brief = buildAuctionBrief({
      phase: 'auction-final',
      analysis,
      nextDay,
    })

    expect(brief.ruleVersion).toBe('limit-ladder-v6')
    expect(brief.deterministicSummary).toContain('权重抽水式修复')
    expect(brief.renderedText).toContain('weight-led-repair')
  })

  it('sends a data warning instead of fabricating a missed 9:25 snapshot', () => {
    const { analysis, nextDay } = fixtures({
      auctionSnapshotAvailable: false,
      auctionContext: context(),
    })
    const brief = buildAuctionBrief({
      phase: 'auction-final',
      analysis,
      nextDay,
    })
    expect(brief.degraded).toBe(true)
    expect(brief.primaryDirection).toBe('竞价方向不可判定')
    expect(brief.topAmount).toEqual([])
    expect(brief.candidates).toEqual([])
    expect(brief.observations).toEqual([])
    expect(brief.summary).toContain('冻结快照缺失')
    expect(brief.warnings.join('')).toContain('未使用9:35累计成交额')
  })

  it('shows confirmed and rejected candidates from the 9:35 state machine', () => {
    const confirmedFixtures = fixtures({
      confirmationSnapshotAvailable: true,
      candidate: confirmation({
        quoteTime: '09:35:10',
        openScore: 75,
        liveScore: 80,
        state: 'confirmed',
        vwap: 10.2,
      }),
    })
    const confirmed = buildAuctionBrief({
      phase: 'open-confirmation',
      ...confirmedFixtures,
    })
    expect(confirmed.candidates[0].verdict).toBe('accept')
    expect(confirmed.candidates[0].reasons.join('；')).not.toContain('严格实战闸门')
    expect(confirmed.candidates[0].reasons).toContain('价格在VWAP上方')

    const rejectedFixtures = fixtures({
      confirmationSnapshotAvailable: true,
      candidate: confirmation({
        quoteTime: '09:35:10',
        state: 'rejected',
        inaccessible: true,
      }),
    })
    const rejected = buildAuctionBrief({
      phase: 'open-confirmation',
      ...rejectedFixtures,
    })
    expect(rejected.candidates[0].verdict).toBe('reject')
  })

  it('does not let an ineligible relay research item downgrade a formal acceptance', () => {
    const fixturesWithRelay = fixtures({
      confirmationSnapshotAvailable: true,
      candidate: confirmation({
        quoteTime: '09:35:10',
        openScore: 75,
        liveScore: 80,
        state: 'confirmed',
        vwap: 10.2,
      }),
    })
    fixturesWithRelay.nextDay.relayPlan = {
      status: 'research-score',
      signalDate: fixturesWithRelay.nextDay.signalDate,
      tradeDate: fixturesWithRelay.nextDay.tradeDate,
      generatedAt: fixturesWithRelay.nextDay.generatedAt,
      stage: 'open',
      items: [{ code: '600001', executionEligible: false }],
      warnings: [],
    } as unknown as LimitLadderNextDay['relayPlan']

    const brief = buildAuctionBrief({
      phase: 'open-confirmation',
      ...fixturesWithRelay,
    })

    expect(brief.candidates[0].verdict).toBe('accept')
    expect(brief.candidates[0].score).toBe(80)
  })

  it('keeps one message within the configured ServerChan length', () => {
    const { analysis, nextDay } = fixtures()
    const brief = buildAuctionBrief({
      phase: 'auction-final',
      analysis,
      nextDay: {
        ...nextDay,
        warnings: Array.from({ length: 20 }, (_, index) => `${index}-${'长警告'.repeat(300)}`),
      },
    })
    expect(renderAuctionBrief(brief).length).toBeLessThanOrEqual(3_500)
  })
})

describe('auction brief delivery', () => {
  it('retries transient failures and returns the successful attempt', async () => {
    let calls = 0
    const provider: NotificationProvider = {
      name: 'serverchan',
      configured: true,
      send: vi.fn(async () => {
        calls += 1
        return {
          ok: calls === 3,
          statusCode: calls === 3 ? 200 : 502,
          providerCode: calls === 3 ? 0 : -1,
          message: calls === 3 ? 'ok' : 'temporary',
          pushId: calls === 3 ? 'push-1' : null,
        }
      }),
    }
    const result = await sendNotificationWithRetry(
      provider,
      { title: 'test', body: 'test' },
      { maxAttempts: 3, retryDelaysMs: [0, 0], sleep: async () => {} },
    )
    expect(result.result.ok).toBe(true)
    expect(result.attempts).toBe(3)
  })

  it('does not retry permanent 4xx failures', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      statusCode: 400,
      providerCode: 40001,
      message: 'bad request',
      pushId: null,
    }))
    const provider: NotificationProvider = {
      name: 'serverchan',
      configured: true,
      send,
    }
    const result = await sendNotificationWithRetry(
      provider,
      { title: 'test', body: 'test' },
      { maxAttempts: 3, retryDelaysMs: [0], sleep: async () => {} },
    )
    expect(result.attempts).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('archives once and suppresses duplicate scheduler ticks without storing secrets', async () => {
    const { analysis, nextDay } = fixtures()
    const send = vi.fn(async () => ({
      ok: true,
      statusCode: 200,
      providerCode: 0,
      message: 'ok',
      pushId: 'push-1',
    }))
    const provider: NotificationProvider = {
      name: 'serverchan',
      configured: true,
      send,
    }
    const first = await generateAndDispatchAuctionBrief(
      { phase: 'auction-final', analysis, nextDay },
      {
        provider,
        polish: async (brief) => brief,
        retryDelaysMs: [0],
        sleep: async () => {},
      },
    )
    const second = await generateAndDispatchAuctionBrief(
      { phase: 'auction-final', analysis, nextDay },
      { provider, polish: async (brief) => brief },
    )
    expect(first.delivery.status).toBe('sent')
    expect(second.duplicate).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(readAuctionBriefState(analysis.asof).briefs).toHaveLength(1)
    const deliveryPath = join(
      archiveRoot,
      analysis.asof,
      'notification-delivery-limit-ladder-v6.json',
    )
    expect(readFileSync(deliveryPath, 'utf8')).not.toContain('SCT-secret')
  })

  it('falls back to the rule summary when polishing fails', async () => {
    const { analysis, nextDay } = fixtures()
    const provider: NotificationProvider = {
      name: 'serverchan',
      configured: true,
      send: vi.fn(async () => ({
        ok: true,
        statusCode: 200,
        providerCode: 0,
        message: 'ok',
        pushId: null,
      })),
    }
    const result = await generateAndDispatchAuctionBrief(
      { phase: 'auction-final', analysis, nextDay },
      {
        provider,
        polish: async () => {
          throw new Error('timeout')
        },
        retryDelaysMs: [0],
        sleep: async () => {},
      },
    )
    expect(result.brief.generationMode).toBe('rules')
    expect(result.brief.summary).toBe(result.brief.deterministicSummary)
  })

  it('redacts a SendKey from persisted network errors', async () => {
    process.env.SERVERCHAN_SEND_KEY = 'SCT-secret-value'
    const { analysis, nextDay } = fixtures()
    const provider: NotificationProvider = {
      name: 'serverchan',
      configured: true,
      send: vi.fn(async () => {
        throw new Error(
          'request to https://sctapi.ftqq.com/SCT-secret-value.send failed',
        )
      }),
    }
    const result = await generateAndDispatchAuctionBrief(
      { phase: 'auction-final', analysis, nextDay },
      {
        provider,
        polish: async (brief) => brief,
        maxAttempts: 1,
        retryDelaysMs: [0],
        sleep: async () => {},
      },
    )
    const archived = readAuctionBriefState(analysis.asof).deliveries[0]
    expect(result.delivery.status).toBe('failed')
    expect(archived.error).toContain('[redacted]')
    expect(JSON.stringify(archived)).not.toContain('SCT-secret-value')
  })
})

describe('auction brief schedule', () => {
  it('only opens the two intended dispatch windows', () => {
    expect(auctionBriefPhaseForMinutes(9 * 60 + 27)).toBeNull()
    expect(auctionBriefPhaseForMinutes(9 * 60 + 28)).toBe('auction-final')
    expect(auctionBriefPhaseForMinutes(9 * 60 + 35)).toBe('open-confirmation')
    expect(auctionBriefPhaseForMinutes(9 * 60 + 37)).toBeNull()
  })
})
