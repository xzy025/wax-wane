import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import USBanner from './USBanner'
import type { Translation } from '../types'
import type { USData, USResult } from '../hooks/useUSData'
import en from '../i18n/en'

const t = en as Translation

function quote(code: string, name: string, price = 100, changePct = 1.5) {
  return {
    code,
    name,
    price,
    changePct,
    changeAmt: 1,
    volume: 0,
    turnover: 0,
    high: 0,
    low: 0,
    open: 0,
    prevClose: 0,
  }
}

const mockData: USData = {
  indices: [
    quote('DJI', '道琼斯', 50848.75),
    quote('IXIC', '纳斯达克', 25809.66),
    quote('SPX', '标普500', 7394.3),
  ],
  customStocks: [quote('NVDA', '英伟达', 204.87), quote('TSM', '台积电', 421.07)],
}

const defaultResult: USResult = {
  data: mockData,
  loading: false,
  error: null,
  lastUpdated: new Date('2026-06-12T10:00:00'),
  refresh: vi.fn(),
  refreshCustom: vi.fn(),
}

let hookResult: USResult = { ...defaultResult }
vi.mock('../hooks/useUSData', () => ({
  useUSData: () => hookResult,
}))

vi.mock('../utils/customStocks', () => ({
  addCustomStock: vi.fn(() => true),
  removeCustomStock: vi.fn(),
}))

import { addCustomStock, removeCustomStock } from '../utils/customStocks'

describe('USBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookResult = { ...defaultResult, refresh: vi.fn(), refreshCustom: vi.fn() }
  })

  it('renders the three fixed indices with i18n names and no remove button', () => {
    render(<USBanner t={t} />)
    expect(screen.getByText('Dow Jones')).toBeInTheDocument()
    expect(screen.getByText('NASDAQ')).toBeInTheDocument()
    expect(screen.getByText('S&P 500')).toBeInTheDocument()
    const indexCard = screen.getByText('Dow Jones').closest('a')!
    expect(indexCard.querySelector('.ashare-index-remove')).not.toBeInTheDocument()
  })

  it('renders custom stocks with API names, dollar prices and a remove button', () => {
    render(<USBanner t={t} />)
    expect(screen.getByText('英伟达')).toBeInTheDocument()
    expect(screen.getByText('$204.87')).toBeInTheDocument()
    const card = screen.getByText('英伟达').closest('a')!
    expect(card.querySelector('.ashare-index-remove')).toBeInTheDocument()
  })

  it('removes a stock and refreshes the custom list', async () => {
    const user = userEvent.setup()
    render(<USBanner t={t} />)
    const card = screen.getByText('台积电').closest('a')!
    await user.click(card.querySelector('.ashare-index-remove')!)
    expect(removeCustomStock).toHaveBeenCalledWith('us', 'TSM')
    expect(hookResult.refreshCustom).toHaveBeenCalled()
  })

  it('adds a stock from the top-right input and clears it', async () => {
    const user = userEvent.setup()
    render(<USBanner t={t} />)
    const input = screen.getByPlaceholderText('US ticker')
    await user.type(input, 'tsla')
    await user.click(screen.getByTitle('Add stock'))
    expect(addCustomStock).toHaveBeenCalledWith('us', 'TSLA')
    expect(hookResult.refreshCustom).toHaveBeenCalled()
    expect(input).toHaveValue('')
  })

  it('adds a stock on Enter', async () => {
    const user = userEvent.setup()
    render(<USBanner t={t} />)
    await user.type(screen.getByPlaceholderText('US ticker'), 'AAPL{Enter}')
    expect(addCustomStock).toHaveBeenCalledWith('us', 'AAPL')
  })

  it('still renders index codes outside the config (stale cache)', () => {
    hookResult = {
      ...defaultResult,
      data: { indices: [quote('NVDA', '英伟达')], customStocks: [] },
    }
    render(<USBanner t={t} />)
    expect(screen.getByText('英伟达')).toBeInTheDocument()
  })

  it('shows error state with retry when there is no data', async () => {
    const user = userEvent.setup()
    hookResult = { ...defaultResult, data: null, error: 'boom', refresh: vi.fn() }
    render(<USBanner t={t} />)
    expect(screen.getByText('Failed to load')).toBeInTheDocument()
    await user.click(screen.getByText('Retry'))
    expect(hookResult.refresh).toHaveBeenCalled()
  })
})
