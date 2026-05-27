import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MacroBanner from './MacroBanner'
import type { Translation } from '../types'
import type { MacroIndicator, MacroDataResult } from '../hooks/useMacroData'
import en from '../i18n/en'

const t = en as Translation

const mockData: MacroIndicator[] = [
  { id: 'us10y', value: 4.38, previousClose: 4.35, unit: '%' },
  { id: 'us5y', value: 4.02, previousClose: 3.99, unit: '%' },
  { id: 'gold', value: 3285, previousClose: 3268, unit: 'USD/oz' },
  { id: 'dxy', value: 104.5, previousClose: 104.2, unit: '' },
  { id: 'usdcny', value: 7.245, previousClose: 7.238, unit: '' },
  { id: 'crude', value: 78.5, previousClose: 77.8, unit: 'USD/桶' },
  { id: 'vix', value: 18.5, previousClose: 19.2, unit: '' },
]

const defaultResult: MacroDataResult = {
  data: mockData,
  loading: false,
  error: null,
  lastUpdated: new Date('2026-05-26T10:00:00'),
  refresh: vi.fn(),
}

let hookResult: MacroDataResult = { ...defaultResult }
vi.mock('../hooks/useMacroData', () => ({
  useMacroData: () => hookResult,
}))

describe('MacroBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookResult = { ...defaultResult, refresh: vi.fn() }
    localStorage.clear()
  })

  it('renders all macro indicators when data is available', () => {
    render(<MacroBanner t={t} />)
    expect(screen.getByText('US 10Y Yield')).toBeInTheDocument()
    expect(screen.getByText('US 5Y Yield')).toBeInTheDocument()
    expect(screen.getByText('Gold')).toBeInTheDocument()
    expect(screen.getByText('US Dollar Index')).toBeInTheDocument()
    expect(screen.getByText('USD/CNY')).toBeInTheDocument()
    expect(screen.getByText('WTI Crude')).toBeInTheDocument()
    expect(screen.getByText('VIX')).toBeInTheDocument()
  })

  it('formats percentage values correctly', () => {
    render(<MacroBanner t={t} />)
    expect(screen.getByText('4.38%')).toBeInTheDocument()
    expect(screen.getByText('4.02%')).toBeInTheDocument()
  })

  it('formats gold price with USD prefix', () => {
    render(<MacroBanner t={t} />)
    expect(screen.getByText('$3285')).toBeInTheDocument()
  })

  it('formats crude oil price', () => {
    render(<MacroBanner t={t} />)
    expect(screen.getByText('$78.50')).toBeInTheDocument()
  })

  it('formats USD/CNY to 4 decimal places', () => {
    render(<MacroBanner t={t} />)
    expect(screen.getByText('7.2450')).toBeInTheDocument()
  })

  it('formats VIX to 1 decimal place', () => {
    render(<MacroBanner t={t} />)
    expect(screen.getByText('18.5')).toBeInTheDocument()
  })

  it('shows change percentages with correct direction', () => {
    render(<MacroBanner t={t} />)
    // US 10Y: (4.38 - 4.35) / 4.35 * 100 = 0.69%
    expect(screen.getByText(/0\.69%/)).toBeInTheDocument()
    // VIX: (18.5 - 19.2) / 19.2 * 100 = -3.65%
    expect(screen.getByText(/-3\.65%/)).toBeInTheDocument()
  })

  it('renders loading skeleton when loading and no data', () => {
    hookResult = { data: [], loading: true, error: null, lastUpdated: null, refresh: vi.fn() }
    const { container } = render(<MacroBanner t={t} />)
    expect(container.querySelectorAll('.macro-skeleton').length).toBeGreaterThan(0)
  })

  it('renders empty state when no data and not loading', () => {
    hookResult = { data: [], loading: false, error: null, lastUpdated: null, refresh: vi.fn() }
    render(<MacroBanner t={t} />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('calls refresh when retry button is clicked in empty state', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn()
    hookResult = { data: [], loading: false, error: null, lastUpdated: null, refresh }
    render(<MacroBanner t={t} />)
    await user.click(screen.getByText('Retry'))
    expect(refresh).toHaveBeenCalled()
  })

  it('displays error message when error is present', () => {
    hookResult = { ...defaultResult, error: 'Network error' }
    render(<MacroBanner t={t} />)
    expect(screen.getByText('Failed to load')).toBeInTheDocument()
  })

  it('displays last updated time', () => {
    render(<MacroBanner t={t} />)
    // The text is "Updated {time}" in a single span
    expect(screen.getByText((content) => content.startsWith('Updated'))).toBeInTheDocument()
  })

  it('shows demo badge when no API key is set', () => {
    render(<MacroBanner t={t} />)
    expect(screen.getByText('Using demo data')).toBeInTheDocument()
  })

  it('does not show demo badge when API key exists', () => {
    localStorage.setItem('macro-api-key', 'test-key')
    render(<MacroBanner t={t} />)
    expect(screen.queryByText('Using demo data')).not.toBeInTheDocument()
  })

  it('opens settings panel when settings button is clicked', async () => {
    const user = userEvent.setup()
    render(<MacroBanner t={t} />)
    // The settings button has title="Twelve Data API Key"
    const settingsBtn = screen.getByTitle('Twelve Data API Key')
    await user.click(settingsBtn)
    expect(screen.getByText('Twelve Data API Key')).toBeInTheDocument()
  })

  it('renders links to TradingView for each indicator', () => {
    render(<MacroBanner t={t} />)
    const links = screen.getAllByRole('link')
    const goldLink = links.find((l) => l.getAttribute('href')?.includes('GOLD'))
    expect(goldLink).toBeDefined()
    expect(goldLink?.getAttribute('target')).toBe('_blank')
  })

  it('refresh button calls refresh', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn()
    hookResult = { ...defaultResult, refresh }
    render(<MacroBanner t={t} />)
    // The refresh button has aria-label "Retry"
    const refreshBtn = screen.getByRole('button', { name: 'Retry' })
    await user.click(refreshBtn)
    expect(refresh).toHaveBeenCalled()
  })
})
