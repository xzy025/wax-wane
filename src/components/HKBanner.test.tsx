import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HKBanner from './HKBanner'
import type { Translation } from '../types'
import type { HKData, HKResult } from '../hooks/useHKData'
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

const mockData: HKData = {
  indices: [
    quote('HSI', '恒生指数', 24718.1),
    quote('HSTECH', '恒生科技指数', 4705.2),
    quote('HCINT', '中概互联网ETF', 1.082),
  ],
  customStocks: [
    quote('00700', '腾讯控股', 463.6),
    quote('09988', '阿里巴巴-W', 110.2),
    quote('300476', '胜宏科技', 327.21),
  ],
}

const defaultResult: HKResult = {
  data: mockData,
  loading: false,
  error: null,
  lastUpdated: new Date('2026-06-12T10:00:00'),
  refresh: vi.fn(),
  refreshCustom: vi.fn(),
}

let hookResult: HKResult = { ...defaultResult }
vi.mock('../hooks/useHKData', () => ({
  useHKData: () => hookResult,
}))

vi.mock('../utils/customStocks', () => ({
  addCustomStock: vi.fn(() => true),
  removeCustomStock: vi.fn(),
}))

import { addCustomStock, removeCustomStock } from '../utils/customStocks'

describe('HKBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookResult = { ...defaultResult, refresh: vi.fn(), refreshCustom: vi.fn() }
  })

  it('renders the three fixed indices with i18n names and no remove button', () => {
    render(<HKBanner t={t} />)
    expect(screen.getByText('HSI')).toBeInTheDocument()
    expect(screen.getByText('Hang Seng TECH')).toBeInTheDocument()
    expect(screen.getByText('China Internet')).toBeInTheDocument()
    const indexCard = screen.getByText('HSI').closest('a')!
    expect(indexCard.querySelector('.ashare-index-remove')).not.toBeInTheDocument()
  })

  it('renders mixed HK and A-share custom stocks with remove buttons', () => {
    render(<HKBanner t={t} />)
    for (const name of ['腾讯控股', '阿里巴巴-W', '胜宏科技']) {
      const card = screen.getByText(name).closest('a')!
      expect(card.querySelector('.ashare-index-remove')).toBeInTheDocument()
    }
  })

  it('links HK stocks to /hk/ pages and A-shares to sh/sz pages', () => {
    render(<HKBanner t={t} />)
    expect(screen.getByText('腾讯控股').closest('a')).toHaveAttribute(
      'href',
      'https://quote.eastmoney.com/hk/00700.html',
    )
    expect(screen.getByText('胜宏科技').closest('a')).toHaveAttribute(
      'href',
      'https://quote.eastmoney.com/sz300476.html',
    )
  })

  it('removes a stock and refreshes the custom list', async () => {
    const user = userEvent.setup()
    render(<HKBanner t={t} />)
    const card = screen.getByText('胜宏科技').closest('a')!
    await user.click(card.querySelector('.ashare-index-remove')!)
    expect(removeCustomStock).toHaveBeenCalledWith('hk', '300476')
    expect(hookResult.refreshCustom).toHaveBeenCalled()
  })

  it('adds a stock from the top-right input', async () => {
    const user = userEvent.setup()
    render(<HKBanner t={t} />)
    const input = screen.getByPlaceholderText('HK/A-share code')
    await user.type(input, '01810')
    await user.click(screen.getByTitle('Add stock'))
    expect(addCustomStock).toHaveBeenCalledWith('hk', '01810')
    expect(hookResult.refreshCustom).toHaveBeenCalled()
    expect(input).toHaveValue('')
  })

  it('still renders index codes outside the config (stale cache)', () => {
    hookResult = {
      ...defaultResult,
      data: { indices: [quote('00700', '腾讯控股')], customStocks: [] },
    }
    render(<HKBanner t={t} />)
    expect(screen.getByText('腾讯控股')).toBeInTheDocument()
  })
})
