import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LedgerView from './LedgerView'
import type { Translation, ParsedTrade } from '../types'
import en from '../i18n/en'

const t = en as Translation

const mockTrades: ParsedTrade[] = [
  {
    tradeDate: '2026-04-11',
    stockCode: '601318',
    stockName: 'Ping An',
    side: 'buy',
    quantity: 1200,
    price: 41.2,
    grossAmount: 49440,
    commission: 12.6,
    stampTax: 0,
    transferFee: 0,
    otherFee: 0,
    netAmount: 49427.4,
    raw: {},
    validationStatus: 'valid',
  },
  {
    tradeDate: '2026-04-09',
    stockCode: '002594',
    stockName: 'BYD',
    side: 'sell',
    quantity: 500,
    price: 228.6,
    grossAmount: 114300,
    commission: 124.8,
    stampTax: 0,
    transferFee: 0,
    otherFee: 0,
    netAmount: 114175.2,
    raw: {},
    validationStatus: 'valid',
  },
  {
    tradeDate: '2026-03-21',
    stockCode: '600519',
    stockName: 'Kweichow Moutai',
    side: 'sell',
    quantity: 100,
    price: 1508,
    grossAmount: 150800,
    commission: 166.2,
    stampTax: 0,
    transferFee: 0,
    otherFee: 0,
    netAmount: 150633.8,
    raw: {},
    validationStatus: 'error',
    validationMessage: '超卖',
  },
]

const mockDispatch = vi.fn()

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>()
  return {
    ...actual,
    useAppState: () => ({
      trades: mockTrades,
      tradeGroups: [],
      reviewNotes: {},
      importBatches: [],
    }),
    useAppDispatch: () => mockDispatch,
  }
})

vi.mock('../engine/tradeGroup', () => ({
  buildTradeGroups: vi.fn(() => []),
}))

vi.mock('../engine/position', () => ({
  validateTrades: vi.fn((trades: unknown[]) => trades),
  getPositionQuantities: vi.fn(() => new Map()),
}))

describe('LedgerView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the title and description', () => {
    render(<LedgerView t={t} />)
    expect(screen.getByText('Standardized Trade Ledger')).toBeInTheDocument()
    expect(
      screen.getByText('Every imported row remains auditable against source data.'),
    ).toBeInTheDocument()
  })

  it('renders table headers', () => {
    render(<LedgerView t={t} />)
    for (const header of ['Date', 'Code', 'Name', 'Side', 'Qty', 'Price', 'Amount', 'Fees']) {
      expect(screen.getByText(header)).toBeInTheDocument()
    }
  })

  it('renders trade data rows', () => {
    render(<LedgerView t={t} />)
    expect(screen.getByText('601318')).toBeInTheDocument()
    expect(screen.getByText('Ping An')).toBeInTheDocument()
    expect(screen.getByText('002594')).toBeInTheDocument()
    expect(screen.getByText('BYD')).toBeInTheDocument()
    expect(screen.getByText('600519')).toBeInTheDocument()
    expect(screen.getByText('Kweichow Moutai')).toBeInTheDocument()
  })

  it('renders buy/sell side labels', () => {
    render(<LedgerView t={t} />)
    // Use getAllByText since "Buy"/"Sell" appear in both filter chips and side labels
    expect(screen.getAllByText('Buy').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Sell').length).toBeGreaterThanOrEqual(1)
  })

  it('renders search input', () => {
    render(<LedgerView t={t} />)
    expect(screen.getByPlaceholderText('Search stock or code')).toBeInTheDocument()
  })

  it('filters trades by search query', async () => {
    const user = userEvent.setup()
    render(<LedgerView t={t} />)
    const searchInput = screen.getByPlaceholderText('Search stock or code')
    await user.type(searchInput, 'BYD')
    // Only BYD row should be visible
    expect(screen.getByText('BYD')).toBeInTheDocument()
    expect(screen.queryByText('Ping An')).not.toBeInTheDocument()
    expect(screen.queryByText('Kweichow Moutai')).not.toBeInTheDocument()
  })

  it('filters by side using filter chips', async () => {
    const user = userEvent.setup()
    render(<LedgerView t={t} />)
    // Click "Sell" filter chip (use the button, not the table label)
    const sellChips = screen.getAllByText('Sell')
    const sellChip = sellChips.find(el => el.tagName === 'BUTTON') ?? sellChips[0]
    await user.click(sellChip)
    // Only sell trades should be visible
    expect(screen.queryByText('Ping An')).not.toBeInTheDocument()
    expect(screen.getByText('BYD')).toBeInTheDocument()
    expect(screen.getByText('Kweichow Moutai')).toBeInTheDocument()
  })

  it('shows all trades when "All" filter is active', async () => {
    const user = userEvent.setup()
    render(<LedgerView t={t} />)
    // First click Sell to filter
    const sellChips = screen.getAllByText('Sell')
    const sellChip = sellChips.find(el => el.tagName === 'BUTTON') ?? sellChips[0]
    await user.click(sellChip)
    // Then click "全部" (All) to show all - label is hardcoded in Chinese
    await user.click(screen.getByText('全部'))
    expect(screen.getByText('Ping An')).toBeInTheDocument()
    expect(screen.getByText('BYD')).toBeInTheDocument()
  })

  it('highlights rows with validation errors', () => {
    const { container } = render(<LedgerView t={t} />)
    const errorRows = container.querySelectorAll('.row-error')
    expect(errorRows.length).toBe(1)
  })

  it('shows validation badge for error trades', () => {
    render(<LedgerView t={t} />)
    // The Moutai trade has validationStatus 'error', so it should have a badge
    const badges = document.querySelectorAll('.validation-badge')
    expect(badges.length).toBe(1)
  })

  it('renders edit buttons for each trade', () => {
    render(<LedgerView t={t} />)
    const editButtons = screen.getAllByTitle('编辑')
    expect(editButtons.length).toBe(3)
  })

  it('enters edit mode when edit button is clicked', async () => {
    const user = userEvent.setup()
    render(<LedgerView t={t} />)
    const editButtons = screen.getAllByTitle('编辑')
    await user.click(editButtons[0])
    // Should show save and cancel buttons
    expect(screen.getByTitle('保存')).toBeInTheDocument()
    expect(screen.getByTitle('取消')).toBeInTheDocument()
  })

  it('exits edit mode when cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<LedgerView t={t} />)
    const editButtons = screen.getAllByTitle('编辑')
    await user.click(editButtons[0])
    expect(screen.getByTitle('取消')).toBeInTheDocument()
    await user.click(screen.getByTitle('取消'))
    // Should be back to normal mode - edit buttons should be visible again
    expect(screen.getAllByTitle('编辑').length).toBe(3)
  })

  it('dispatches UPDATE_TRADE when save is clicked', async () => {
    const user = userEvent.setup()
    render(<LedgerView t={t} />)
    const editButtons = screen.getAllByTitle('编辑')
    await user.click(editButtons[0])
    await user.click(screen.getByTitle('保存'))
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_TRADE' }),
    )
  })

  it('shows empty state when no trades match filters', async () => {
    const user = userEvent.setup()
    render(<LedgerView t={t} />)
    const searchInput = screen.getByPlaceholderText('Search stock or code')
    await user.type(searchInput, 'NONEXISTENT')
    expect(screen.getByText('无匹配结果')).toBeInTheDocument()
  })

  it('renders all filter chips', () => {
    render(<LedgerView t={t} />)
    // The "All" label is hardcoded as '全部' in the component
    expect(screen.getByText('全部')).toBeInTheDocument()
    // Use getAllByText since Buy/Sell appear in both filter chips and table
    expect(screen.getAllByText('Buy').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Sell').length).toBeGreaterThanOrEqual(1)
  })
})
