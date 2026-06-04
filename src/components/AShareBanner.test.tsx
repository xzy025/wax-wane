import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AShareBanner from './AShareBanner'
import type { Translation } from '../types'
import type { AShareData, AShareResult } from '../hooks/useAShareData'
import en from '../i18n/en'

const t = en as Translation

// Default mock data
const mockData: AShareData = {
  indices: [
    {
      code: '000001',
      name: 'Shanghai',
      price: 3350.59,
      changePct: -0.31,
      changeAmt: -10.58,
      volume: 2938192,
      turnover: 358628340000,
      high: 3365.2,
      low: 3340.1,
      open: 3355.0,
      prevClose: 3361.17,
    },
    {
      code: '399001',
      name: 'Shenzhen',
      price: 11121.95,
      changePct: 0.39,
      changeAmt: 43.44,
      volume: 4291266,
      turnover: 502516180000,
      high: 11200.0,
      low: 11080.0,
      open: 11180.0,
      prevClose: 11165.39,
    },
    {
      code: '399006',
      name: 'ChiNext',
      price: 2175.66,
      changePct: 0.12,
      changeAmt: 2.61,
      volume: 1823456,
      turnover: 210000000000,
      high: 2185.0,
      low: 2165.0,
      open: 2170.0,
      prevClose: 2173.05,
    },
  ],
  limitUpCount: 65,
  limitDownCount: 12,
  advance: 2800,
  decline: 2100,
  flat: 300,
  promotionRate: 35,
  promotedCount: 21,
  promotionTotal: 60,
  newHighCount: 3,
  newHighStocks: [
    { code: '300196', name: 'StockA', price: 23.92, changePct: 3.55 },
    { code: '688001', name: 'StockB', price: 82.55, changePct: 2.18 },
  ],
  volumeHistory: [
    { date: '05-23', volume: 18234567, turnover: 2876543210000 },
    { date: '05-26', volume: 21123456, turnover: 3234567890000 },
    { date: '05-27', volume: 16987654, turnover: 2676543210000 },
  ],
}

const defaultResult: AShareResult = {
  data: mockData,
  loading: false,
  error: null,
  lastUpdated: new Date('2026-05-26T10:00:00'),
  refresh: vi.fn(),
}

// Mock the hook
let hookResult: AShareResult = { ...defaultResult }
vi.mock('../hooks/useAShareData', () => ({
  useAShareData: () => hookResult,
  calcProfitabilityScore: (limitUp: number, limitDown: number, advance: number, decline: number) => {
    const limitRatio = limitUp / Math.max(limitDown, 1)
    const adRatio = advance / Math.max(decline, 1)
    const cappedLimit = Math.min(limitRatio, 5)
    const cappedAD = Math.min(adRatio, 5)
    const limitBonus = Math.min(limitUp, 100) / 100
    return Math.round((cappedLimit / 5) * 40 + (cappedAD / 5) * 40 + limitBonus * 20)
  },
}))

describe('AShareBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookResult = { ...defaultResult, refresh: vi.fn() }
  })

  it('renders index cards when data is available', () => {
    render(<AShareBanner t={t} />)
    // Should show Shanghai, Shenzhen, ChiNext
    expect(screen.getByText('Shanghai')).toBeInTheDocument()
    expect(screen.getByText('Shenzhen')).toBeInTheDocument()
    expect(screen.getByText('ChiNext')).toBeInTheDocument()
  })

  it('renders index prices', () => {
    render(<AShareBanner t={t} />)
    expect(screen.getByText('3350.59')).toBeInTheDocument()
    expect(screen.getByText('11121.95')).toBeInTheDocument()
    expect(screen.getByText('2175.66')).toBeInTheDocument()
  })

  it('renders change percentages with correct sign', () => {
    render(<AShareBanner t={t} />)
    // -0.31% should not have a '+' prefix
    expect(screen.getByText(/-0.31%/)).toBeInTheDocument()
    // +0.39% should have a '+' prefix
    expect(screen.getByText(/\+0.39%/)).toBeInTheDocument()
  })

  it('renders sentiment indicators when data is available', () => {
    render(<AShareBanner t={t} />)
    expect(screen.getByText('Limit Up')).toBeInTheDocument()
    expect(screen.getByText('Limit Down')).toBeInTheDocument()
    expect(screen.getByText('65')).toBeInTheDocument() // limitUpCount
    expect(screen.getByText('12')).toBeInTheDocument() // limitDownCount
  })

  it('renders advance/decline counts', () => {
    render(<AShareBanner t={t} />)
    // Advance and decline are rendered in separate <span>s split by "/".
    expect(screen.getByText('2800')).toBeInTheDocument()
    expect(screen.getByText('2100')).toBeInTheDocument()
  })

  it('renders A/D ratio', () => {
    render(<AShareBanner t={t} />)
    // 2800/2100 = 1.33
    expect(screen.getByText('1.33')).toBeInTheDocument()
  })

  it('renders profitability score', () => {
    render(<AShareBanner t={t} />)
    expect(screen.getByText('/100')).toBeInTheDocument()
  })

  it('renders loading skeleton when loading and no data', () => {
    hookResult = { data: null, loading: true, error: null, lastUpdated: null, refresh: vi.fn() }
    const { container } = render(<AShareBanner t={t} />)
    expect(container.querySelectorAll('.macro-skeleton').length).toBeGreaterThan(0)
  })

  it('renders empty state with retry button when no data and not loading', () => {
    hookResult = { data: null, loading: false, error: null, lastUpdated: null, refresh: vi.fn() }
    render(<AShareBanner t={t} />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('calls refresh when retry button is clicked in empty state', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn()
    hookResult = { data: null, loading: false, error: null, lastUpdated: null, refresh }
    render(<AShareBanner t={t} />)
    await user.click(screen.getByText('Retry'))
    expect(refresh).toHaveBeenCalled()
  })

  it('renders refresh button in meta bar', () => {
    render(<AShareBanner t={t} />)
    const refreshBtn = screen.getByRole('button', { name: 'Retry' })
    expect(refreshBtn).toBeInTheDocument()
  })

  it('displays error message when error is present', () => {
    hookResult = {
      ...defaultResult,
      error: 'Failed to fetch A-share data',
    }
    render(<AShareBanner t={t} />)
    expect(screen.getByText('Failed to load')).toBeInTheDocument()
  })

  it('displays last updated time when available', () => {
    render(<AShareBanner t={t} />)
    // The text is "Updated {time}" in a single span
    expect(screen.getByText((content) => content.startsWith('Updated'))).toBeInTheDocument()
  })

  it('toggles new high stock list on click', async () => {
    const user = userEvent.setup()
    render(<AShareBanner t={t} />)

    // Initially collapsed - stock list should not be visible
    expect(screen.queryByText('StockA')).not.toBeInTheDocument()

    // Click the new high stat to expand
    const newHighStat = screen.getByText('3').closest('[role="button"]')
    if (newHighStat) {
      await user.click(newHighStat)
      expect(screen.getByText('StockA')).toBeInTheDocument()
      expect(screen.getByText('StockB')).toBeInTheDocument()
    }
  })

  it('renders promotion rate data', () => {
    render(<AShareBanner t={t} />)
    expect(screen.getByText('Promotion Rate')).toBeInTheDocument()
    expect(screen.getByText(/21\/60/)).toBeInTheDocument()
  })

  it('renders links to eastmoney for each index', () => {
    render(<AShareBanner t={t} />)
    const links = screen.getAllByRole('link')
    const shLink = links.find((l) => l.getAttribute('href')?.includes('zs000001'))
    expect(shLink).toBeDefined()
    expect(shLink?.getAttribute('target')).toBe('_blank')
  })
})
