import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LadderView from './LadderView'
import zh from '../i18n/zh'
import type { LadderStockAnalysis, LimitLadderAnalysis } from '../hooks/useLadderAnalysis'

const refresh = vi.fn()
const importData = vi.fn()

vi.mock('../hooks/useLadderAnalysis', async () => {
  const actual = await vi.importActual('../hooks/useLadderAnalysis')
  return { ...actual, useLadderAnalysis: vi.fn(), useLadderReason: vi.fn() }
})

import { useLadderAnalysis, useLadderReason } from '../hooks/useLadderAnalysis'

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

describe('LadderView', () => {
  beforeEach(() => {
    vi.mocked(useLadderAnalysis).mockReturnValue({
      data,
      loading: false,
      error: null,
      refresh,
      importData,
    })
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
    expect(screen.getByText('机器人龙头')).toBeInTheDocument()
    expect(screen.getByText('AI先锋')).toBeInTheDocument()
    expect(screen.getByText(`${zh.ladder.firstBoard} (1)`)).toBeInTheDocument()
    expect(screen.getAllByText(zh.ladder.badges.margin).length).toBeGreaterThan(0)
    expect(screen.getByText(zh.ladder.badges.chiNext)).toBeInTheDocument()
    expect(screen.getAllByText(`${zh.ladder.firstSealShort}09:40`).length).toBeGreaterThan(0)
  })

  it('switches to the list view and opens evidence details', async () => {
    const user = userEvent.setup()
    render(<LadderView t={zh} language="zh" />)
    await user.click(screen.getByRole('tab', { name: zh.ladder.list }))
    expect(screen.getByRole('columnheader', { name: zh.ladder.table.trigger })).toBeInTheDocument()
    await user.click(screen.getByText('机器人龙头'))
    expect(screen.getByText(zh.ladder.detail.evidence)).toBeInTheDocument()
    expect(
      within(screen.getByLabelText(zh.ladder.detail.title)).getByText('守住平台后转强'),
    ).toBeInTheDocument()
    expect(screen.getByText(zh.ladder.detail.limitReason)).toBeInTheDocument()
    expect(screen.getByText('机器人+核心零部件；公司产品进入量产阶段。')).toBeInTheDocument()
  })
})
