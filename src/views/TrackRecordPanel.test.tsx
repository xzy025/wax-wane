import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TrackRecordPanel from './TrackRecordPanel'
import type { Translation } from '../types'
import en from '../i18n/en'
import type {
  Metrics,
  ScreenerForwardHookResult,
  ScreenerForwardResult,
} from '../hooks/useScreenerForward'

const t = en as Translation

const metrics = (over: Partial<Metrics> = {}): Metrics => ({
  n: 0, winRate: 0, avgRetPct: 0, avgWinPct: 0, avgLossPct: 0, payoff: 0,
  profitFactor: 0, expectancyR: 0, maxDDR: 0, avgHoldBars: 0, targetRate: 0, stopRate: 0, timeRate: 0,
  ...over,
})

const sampleResult = (): ScreenerForwardResult => ({
  asof: '2026-06-29',
  generatedAt: '2026-06-29T08:00:00.000Z',
  hold: 20,
  snapshotCount: 6,
  dateRange: ['2026-06-22', '2026-06-28'],
  totalPicks: 3,
  pendingCount: 1,
  overall: metrics({ n: 1, winRate: 100, expectancyR: 2, profitFactor: 3, avgHoldBars: 2 }),
  strategies: [
    {
      group: 'breakout',
      closed: metrics({ n: 1, winRate: 100, expectancyR: 2, profitFactor: 3, avgHoldBars: 2 }),
      closedCount: 1,
      openCount: 1,
      pendingCount: 1,
      sampleConfidence: 'low',
      unrealizedAvgR: 0.5,
      backtestExpectancyR: 0.08,
      picks: [
        { asof: '2026-06-24', group: 'breakout', code: '600519', name: '贵州茅台', entry: 10, stop: 9, target: 12, status: 'closed', exit: 12, exitDate: '2026-06-26', reason: 'target', R: 2, retPct: 20, barsHeld: 2, barsElapsed: 2 },
        { asof: '2026-06-25', group: 'breakout', code: '000001', name: '平安银行', entry: 10, stop: 9, target: 12, status: 'open', exit: 10.5, exitDate: '2026-06-26', reason: 'open', R: 0.5, retPct: 5, barsHeld: 1, barsElapsed: 1 },
        { asof: '2026-06-26', group: 'breakout', code: '000002', name: '万科A', entry: 10, stop: 9, target: 12, status: 'pending', exit: 0, exitDate: '', reason: 'pending', R: 0, retPct: 0, barsHeld: 0, barsElapsed: 0 },
      ],
    },
  ],
})

const hook = (over: Partial<ScreenerForwardHookResult> = {}): ScreenerForwardHookResult => ({
  data: sampleResult(),
  loading: false,
  error: null,
  lastUpdated: new Date('2026-06-29T08:00:00.000Z'),
  refresh: vi.fn(),
  ...over,
})

describe('TrackRecordPanel', () => {
  it('渲染每战法汇总 + 回测对照,picks 默认折叠、点击展开', async () => {
    render(<TrackRecordPanel fwd={hook()} t={t} />)

    // 汇总行 + 战法行存在
    expect(screen.getByText('All strategies')).toBeInTheDocument()
    expect(screen.getByText('Breakout')).toBeInTheDocument()
    // 回测期望R 对照列(0.08R)
    expect(screen.getByText('+0.08R')).toBeInTheDocument()

    // picks 默认折叠
    expect(screen.queryByText('贵州茅台')).not.toBeInTheDocument()

    // 点击战法行 → 展开明细
    await userEvent.click(screen.getByText('Breakout'))
    expect(screen.getByText('贵州茅台')).toBeInTheDocument()
    expect(screen.getByText('600519')).toBeInTheDocument()
    // 三种状态标签都出现(Open/Pending 同时作状态与出场原因出现 → getAllByText)
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
    // 出场原因「Target」(closed pick)
    expect(screen.getByText('Target')).toBeInTheDocument()
  })

  it('无可评估存档 → 空态提示', () => {
    const empty = sampleResult()
    empty.strategies = []
    render(<TrackRecordPanel fwd={hook({ data: empty })} t={t} />)
    expect(screen.getByText(t.screener.track.empty)).toBeInTheDocument()
  })

  it('加载中 / 加载失败 文案', () => {
    const { rerender } = render(<TrackRecordPanel fwd={hook({ data: null, loading: true })} t={t} />)
    expect(screen.getByText(t.screener.track.refreshing)).toBeInTheDocument()
    rerender(<TrackRecordPanel fwd={hook({ data: null, error: 'boom' })} t={t} />)
    expect(screen.getByText(t.screener.track.loadFail)).toBeInTheDocument()
  })
})
