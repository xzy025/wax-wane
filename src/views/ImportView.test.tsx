import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImportView from './ImportView'
import type { Translation } from '../types'
import en from '../i18n/en'

const t = en as Translation

const mockDispatch = vi.fn()

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>()
  return {
    ...actual,
    useAppState: () => ({
      trades: [],
      tradeGroups: [],
      reviewNotes: {},
      importBatches: [],
    }),
    useAppDispatch: () => mockDispatch,
  }
})

// Mock the CSV parser
vi.mock('../engine/csvParser', () => ({
  parseFile: vi.fn(),
  mapAndValidate: vi.fn(),
  STANDARD_FIELDS: [
    { key: 'tradeDate', label: 'Trade Date', required: true },
    { key: 'stockCode', label: 'Stock Code', required: true },
    { key: 'stockName', label: 'Stock Name', required: false },
    { key: 'side', label: 'Side', required: true },
    { key: 'quantity', label: 'Quantity', required: true },
    { key: 'price', label: 'Price', required: true },
    { key: 'grossAmount', label: 'Amount', required: true },
    { key: 'commission', label: 'Commission', required: false },
    { key: 'stampTax', label: 'Stamp Tax', required: false },
    { key: 'transferFee', label: 'Transfer Fee', required: false },
    { key: 'netAmount', label: 'Net Amount', required: false },
  ],
}))

// Mock tradeGroup and position engines
vi.mock('../engine/tradeGroup', () => ({
  buildTradeGroups: vi.fn(() => []),
}))

vi.mock('../engine/position', () => ({
  validateTrades: vi.fn((trades: unknown[]) => trades),
  getPositionQuantities: vi.fn(() => new Map()),
}))

describe('ImportView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the upload step by default', () => {
    render(<ImportView t={t} />)
    expect(screen.getByText('Upload delivery statement')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Drop a broker CSV or Excel file here. The MVP keeps raw rows and standardized trades.',
      ),
    ).toBeInTheDocument()
  })

  it('renders the select file button', () => {
    render(<ImportView t={t} />)
    expect(screen.getByRole('button', { name: /Select file/i })).toBeInTheDocument()
  })

  it('renders the import pipeline section', () => {
    render(<ImportView t={t} />)
    expect(screen.getByText('Import Pipeline')).toBeInTheDocument()
    expect(
      screen.getByText('Designed for repeatable data quality checks.'),
    ).toBeInTheDocument()
  })

  it('renders all pipeline steps', () => {
    render(<ImportView t={t} />)
    expect(screen.getByText('Upload file')).toBeInTheDocument()
    expect(screen.getByText('Map columns')).toBeInTheDocument()
    expect(screen.getByText('Validate rows')).toBeInTheDocument()
    expect(screen.getByText('Rebuild trades')).toBeInTheDocument()
  })

  it('renders the column mapping preview section', () => {
    render(<ImportView t={t} />)
    expect(screen.getByText('Column Mapping Preview')).toBeInTheDocument()
    expect(
      screen.getByText('Broker-specific headers are mapped to a standard ledger schema.'),
    ).toBeInTheDocument()
  })

  it('renders mapping preview rows', () => {
    render(<ImportView t={t} />)
    expect(screen.getByText('Trade Date')).toBeInTheDocument()
    expect(screen.getByText('Stock Code')).toBeInTheDocument()
    expect(screen.getByText('Side')).toBeInTheDocument()
    expect(screen.getByText('Quantity')).toBeInTheDocument()
    expect(screen.getByText('Price')).toBeInTheDocument()
    expect(screen.getByText('Commission')).toBeInTheDocument()
  })

  it('has a hidden file input accepting CSV and Excel files', () => {
    const { container } = render(<ImportView t={t} />)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeInTheDocument()
    expect(fileInput.accept).toBe('.csv,.xlsx,.xls')
  })

  it('clicking select file triggers the hidden file input', async () => {
    const user = userEvent.setup()
    const { container } = render(<ImportView t={t} />)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(fileInput, 'click')
    await user.click(screen.getByRole('button', { name: /Select file/i }))
    expect(clickSpy).toHaveBeenCalled()
  })

  it('renders step numbers correctly', () => {
    render(<ImportView t={t} />)
    const stepItems = screen.getAllByText(/^[1-4]$/)
    expect(stepItems.length).toBe(4)
  })
})
