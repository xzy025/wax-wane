import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LadderView from './LadderView'
import zh from '../i18n/zh'
import type {
  FirstBoardScanResponse,
  LadderStockAnalysis,
  LimitLadderAnalysis,
  LimitLadderNextDay,
} from '../hooks/useLadderAnalysis'

const refresh = vi.fn()
const importData = vi.fn()

function unavailableFirstBoardScan(): FirstBoardScanResponse {
  return {
    tradeDate: '2026-08-27',
    generatedAt: '2026-08-27T09:35:10+08:00',
    schemaVersion: 'first-board-scan-v2',
    scoreVersion: 'first-board-score-v3',
    ruleVersion: 'first-board-scan-v2',
    status: 'unavailable',
    window: { start: '09:35', end: '10:35', intervalMinutes: 1, intervalSeconds: 60 },
    lastScanAt: '2026-08-27T09:35:10+08:00',
    nextScanAt: null,
    scanCount: 0,
    rejectedObservationCount: 1,
    candidates: [],
    snapshots: [],
    excludedStCount: 0,
    dataQuality: 'insufficient',
    dataAsOf: null,
    source: 'kaipanla-realtime',
    fromCache: false,
    evidenceStatus: 'unavailable',
    warnings: ['首板扫描失败：开盘啦实时梯队接口不可用'],
  }
}

vi.mock('../hooks/useLadderAnalysis', async () => {
  const actual = await vi.importActual('../hooks/useLadderAnalysis')
  return {
    ...actual,
    useAuctionBriefs: vi.fn(),
    useCrossMarketSnapshot: vi.fn(),
    useFirstBoardScan: vi.fn(),
    useHithinkAnomaly: vi.fn(),
    useLadderAnalysis: vi.fn(),
    useLadderNextDay: vi.fn(),
    useLadderReason: vi.fn(),
  }
})

import {
  useAuctionBriefs,
  useCrossMarketSnapshot,
  useFirstBoardScan,
  useHithinkAnomaly,
  useLadderAnalysis,
  useLadderNextDay,
  useLadderReason,
} from '../hooks/useLadderAnalysis'
import { getLastSettledTradingDay } from '../utils/marketHistory'

function stock(overrides: Partial<LadderStockAnalysis>): LadderStockAnalysis {
  return {
    rank: 1,
    code: '600001',
    name: '机器人龙头',
    price: 11,
    changePct: 10,
    boardType: 'main',
    consecutiveDays: 3,
    nDayBoards: '3板',
    themes: ['机器人'],
    primaryTheme: '机器人',
    subtheme: '',
    themeGrade: 'A',
    themeScore: 82,
    role: 'space-leader',
    reason: '产业催化',
    firstTime: '094000',
    lastTime: '145000',
    openCount: 0,
    turnoverRate: 8,
    amount: 5e8,
    sealAmount: null,
    onePrice: false,
    tBoard: false,
    isMarginEligible: true,
    reasonSource: 'kaipanla',
    state: 'candidate',
    score: 84,
    technical: {
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
    },
    dimensions: {
      market: { score: 75, note: '修复' },
      theme: { score: 82, note: 'A级' },
      ladder: { score: 100, note: '空间龙' },
      technical: { score: 95, note: '低位平台' },
      fundFlow: { score: 50, note: '龙虎榜缺失' },
      seal: { score: 90, note: '早板' },
    },
    penalties: [],
    warnings: [],
    trigger: '守住平台后转强',
    invalidation: '跌破平台',
    mainRisk: '次日不确认',
    ...overrides,
  }
}

const leader = stock({})
const firstBoard = stock({
  rank: 2,
  code: '300001',
  name: 'AI先锋',
  boardType: 'twenty',
  consecutiveDays: 1,
  nDayBoards: '首板',
  role: 'first-pioneer',
  state: 'waiting',
  score: 68,
  primaryTheme: '人工智能',
  themes: ['人工智能'],
  themeGrade: 'B',
})

const data: LimitLadderAnalysis = {
  asof: '2026-08-11',
  generatedAt: '2026-08-11T15:10:00+08:00',
  ruleVersion: 'limit-ladder-v1',
  archived: true,
  market: {
    cycle: {
      phase: 'repair',
      score: 75,
      directionAvailable: true,
      reasons: ['修复'],
      current: {
        temperature: 55,
        limitUp: 2,
        limitDown: 0,
        breakRate: 10,
        promotionRate: 35,
        yestLimitPerf: 2,
        advance: 3000,
        decline: 1800,
        maxBoards: 3,
        ladderContinuity: 67,
      },
    },
    limitUp: 2,
    limitDown: 0,
    breakRate: 10,
    promotionRate: 35,
    advance: 3000,
    decline: 1800,
    maxBoards: 3,
  },
  themes: [
    {
      name: '机器人',
      grade: 'A',
      score: 82,
      count: 1,
      firstBoardCount: 0,
      multiBoardCount: 1,
      maxBoards: 3,
      continuity: 33,
      promotionRate: 35,
      sealStability: 100,
      stockCodes: ['600001'],
    },
    {
      name: '人工智能',
      grade: 'B',
      score: 65,
      count: 1,
      firstBoardCount: 1,
      multiBoardCount: 0,
      maxBoards: 1,
      continuity: 100,
      promotionRate: 35,
      sealStability: 90,
      stockCodes: ['300001'],
    },
  ],
  levels: [{ boards: 3, stocks: [leader] }],
  firstBoards: [firstBoard],
  stocks: [leader, firstBoard],
  quality: {
    source: 'eastmoney',
    sourceDate: '2026-08-11',
    sentimentSource: 'kaipanla',
    limitFieldsComplete: true,
    klineComplete: 2,
    klineTotal: 2,
    degraded: false,
    warnings: [],
  },
  warnings: [],
}

const v2Leader = stock({
  promotionLane: '3进4',
  promotionScore: 83,
  tradabilityScore: 74,
  baseScore: 79.4,
  candidateRank: 1,
  turnoverCapacity: {
    circulatingMarketCap: 5e9,
    amountToFloatCapPct: 10,
    effectiveTurnoverPct: 9,
    score: 88,
    amountPercentile: 75,
    dataConsistent: true,
    note: '有效换手9%·同层成交额P75',
  },
  popularity: {
    score: 86,
    roleScore: 100,
    followScore: 67,
    hotRankScore: 80,
    fundFlowScore: null,
    eastmoneyRank: 3,
    thsRank: null,
    followerCount: 2,
    note: '空间龙·带动2只',
  },
  v2: {
    promotion: 83,
    tradability: 74,
    base: 79.4,
    promotionDimensions: {
      market: { score: 75, note: '修复' },
      lane: { score: 84, note: '3进4' },
      theme: { score: 82, note: 'A级机器人' },
      popularity: { score: 86, note: '空间龙' },
      seal: { score: 90, note: '早板' },
      technical: { score: 80, note: '低位平台' },
    },
    tradabilityDimensions: {
      accessibility: { score: 100, note: '可达换手板' },
      turnoverCapacity: { score: 88, note: '有效换手9%' },
      liquidity: { score: 75, note: '成交额5亿' },
      structure: { score: 80, note: '低位平台' },
      reopen: { score: 90, note: '未开板' },
    },
  },
})

const v2Data: LimitLadderAnalysis = {
  ...data,
  ruleVersion: 'limit-ladder-v2',
  promotionLanes: [
    {
      fromBoards: 1,
      toBoards: 2,
      label: '1进2',
      score: 68,
      supply: 4,
      promotionRate: 30,
      promoted: 3,
      promotionTotal: 10,
      themeCoverage: 50,
      upperAnchor: 100,
      sealStability: 80,
      dominant: false,
    },
    {
      fromBoards: 2,
      toBoards: 3,
      label: '2进3',
      score: 86,
      supply: 3,
      promotionRate: 50,
      promoted: 2,
      promotionTotal: 4,
      themeCoverage: 100,
      upperAnchor: 100,
      sealStability: 90,
      dominant: true,
    },
    {
      fromBoards: 3,
      toBoards: 4,
      label: '3进4',
      score: 78,
      supply: 1,
      promotionRate: null,
      promoted: 0,
      promotionTotal: 0,
      themeCoverage: 100,
      upperAnchor: 100,
      sealStability: 100,
      dominant: false,
    },
  ],
  dominantLane: '2进3',
  nextDayCandidates: [v2Leader],
  levels: [{ boards: 3, stocks: [v2Leader] }],
  stocks: [v2Leader, firstBoard],
}

describe('LadderView', () => {
  beforeEach(() => {
    vi.mocked(useLadderAnalysis).mockReturnValue({
      data,
      loading: false,
      error: null,
      refresh,
      importData,
    })
    vi.mocked(useAuctionBriefs).mockReturnValue({ data: null, error: null })
    vi.mocked(useCrossMarketSnapshot).mockReturnValue({ data: null, error: null })
    vi.mocked(useFirstBoardScan).mockReturnValue({ data: null, error: null })
    vi.mocked(useLadderNextDay).mockReturnValue({ data: null, error: null })
    vi.mocked(useHithinkAnomaly).mockReturnValue({ detail: null, loading: false, error: null })
    vi.mocked(useLadderReason).mockReturnValue({
      detail: {
        code: '600001',
        date: '2026-08-11',
        reason: '机器人+核心零部件；公司产品进入量产阶段。',
        explanation: '公司持续推进机器人零部件业务。',
        marketRole: '日内龙一',
        hotReason: '',
        source: 'kaipanla',
      },
      loading: false,
      error: null,
    })
  })

  it('renders descending ladder levels and a separate first-board grid', () => {
    render(<LadderView t={zh} language="zh" />)
    expect(screen.queryByLabelText(zh.ladder.v2.lanes)).not.toBeInTheDocument()
    expect(screen.getByText('机器人龙头')).toBeInTheDocument()
    expect(screen.getByText('AI先锋')).toBeInTheDocument()
    expect(screen.getByText(`${zh.ladder.firstBoard} (1)`)).toBeInTheDocument()
    expect(screen.getAllByText(zh.ladder.badges.margin).length).toBeGreaterThan(0)
    expect(screen.getByText(zh.ladder.badges.chiNext)).toBeInTheDocument()
    expect(screen.getAllByText(`${zh.ladder.firstSealShort}09:40`).length).toBeGreaterThan(0)
  })

  it('keeps the current settled date when archives lag and opens that month in the calendar', async () => {
    const expectedDate = getLastSettledTradingDay()
    const [year, month] = expectedDate.split('-')
    const user = userEvent.setup()

    render(<LadderView t={zh} language="zh" />)

    expect(screen.getByRole('button', { name: expectedDate })).toBeInTheDocument()
    expect(useLadderAnalysis).toHaveBeenLastCalledWith(expectedDate)

    await user.click(screen.getByRole('button', { name: expectedDate }))
    expect(screen.getByText(`${year}年${Number(month)}月`)).toBeInTheDocument()
  })

  it('distinguishes a missing historical archive from a service failure', () => {
    vi.mocked(useLadderAnalysis).mockReturnValue({
      data: null,
      loading: false,
      error: '未找到2026-09-02的连板天梯归档',
      refresh,
      importData,
    })

    render(<LadderView t={zh} language="zh" />)

    expect(screen.getByText(zh.ladder.archiveUnavailable)).toBeInTheDocument()
    expect(screen.getByText(zh.ladder.archiveUnavailableHint)).toBeInTheDocument()
    expect(screen.queryByText(zh.ladder.loadFail)).not.toBeInTheDocument()
  })

  it('renders an unavailable first-board scan as a data failure, not a closed window', () => {
    vi.mocked(useFirstBoardScan).mockReturnValue({ data: unavailableFirstBoardScan(), error: null })

    render(<LadderView t={zh} language="zh" />)

    expect(screen.getByText(zh.ladder.firstBoardScan.unavailableEmpty)).toBeInTheDocument()
    expect(screen.queryByText(zh.ladder.firstBoardScan.closedEmpty)).not.toBeInTheDocument()
  })

  it('switches to the list view and opens evidence details', async () => {
    vi.mocked(useHithinkAnomaly).mockReturnValue({
      detail: {
        stockName: '机器人龙头',
        tagName: '异动解读',
        content: '同花顺当日异动原因。',
        keywords: ['机器人', '减速器'],
      },
      loading: false,
      error: null,
    })
    const user = userEvent.setup()
    render(<LadderView t={zh} language="zh" />)
    await user.click(screen.getByRole('tab', { name: zh.ladder.list }))
    const triggerHeader = screen.getByRole('columnheader', { name: zh.ladder.table.trigger })
    expect(triggerHeader).toBeInTheDocument()
    await user.click(
      within(triggerHeader.closest('table') as HTMLTableElement).getByText('机器人龙头'),
    )
    expect(screen.getByText(zh.ladder.detail.evidence)).toBeInTheDocument()
    expect(
      within(screen.getByLabelText(zh.ladder.detail.title)).getByText('守住平台后转强'),
    ).toBeInTheDocument()
    expect(screen.getByText(zh.ladder.detail.limitReason)).toBeInTheDocument()
    expect(screen.getByText('机器人+核心零部件；公司产品进入量产阶段。')).toBeInTheDocument()
    expect(screen.getByText('同花顺异动原因')).toBeInTheDocument()
    expect(screen.getByText('同花顺当日异动原因。')).toBeInTheDocument()
    expect(screen.getByText('减速器')).toBeInTheDocument()
  })

  it('refreshes the analysis, next-day state, and auction briefs together', async () => {
    refresh.mockResolvedValueOnce(true)
    const user = userEvent.setup()
    render(<LadderView t={zh} language="zh" />)

    await user.click(screen.getByTitle('刷新数据'))

    expect(refresh).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(useLadderNextDay).toHaveBeenLastCalledWith(expect.any(String), true, 1, false)
      expect(useAuctionBriefs).toHaveBeenLastCalledWith(expect.any(String), false, 1, false)
      expect(useCrossMarketSnapshot).toHaveBeenLastCalledWith('', 'premarket', false, 1, false)
    })
  })

  it('does not report zero qualifying candidates when archive eligibility blocked the request', () => {
    vi.mocked(useLadderAnalysis).mockReturnValue({
      data: { ...v2Data, ruleVersion: 'limit-ladder-v6', nextDayCandidates: [] },
      loading: false, error: null, refresh, importData,
    })
    vi.mocked(useLadderNextDay).mockReturnValue({
      data: null, error: '连板归档未完成：缺少K线providerAt',
    })
    render(<LadderView t={zh} language="zh" />)
    expect(screen.getByText('连板归档未完成：缺少K线providerAt')).toBeInTheDocument()
    expect(screen.queryByText(zh.ladder.v2.candidateEmpty)).not.toBeInTheDocument()
  })

  it('explains data blockers when the next-day request succeeds with no formal candidates', () => {
    vi.mocked(useLadderAnalysis).mockReturnValue({
      data: {
        ...v2Data,
        ruleVersion: 'limit-ladder-v6',
        nextDayCandidates: [],
        strategyStatus: 'research',
        quality: {
          ...v2Data.quality,
          degraded: true,
          sentimentStatus: 'unavailable',
          limitFieldsComplete: false,
          providerAt: null,
          settled: true,
          warnings: ['1只非正式候选观察标的缺少封板时间'],
        },
      },
      loading: false, error: null, refresh, importData,
    })
    vi.mocked(useLadderNextDay).mockReturnValue({
      data: {
        signalDate: '2026-08-11', tradeDate: '2026-08-12',
        generatedAt: '2026-08-11T15:30:00+08:00', ruleVersion: 'limit-ladder-v6',
        stage: 'pending', auctionSnapshotAvailable: false, candidates: [], warnings: [],
        strategyStatus: 'research',
      },
      error: null,
    })

    render(<LadderView t={zh} language="zh" />)

    const panel = within(screen.getByLabelText(zh.ladder.v2.candidates))
    expect(panel.getByText('数据质量阻断，正式候选未生成')).toBeInTheDocument()
    expect(panel.getByText('情绪数据不完整：unavailable')).toBeInTheDocument()
    expect(panel.getByText('正式归档股票的板数或封板时间不完整')).toBeInTheDocument()
    expect(panel.getByText('缺少可信K线来源时间（providerAt）')).toBeInTheDocument()
    expect(panel.queryByText(/正式归档股票K线覆盖不完整/)).not.toBeInTheDocument()
    expect(panel.getByText('1只非正式候选观察标的缺少封板时间').closest('details')).not.toBeNull()
    expect(panel.queryByText(zh.ladder.v2.candidateEmpty)).not.toBeInTheDocument()
  })

  it.each([
    { name: 'unarchived close', archived: false, reason: '收盘归档尚未完成' },
    { name: 'formal eligibility', formalSignalEligible: false, reason: '归档尚未达到正式信号条件' },
    { name: 'unsettled K-lines', quality: { settled: false }, reason: 'K线尚未完成收盘定盘' },
    { name: 'incomplete formal K-lines', quality: { klineComplete: 1 }, reason: '正式归档股票K线覆盖不完整：1/2' },
  ])('explains $name without relying on an API error', ({ reason, quality, name: _name, ...overrides }) => {
    const analysis = {
      ...v2Data,
      ...overrides,
      nextDayCandidates: [],
      quality: { ...v2Data.quality, sentimentStatus: 'full' as const, settled: true, providerAt: '2026-08-11T15:00:00+08:00', ...quality },
    }
    vi.mocked(useLadderAnalysis).mockReturnValue({ data: analysis, loading: false, error: null, refresh, importData })

    render(<LadderView t={zh} language="zh" />)

    const panel = within(screen.getByLabelText(zh.ladder.v2.candidates))
    expect(panel.getByText('数据质量阻断，正式候选未生成')).toBeInTheDocument()
    expect(panel.getByText(reason)).toBeInTheDocument()
    expect(panel.queryByText(zh.ladder.v2.candidateEmpty)).not.toBeInTheDocument()
  })

  it('keeps the threshold empty state for eligible data despite observation-only warnings', () => {
    const analysis = {
      ...v2Data,
      formalSignalEligible: true,
      nextDayCandidates: [],
      quality: {
        ...v2Data.quality, sentimentStatus: 'full' as const, settled: true,
        providerAt: '2026-08-11T15:00:00+08:00',
        warnings: ['1只非正式候选观察标的缺少封板时间', '观察标的K线不完整：300001'],
      },
    }
    vi.mocked(useLadderAnalysis).mockReturnValue({ data: analysis, loading: false, error: null, refresh, importData })
    vi.mocked(useLadderNextDay).mockReturnValue({
      data: {
        signalDate: '2026-08-11', tradeDate: '2026-08-12',
        generatedAt: '2026-08-11T15:30:00+08:00', ruleVersion: 'limit-ladder-v2',
        stage: 'pending', auctionSnapshotAvailable: false, candidates: [], warnings: [],
      },
      error: null,
    })

    render(<LadderView t={zh} language="zh" />)

    const panel = within(screen.getByLabelText(zh.ladder.v2.candidates))
    expect(panel.getByText(zh.ladder.v2.candidateEmpty)).toBeInTheDocument()
    expect(panel.queryByText('数据质量阻断，正式候选未生成')).not.toBeInTheDocument()
  })

  it('renders research scores, unavailable liquidity, and statistical capital tilt', () => {
    vi.mocked(useLadderAnalysis).mockReturnValue({
      data: { ...v2Data, ruleVersion: 'limit-ladder-v6' },
      loading: false,
      error: null,
      refresh,
      importData,
    })
    vi.mocked(useLadderNextDay).mockReturnValue({
      data: {
        signalDate: '2026-08-20',
        tradeDate: '2026-08-21',
        generatedAt: '2026-08-21T09:35:00+08:00',
        ruleVersion: 'limit-ladder-v6',
        stage: 'open',
        auctionSnapshotAvailable: true,
        confirmationSnapshotAvailable: true,
        candidates: [],
      },
      error: null,
    })
    vi.mocked(useCrossMarketSnapshot).mockReturnValue({
      data: {
        tradeDate: '2026-08-21',
        cutoffAt: '2026-08-21T09:35:00+08:00',
        generatedAt: '2026-08-21T09:35:02+08:00',
        phase: 'open',
        modelVersion: 'us-a-v1-research',
        graphVersion: 'evidence-graph-v1',
        probabilityStatus: 'research-score',
        researchStatus: 'research',
        dataQuality: {
          status: 'degraded',
          sourceCoveragePct: 80,
          staleSources: [],
          missingSources: ['same-time-baseline'],
          warnings: [],
        },
        liquidityRegime: {
          phase: 'open',
          cutoffAt: '2026-08-21T09:35:00+08:00',
          source: 'full-market-clist',
          totalAmount: 1_000_000,
          baselineSessions: 2,
          sameTimeTurnoverRatio: null,
          turnoverZ: null,
          advanceRatePct: 27.5,
          top50AmountSharePct: 30,
          concentrationDeltaPct: null,
          largeSmallSpreadPct: 0.8,
          state: 'unavailable',
          confidence: 50,
          warnings: ['同刻基线不足20日，流动性状态不可用'],
        },
        capitalSeesaw: {
          phase: 'open',
          generatedAt: '2026-08-21T09:35:02+08:00',
          status: 'research-score',
          lanes: [
            {
              id: 'hard-tech',
              label: '大科技/CPO',
              externalShock: 0.7,
              domesticCycle: 0.2,
              auctionConfirmation: 0.6,
              openConfirmation: 0.8,
              liquidityAdjustment: 0,
              interactionAdjustment: 0.1,
              netResearchScore: 71.4,
              state: '强化',
              reasons: ['海外核心锚修复', 'A股开盘扩散'],
              warnings: [],
            },
            {
              id: 'small-theme',
              label: '题材小票',
              externalShock: 0,
              domesticCycle: 0,
              auctionConfirmation: -0.3,
              openConfirmation: -0.5,
              liquidityAdjustment: -1,
              interactionAdjustment: 0,
              netResearchScore: 33,
              state: '背离',
              reasons: ['窄宽度承压'],
              warnings: [],
            },
          ],
          transfers: [
            {
              from: 'small-theme',
              to: 'hard-tech',
              strength: 38.4,
              label: '资金偏移',
              reasons: ['存量集中', '大科技/CPO相对研究分领先'],
            },
          ],
          warnings: ['流动性基线不足，资金迁移只作展示不参与概率'],
        },
        warnings: [],
      },
      error: null,
    })

    render(<LadderView t={zh} language="zh" />)
    const panel = screen.getByLabelText('资金跷跷板矩阵')
    expect(within(panel).getByText('research-score')).toBeInTheDocument()
    expect(within(panel).getByLabelText('大科技/CPO research-score')).toHaveTextContent('71.4')
    expect(within(panel).getByLabelText('大科技/CPO research-score')).not.toHaveTextContent('%')
    expect(within(panel).getByText(/同刻基线不足20日，流动性状态不可用/)).toBeInTheDocument()
    expect(within(panel).getByText('题材小票 → 大科技/CPO')).toBeInTheDocument()
    expect(useCrossMarketSnapshot).toHaveBeenLastCalledWith('2026-08-21', 'open', true, 0, false)
  })

  it('renders v2 lanes, live candidate state, and dual-score evidence', async () => {
    vi.mocked(useLadderAnalysis).mockReturnValue({
      data: v2Data,
      loading: false,
      error: null,
      refresh,
      importData,
    })
    vi.mocked(useLadderNextDay).mockReturnValue({
      data: {
        signalDate: '2026-08-11',
        tradeDate: '2026-08-12',
        generatedAt: '2026-08-12T09:35:00+08:00',
        ruleVersion: 'limit-ladder-v2',
        stage: 'settled',
        auctionSnapshotAvailable: true,
        confirmationSnapshotAvailable: true,
        auctionContext: {
          capturedAt: '2026-08-12T09:25:00+08:00',
          snapshotCount: 8,
          coverage: 100,
          lowConfidence: false,
          sources: ['sina', 'eastmoney'],
          marketStyle: {
            style: 'technology',
            label: '权重科技回流',
            score: 80,
            confidence: 100,
            topFiveConcentrationPct: 80,
            weightedSharePct: 60,
            evidence: [],
          },
          topAmount: [
            {
              code: '600000',
              name: '科技权重',
              industry: '半导体',
              style: 'technology',
              price: 10,
              changePct: 3,
              amount: 1e9,
              marketCap: 1e11,
              tradeDate: '2026-08-12',
              quoteTime: '09:25:00',
              source: 'eastmoney',
            },
          ],
          themes: [
            {
              theme: '机器人',
              score: 82,
              state: 'leading',
              positiveRate: 80,
              weightedGapPct: 4,
              amountSharePct: 30,
              coreCode: v2Leader.code,
              coreName: v2Leader.name,
              coreOnePrice: true,
              assistantCodes: ['600002', '600003'],
              assistantCount: 2,
              coverage: 100,
            },
          ],
          candidateProcesses: [],
          warnings: [],
        },
        outcome: {
          signalDate: '2026-08-11',
          tradeDate: '2026-08-12',
          generatedAt: '2026-08-12T15:10:00+08:00',
          ruleVersion: 'limit-ladder-v3',
          summary: {
            formal: {
              total: 1,
              valid: 1,
              promoted: 1,
              failed: 0,
              unresolved: 0,
              promotionRate: 100,
              coverage: 100,
            },
            byLane: [
              {
                promotionLane: '3进4',
                fromBoards: 3,
                total: 1,
                valid: 1,
                promoted: 1,
                failed: 0,
                unresolved: 0,
                promotionRate: 100,
                coverage: 100,
              },
            ],
            waitOpen: {
              total: 0,
              valid: 0,
              promoted: 0,
              failed: 0,
              unresolved: 0,
              promotionRate: null,
              coverage: 0,
            },
          },
          rows: [
            {
              code: v2Leader.code,
              name: v2Leader.name,
              candidateRank: 1,
              population: 'formal',
              promotionLane: '3进4',
              fromBoards: 3,
              targetBoards: 4,
              resultStatus: 'promoted',
              promoted: true,
              tradable: true,
              unresolvedReason: '',
              openToClosePct: 2,
              mfePct: 5,
              maePct: -1,
            },
          ],
        },
        candidates: [
          {
            code: v2Leader.code,
            name: v2Leader.name,
            baseState: 'candidate',
            promotionLane: '3进4',
            baseScore: 79.4,
            promotionScore: 83,
            tradabilityScore: 74,
            auctionScore: 76,
            openScore: 81,
            liveScore: 79,
            state: 'confirmed',
            tradeDate: '2026-08-12',
            quoteTime: '09:35:10',
            openGapPct: 3,
            auctionAmount: 5e7,
            currentAmount: 1.5e8,
            currentPrice: 11.3,
            vwap: 11.1,
            inaccessible: false,
            warnings: [],
          },
        ],
        warnings: [],
      },
      error: null,
    })

    const user = userEvent.setup()
    render(<LadderView t={zh} language="zh" />)
    const lanes = screen.getByLabelText(zh.ladder.v2.lanes)
    expect(within(lanes).getByText(`${zh.ladder.v2.dominantLane}: 2进3`)).toBeInTheDocument()
    const candidatePanel = screen.getByLabelText(zh.ladder.v2.candidates)
    expect(within(candidatePanel).getByText(zh.ladder.v2.nextStates.confirmed)).toBeInTheDocument()
    expect(
      within(candidatePanel).getByRole('columnheader', { name: zh.ladder.v2.liveScore }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(zh.ladder.v2.auctionDirection)).toBeInTheDocument()
    expect(screen.getByText('权重科技回流')).toBeInTheDocument()
    expect(screen.getByLabelText(zh.ladder.v2.outcomeReview)).toBeInTheDocument()
    expect(screen.getByText(zh.ladder.v2.outcomeStates.promoted)).toBeInTheDocument()

    await user.click(within(candidatePanel).getByText(v2Leader.name))
    const drawer = screen.getByLabelText(zh.ladder.detail.title)
    expect(within(drawer).getByText(zh.ladder.v2.promotionEvidence)).toBeInTheDocument()
    expect(within(drawer).getByText(zh.ladder.v2.tradabilityEvidence)).toBeInTheDocument()
    expect(within(drawer).getByText(zh.ladder.v2.effectiveTurnover)).toBeInTheDocument()
  })

  it('renders the research relay plan with unavailable pending feedback and anchor gating', () => {
    const feedback = {
      status: 'unavailable',
      stage: 'pending',
      signalDate: '2026-08-21',
      tradeDate: '2026-08-24',
      source: 'unavailable',
      related: [],
      metrics: {},
      evidence: [],
      warnings: ['等待本交易日数据'],
    } as const
    vi.mocked(useLadderAnalysis).mockReturnValue({
      data: v2Data,
      loading: false,
      error: null,
      refresh,
      importData,
    })
    vi.mocked(useLadderNextDay).mockReturnValue({
      data: {
        signalDate: '2026-08-21',
        tradeDate: '2026-08-24',
        generatedAt: '2026-08-23T12:00:00+08:00',
        ruleVersion: 'limit-ladder-v6',
        stage: 'pending',
        auctionSnapshotAvailable: false,
        candidates: [],
        warnings: [],
        relayPlan: {
          status: 'research-score',
          signalDate: '2026-08-21',
          tradeDate: '2026-08-24',
          generatedAt: '2026-08-23T12:00:00+08:00',
          stage: 'pending',
          items: [{
            code: v2Leader.code,
            name: v2Leader.name,
            boards: v2Leader.consecutiveDays,
            promotionLane: '3进4',
            primaryTheme: '机器人',
            researchTheme: '机器人',
            baseState: 'candidate',
            relayRole: 'emotion-anchor',
            researchPriority: 90,
            executionEligible: false,
            researchReasons: ['一字高标仅作情绪锚点'],
            confirmationConditions: ['机器人板块出现核心与至少一只同题材标的同步增强', '同身位3进4相对强度不落后'],
            invalidationReasons: ['高标断板'],
            noChaseReasons: ['一字不可直接接力'],
            themeFeedback: feedback,
            sameLevelFeedback: feedback,
          }],
          warnings: ['当前阶段尚未产生本交易日竞价/开盘快照'],
        },
      } as unknown as LimitLadderNextDay,
      error: null,
    })
    render(<LadderView t={zh} language="zh" />)
    const panel = screen.getByLabelText('次日接力计划')
    expect(within(panel).getByText('情绪/空间锚点')).toBeInTheDocument()
    expect(within(panel).getByText('不可执行/仅观察')).toBeInTheDocument()
    expect(within(panel).getAllByText('不可用').length).toBeGreaterThanOrEqual(2)
    expect(within(panel).queryByText('情绪高标')).not.toBeInTheDocument()
    expect(within(panel).getByText('2026-08-24')).toBeInTheDocument()
  })
  it('switches research mode to the stock list immediately below the toolbar', async () => {
    vi.mocked(useLadderAnalysis).mockReturnValue({
      data: v2Data,
      loading: false,
      error: null,
      refresh,
      importData,
    })
    vi.mocked(useLadderNextDay).mockReturnValue({ data: null, error: null })
    const user = userEvent.setup()
    render(<LadderView t={zh} language="zh" />)

    expect(screen.getByLabelText(zh.ladder.v2.lanes)).toBeInTheDocument()
    expect(screen.getByLabelText(zh.ladder.v2.candidates)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: zh.ladder.list }))

    expect(screen.queryByLabelText(zh.ladder.v2.lanes)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(zh.ladder.v2.candidates)).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: zh.ladder.table.trigger })).toBeInTheDocument()
  })

  it('renders v3 WeChat brief generation and delivery status', () => {
    vi.mocked(useLadderAnalysis).mockReturnValue({
      data: { ...v2Data, ruleVersion: 'limit-ladder-v3' },
      loading: false,
      error: null,
      refresh,
      importData,
    })
    vi.mocked(useAuctionBriefs).mockReturnValue({
      data: {
        signalDate: '2026-08-11',
        tradeDate: '2026-08-12',
        ruleVersion: 'limit-ladder-v3',
        notification: {
          provider: 'serverchan',
          enabled: true,
          configured: true,
        },
        briefs: [
          {
            id: '2026-08-12:auction-final:limit-ladder-v3',
            signalDate: '2026-08-11',
            tradeDate: '2026-08-12',
            generatedAt: '2026-08-12T01:28:00.000Z',
            ruleVersion: 'limit-ladder-v3',
            phase: 'auction-final',
            title: '2026-08-12 09:28竞价终局',
            summary: '竞价偏强，机器人题材引领。正式候选1只入围。',
            deterministicSummary: '竞价偏强，机器人题材引领。正式候选1只入围。',
            generationMode: 'rules-ai-polished',
            strengthScore: 76,
            strengthLabel: '偏强',
            confidence: 90,
            degraded: false,
            marketStyle: null,
            primaryDirection: '机器人题材引领',
            topAmount: [],
            themes: [],
            candidates: [],
            observations: [],
            coverage: {
              auctionPct: 100,
              confirmationPct: null,
              sourceCount: 2,
            },
            warnings: [],
            renderedText: '**竞价偏强，机器人题材引领。**',
          },
        ],
        deliveries: [
          {
            idempotencyKey: '2026-08-12:auction-final:limit-ladder-v3',
            signalDate: '2026-08-11',
            tradeDate: '2026-08-12',
            phase: 'auction-final',
            provider: 'serverchan',
            status: 'sent',
            attempts: 1,
            createdAt: '2026-08-12T01:28:00.000Z',
            updatedAt: '2026-08-12T01:28:01.000Z',
            sentAt: '2026-08-12T01:28:01.000Z',
            responseTimeMs: 300,
            statusCode: 200,
            providerCode: 0,
            providerMessage: 'ok',
            pushId: 'push-1',
            error: '',
          },
        ],
      },
      error: null,
    })

    render(<LadderView t={zh} language="zh" />)
    const panel = screen.getByLabelText(zh.ladder.v2.auctionBriefs)
    expect(within(panel).getAllByText(zh.ladder.v2.deliveryStates.sent)).toHaveLength(2)
    expect(within(panel).getByText('机器人题材引领')).toBeInTheDocument()
    expect(
      within(panel).getByText(zh.ladder.v2.generationModes['rules-ai-polished']),
    ).toBeInTheDocument()
  })

  it('renders the v6 repair structure, liquidity adjustment and blocked candidate state', () => {
    vi.mocked(useLadderAnalysis).mockReturnValue({
      data: { ...v2Data, ruleVersion: 'limit-ladder-v6' },
      loading: false,
      error: null,
      refresh,
      importData,
    })
    vi.mocked(useLadderNextDay).mockReturnValue({
      data: {
        signalDate: '2026-08-11',
        tradeDate: '2026-08-12',
        generatedAt: '2026-08-12T01:35:00.000Z',
        ruleVersion: 'limit-ladder-v6',
        stage: 'open',
        auctionSnapshotAvailable: true,
        confirmationSnapshotAvailable: true,
        marketGate: {
          signalDate: '2026-08-11',
          tradeDate: '2026-08-12',
          generatedAt: '2026-08-12T01:35:00.000Z',
          phase: 'open',
          state: 'restricted',
          riskScore: 72,
          externalRiskScore: 80,
          domesticRiskScore: 68,
          domesticConfirmed: true,
          premarket: {
            signalDate: '2026-08-11',
            tradeDate: '2026-08-12',
            capturedAt: '2026-08-12T00:50:00.000Z',
            frozenAt: '2026-08-12T00:50:00.000Z',
            late: false,
            state: 'panic',
            riskScore: 80,
            coverage: 90,
            us: [{ code: 'IXIC', name: '纳斯达克', changePct: -3, price: 100 }],
            asia: [{ code: 'KS11', name: '韩国KOSPI', changePct: -4, price: 100 }],
            macro: [
              {
                id: 'us10y',
                value: 4.5,
                previousClose: 4.3,
                changePct: 4.65,
                deltaBps: 20,
              },
            ],
            headlines: [],
            sources: ['eastmoney-us', 'eastmoney-asia', 'macro-live'],
            reasons: ['纳指-3.00%'],
            warnings: [],
          },
          domestic: null,
          repairContext: {
            state: 'weight-led-repair',
            capturedAt: '2026-08-12T01:25:00.000Z',
            applicable: true,
            confidence: 100,
            largeCapChangePct: 0.6,
            smallCapChangePct: -0.2,
            sizeSpreadPct: 0.8,
            advanceRate: 40,
            largeCapAuctionAmountSharePct: 65,
            highBoardState: 'contraction',
            reasons: ['大盘相对小盘+0.80pct'],
            warnings: [],
          },
          themePermissions: [
            {
              theme: v2Leader.primaryTheme,
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
        },
        candidates: [
          {
            code: v2Leader.code,
            name: v2Leader.name,
            baseState: 'candidate',
            promotionLane: '3进4',
            baseScore: 79.4,
            promotionScore: 83,
            tradabilityScore: 74,
            auctionScore: 76,
            openScore: 81,
            liveScore: 79,
            environmentAdjustment: -8,
            sizeBucket: 'small',
            liquidityStyleAdjustment: -8,
            styleGateReasons: ['权重拉指数、市场宽度偏弱'],
            decisionScore: 71,
            marketGateState: 'restricted',
            themePermission: {
              theme: v2Leader.primaryTheme,
              riskClass: 'high-beta',
              state: 'blocked',
              score: 40,
              independentStrength: false,
              directionScore: 40,
              positiveRate: 30,
              assistantCount: 0,
              environmentAdjustment: -8,
              reasons: ['高Beta/利率敏感题材'],
            },
            state: 'blocked',
            tradeDate: '2026-08-12',
            quoteTime: '09:35:10',
            openGapPct: 3,
            auctionAmount: 5e7,
            currentAmount: 1.5e8,
            currentPrice: 11.3,
            vwap: 11.1,
            inaccessible: false,
            warnings: [],
          },
        ],
        warnings: [],
      },
      error: null,
    })

    render(<LadderView t={zh} language="zh" />)
    expect(screen.getByLabelText(zh.ladder.v5.marketGate)).toBeInTheDocument()
    expect(screen.getByText(zh.ladder.v5.gateStates.restricted)).toBeInTheDocument()
    expect(screen.getByLabelText(zh.ladder.v6.repairStructure)).toHaveTextContent(
      zh.ladder.v6.repairStates['weight-led-repair'],
    )
    expect(screen.getByRole('columnheader', { name: zh.ladder.v6.sizeBucket })).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: zh.ladder.v6.liquidityStyleAdjustment }),
    ).toBeInTheDocument()
    expect(screen.getByText(zh.ladder.v6.sizeBuckets.small)).toBeInTheDocument()
    expect(screen.getByText(zh.ladder.v2.nextStates.blocked)).toBeInTheDocument()
    expect(screen.getAllByText('-8.0')).toHaveLength(2)
  })

  it('renders v4 role, event-gate and high-board risk panels', () => {
    const roleProfile = {
      code: v2Leader.code,
      name: v2Leader.name,
      primaryTheme: v2Leader.primaryTheme,
      themes: v2Leader.themes,
      boards: 3,
      marketRole: 'space-leader' as const,
      themeRole: 'theme-position-leader' as const,
      heightTier: 'high' as const,
      lifecycle: 'divergence' as const,
      onePrice: false,
      positionDelta: 0,
      peerCodes: [],
      leadingDays: 2,
      cardedCodes: [],
      wasCardedBy: [],
      followerCount: 2,
      confidence: 90,
      evidence: ['3板，空间龙'],
    }
    const riskEvent = {
      id: 'risk-1',
      publishedAt: '2026-08-11T07:00:00.000Z',
      source: 'exchange',
      sourceUrl: '',
      title: '相关账户异常交易被限制交易',
      summary: '',
      codes: [v2Leader.code],
      themes: ['机器人'],
      scope: 'stock' as const,
      category: 'regulatory-restriction',
      direction: 'negative' as const,
      severity: 4 as const,
      confidence: 'official' as const,
      action: 'risk-cap' as const,
      effectiveUntil: '2026-08-18T07:00:00.000Z',
      evidence: [],
    }
    vi.mocked(useLadderAnalysis).mockReturnValue({
      data: {
        ...v2Data,
        ruleVersion: 'limit-ladder-v4',
        roleMap: {
          maxBoards: 3,
          spaceLeaderCodes: [v2Leader.code],
          profiles: [roleProfile],
          brokenAnchors: [],
        },
        riskEvents: [riskEvent],
        eventGate: {
          generatedAt: '2026-08-11T07:10:00.000Z',
          coverage: 100,
          sourceStatus: { announcement: true },
          events: [riskEvent],
          hardBlockedCodes: [],
          riskCappedCodes: [v2Leader.code],
          themeAdjustments: {},
          marketRisk: 'elevated',
          warnings: [],
        },
      },
      loading: false,
      error: null,
      refresh,
      importData,
    })
    vi.mocked(useLadderNextDay).mockReturnValue({
      data: {
        signalDate: '2026-08-11',
        tradeDate: '2026-08-12',
        generatedAt: '2026-08-12T01:35:00.000Z',
        ruleVersion: 'limit-ladder-v4',
        stage: 'open',
        auctionSnapshotAvailable: true,
        confirmationSnapshotAvailable: true,
        highBoardContext: {
          capturedAt: '2026-08-12T01:35:00.000Z',
          phase: 'open',
          score: 22,
          state: 'panic',
          confidence: 80,
          metrics: {
            sampleSize: 5,
            positiveRate: 20,
            nuclearRate: 60,
            onePriceRetentionRate: 30,
            weightedGapPct: -5,
            processStrength: 25,
            vwapHoldRate: 20,
            waterfallRate: 60,
            resealRate: 0,
          },
          members: [],
          themes: [
            {
              theme: '机器人',
              score: 65,
              state: 'divergence',
              confidence: 70,
              sampleSize: 3,
              highLowSwitch: true,
            },
          ],
          warnings: [],
        },
        eventReaction: {
          state: 'amplified',
          score: 10,
          affectedCodes: [v2Leader.code],
          positiveCodes: [],
          negativeCodes: [v2Leader.code],
          evidence: [],
        },
        candidates: [],
        warnings: [],
      },
      error: null,
    })

    render(<LadderView t={zh} language="zh" />)
    expect(screen.getByLabelText(zh.ladder.v4.roleMap)).toHaveTextContent(
      zh.ladder.v4.marketRoles['space-leader'],
    )
    expect(screen.getByLabelText(zh.ladder.v4.riskRadar)).toBeInTheDocument()
    expect(screen.getByText(riskEvent.title)).toBeInTheDocument()
    expect(screen.getByLabelText(zh.ladder.v4.highBoardRisk)).toBeInTheDocument()
    expect(screen.getByText(zh.ladder.v4.appetiteStates.panic)).toBeInTheDocument()
    expect(screen.getByText(zh.ladder.v4.highLowSwitch)).toBeInTheDocument()
  })
})
