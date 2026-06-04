import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import Dashboard from './Dashboard'
import { StoreProvider } from '../store'
import type { Translation, TradeGroup } from '../types'
import en from '../i18n/en'

const t = en as Translation

// Mock recharts since it doesn't work well in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => <div data-testid="area" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar">{children}</div>
  ),
  Cell: () => <div data-testid="cell" />,
}))

// Mock the store with controlled data
// Use recent dates so they fall within default month/week range filters
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
  {
    id: 'tg-004',
    code: '601318',
    name: 'Ping An',
    opened: '2026-05-11',
    closed: null,
    pnl: -1180,
    returnRate: -1.8,
    days: 15,
    totalFee: 12.6,
    strategy: 'Reversal',
    mistakes: ['Oversized position'],
    status: 'Not reviewed',
  },
]

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

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders metric cards', () => {
    render(<Dashboard t={t} />)
    // Check for metric labels from translation
    expect(screen.getByText('Realized PnL')).toBeInTheDocument()
    expect(screen.getByText('Win Rate')).toBeInTheDocument()
    expect(screen.getByText('Payoff Ratio')).toBeInTheDocument()
    expect(screen.getByText('Total Fees')).toBeInTheDocument()
  })

  it('renders the equity curve section', () => {
    render(<Dashboard t={t} />)
    expect(screen.getByText('Equity Curve')).toBeInTheDocument()
    expect(
      screen.getByText('Realized PnL trend from closed trade groups.'),
    ).toBeInTheDocument()
  })

  it('renders the risk alerts section', () => {
    render(<Dashboard t={t} />)
    expect(screen.getByText('Risk Alerts')).toBeInTheDocument()
    expect(screen.getByText('Behavior issues that need review.')).toBeInTheDocument()
  })

  it('renders the recent trade groups section', () => {
    render(<Dashboard t={t} />)
    expect(screen.getByText('Recent Trade Groups')).toBeInTheDocument()
    expect(
      screen.getByText('Closed and active stock-level trade cycles.'),
    ).toBeInTheDocument()
  })

  it('renders trade group names in the table', () => {
    render(<Dashboard t={t} />)
    expect(screen.getByText('CATL')).toBeInTheDocument()
    expect(screen.getByText('Kweichow Moutai')).toBeInTheDocument()
    expect(screen.getByText('BYD')).toBeInTheDocument()
    expect(screen.getByText('Ping An')).toBeInTheDocument()
  })

  it('renders the View all button', () => {
    render(<Dashboard t={t} />)
    expect(screen.getByText('View all')).toBeInTheDocument()
  })

  it('computes and displays positive total PnL', () => {
    render(<Dashboard t={t} />)
    // Closed groups: CATL (8460) + Moutai (-3920) + BYD (5260) = 9800
    // The total appears in both the metric card and the status pill.
    expect(screen.getAllByText('+¥9,800').length).toBeGreaterThan(0)
  })

  it('renders the equity chart container', () => {
    render(<Dashboard t={t} />)
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument()
    expect(screen.getByTestId('area-chart')).toBeInTheDocument()
  })

  it('renders an alert for late stop loss mistakes', () => {
    render(<Dashboard t={t} />)
    // The mock has 'Late stop loss' mistake, so an alert should appear
    expect(screen.getByText('止损拖延')).toBeInTheDocument()
  })

  it('renders an alert for open losers', () => {
    render(<Dashboard t={t} />)
    // Ping An is open with negative PnL
    expect(screen.getByText('未平亏损')).toBeInTheDocument()
  })

  it('applies range filter when range prop is provided', () => {
    // With a very narrow range, some groups may be filtered out
    render(<Dashboard t={t} range="week" />)
    // Should still render the dashboard structure
    expect(screen.getByText('Equity Curve')).toBeInTheDocument()
  })

  it('renders PnL values with correct formatting in trade table', () => {
    render(<Dashboard t={t} />)
    // CATL pnl: +8,460
    expect(screen.getByText('+¥8,460')).toBeInTheDocument()
  })
})
