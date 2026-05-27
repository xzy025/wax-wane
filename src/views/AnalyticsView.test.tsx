import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AnalyticsView from './AnalyticsView'
import type { Translation, TradeGroup } from '../types'
import en from '../i18n/en'

const t = en as Translation

// Use recent dates so they fall within the default month/week range
const mockTradeGroups: TradeGroup[] = [
  {
    id: 'tg-001',
    code: '300750',
    name: 'CATL',
    opened: '2026-05-04',
    closed: '2026-05-18',
    pnl: 8460,
    returnRate: 9.4,
    days: 14,
    totalFee: 324.6,
    strategy: 'Pullback',
    mistakes: ['Early profit taking'],
    status: 'Reviewed',
  },
  {
    id: 'tg-002',
    code: '600519',
    name: 'Kweichow Moutai',
    opened: '2026-05-12',
    closed: '2026-05-21',
    pnl: -3920,
    returnRate: -3.1,
    days: 9,
    totalFee: 204.8,
    strategy: 'Index beta',
    mistakes: ['No plan', 'Late stop loss'],
    status: 'Follow up',
  },
  {
    id: 'tg-003',
    code: '002594',
    name: 'BYD',
    opened: '2026-05-02',
    closed: '2026-05-09',
    pnl: 5260,
    returnRate: 6.6,
    days: 7,
    totalFee: 152.0,
    strategy: 'Breakout',
    mistakes: [],
    status: 'Reviewed',
  },
]

// Mock recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar">{children}</div>
  ),
  Cell: () => <div data-testid="cell" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
}))

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>()
  return {
    ...actual,
    useAppState: () => ({
      trades: [],
      tradeGroups: mockTradeGroups,
      reviewNotes: {},
      importBatches: [],
    }),
    useAppDispatch: () => vi.fn(),
  }
})

describe('AnalyticsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock clipboard API (not available in jsdom)
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    })
  })

  it('renders the mistake attribution section', () => {
    render(<AnalyticsView t={t} />)
    expect(screen.getByText('Mistake Attribution')).toBeInTheDocument()
    expect(
      screen.getByText('Loss and frequency by behavior tag.'),
    ).toBeInTheDocument()
  })

  it('renders the holding period section', () => {
    render(<AnalyticsView t={t} />)
    expect(screen.getByText('Holding Period')).toBeInTheDocument()
    expect(
      screen.getByText('Closed trade distribution by days held.'),
    ).toBeInTheDocument()
  })

  it('renders the monthly review summary section', () => {
    render(<AnalyticsView t={t} />)
    expect(screen.getByText('Monthly Review Summary')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Generated from closed groups, fees, notes, and tags.',
      ),
    ).toBeInTheDocument()
  })

  it('renders discipline score', () => {
    render(<AnalyticsView t={t} />)
    expect(screen.getByText('Discipline score')).toBeInTheDocument()
    // The score is rendered as "{score} / 100" in a <strong> element (not in the report text)
    const strongElements = screen.getAllByText((content) => content.includes('/ 100'))
    // Should have at least one <strong> element with the score
    const scoreElement = strongElements.find(el => el.tagName === 'STRONG')
    expect(scoreElement).toBeInTheDocument()
  })

  it('renders period toggle buttons', () => {
    render(<AnalyticsView t={t} />)
    expect(screen.getByText('周报')).toBeInTheDocument()
    expect(screen.getByText('月报')).toBeInTheDocument()
  })

  it('defaults to monthly report', () => {
    render(<AnalyticsView t={t} />)
    const monthBtn = screen.getByText('月报')
    expect(monthBtn).toHaveClass('active')
  })

  it('switches to weekly report when clicked', async () => {
    const user = userEvent.setup()
    render(<AnalyticsView t={t} />)
    await user.click(screen.getByText('周报'))
    const weekBtn = screen.getByText('周报')
    expect(weekBtn).toHaveClass('active')
  })

  it('renders report content for closed groups', () => {
    render(<AnalyticsView t={t} />)
    // The report should contain some content about the closed groups
    expect(screen.getByText(/交易复盘报告/)).toBeInTheDocument()
  })

  it('renders the copy button for reports', () => {
    render(<AnalyticsView t={t} />)
    const copyBtn = screen.getByTitle('复制报告')
    expect(copyBtn).toBeInTheDocument()
  })

  it('copies report to clipboard when copy button is clicked', async () => {
    const user = userEvent.setup()
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    })
    render(<AnalyticsView t={t} />)
    await user.click(screen.getByTitle('复制报告'))
    expect(writeTextMock).toHaveBeenCalled()
  })

  it('renders bar chart for mistake data', () => {
    render(<AnalyticsView t={t} />)
    // Should render chart containers
    const containers = screen.getAllByTestId('responsive-container')
    expect(containers.length).toBeGreaterThan(0)
  })

  it('renders holding period chart when closed groups exist', () => {
    render(<AnalyticsView t={t} />)
    // When closed groups exist, the component renders a chart (mocked as responsive-container)
    const containers = screen.getAllByTestId('responsive-container')
    expect(containers.length).toBeGreaterThan(0)
  })

  it('renders report text with trade statistics', () => {
    render(<AnalyticsView t={t} />)
    // Report is rendered in a <pre> with multi-line text; use function matcher
    const pre = screen.getByText((content) => content.includes('闭环交易') && content.includes('3 笔'))
    expect(pre).toBeInTheDocument()
  })

  it('renders win rate in report', () => {
    render(<AnalyticsView t={t} />)
    // 2 winners out of 3 = 66.7%
    const pre = screen.getByText((content) => content.includes('胜率') && content.includes('66.7%'))
    expect(pre).toBeInTheDocument()
  })

  it('renders discipline score in report', () => {
    render(<AnalyticsView t={t} />)
    expect(screen.getByText((content) => content.includes('纪律评分'))).toBeInTheDocument()
  })

  it('renders total PnL in report', () => {
    render(<AnalyticsView t={t} />)
    // Total: 8460 + (-3920) + 5260 = 9800
    expect(screen.getByText((content) => content.includes('+¥9,800'))).toBeInTheDocument()
  })

  it('renders mistake names in report when present', () => {
    render(<AnalyticsView t={t} />)
    // The report should mention mistakes
    expect(screen.getByText((content) => content.includes('高频错误'))).toBeInTheDocument()
  })
})
