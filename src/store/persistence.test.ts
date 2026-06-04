import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedTrade, ReviewNote, TradeGroup } from '../types'
import type { ImportBatch } from './index'
import {
  importBatchToDb,
  isDbAvailable,
  probeBackendDb,
  reviewNoteToDb,
  syncImportBatch,
  syncReviewNote,
  syncTradeGroups,
  syncTrades,
  tradeGroupToDb,
  tradeToDb,
} from './persistence'

const sampleTrade: ParsedTrade = {
  tradeDate: '2026-03-04',
  stockCode: '300750',
  stockName: 'CATL',
  side: 'buy',
  quantity: 100,
  price: 180.5,
  grossAmount: 18050,
  commission: 5,
  stampTax: 0,
  transferFee: 0.5,
  otherFee: 0,
  netAmount: 18055.5,
  raw: { col0: '2026-03-04', col1: '300750' },
}

const sampleGroup: TradeGroup = {
  id: 'tg-001',
  code: '300750',
  name: 'CATL',
  opened: '2026-03-04',
  closed: '2026-03-18',
  pnl: 8460,
  returnRate: 9.4,
  days: 14,
  totalFee: 324.6,
  strategy: 'Pullback',
  mistakes: ['Early profit taking'],
  status: 'Reviewed',
}

const sampleNote: ReviewNote = {
  buyReason: 'pullback to MA20',
  sellReason: 'target reached',
  executionReview: 'good entry',
  lesson: 'hold winners',
}

const sampleBatch: ImportBatch = {
  id: 'batch-1',
  filename: 'march.csv',
  importedAt: '2026-03-20T00:00:00.000Z',
  rowCount: 42,
  status: 'imported',
}

describe('mappers', () => {
  it('maps a ParsedTrade to snake_case DB shape with a minted id', () => {
    const row = tradeToDb(sampleTrade)
    expect(row).toMatchObject({
      trade_date: '2026-03-04',
      stock_code: '300750',
      stock_name: 'CATL',
      side: 'buy',
      gross_amount: 18050,
      stamp_tax: 0,
      transfer_fee: 0.5,
      net_amount: 18055.5,
      validation_status: 'valid',
      raw_json: JSON.stringify(sampleTrade.raw),
    })
    expect(typeof row.id).toBe('string')
    expect((row.id as string).length).toBeGreaterThan(0)
  })

  it('derives DB status from close date and maps frontend status to review_status', () => {
    expect(tradeGroupToDb(sampleGroup)).toMatchObject({
      id: 'tg-001',
      stock_code: '300750',
      stock_name: 'CATL',
      opened_at: '2026-03-04',
      closed_at: '2026-03-18',
      status: 'closed',
      return_rate: 9.4,
      holding_days: 14,
      mistakes_json: JSON.stringify(['Early profit taking']),
      review_status: 'Reviewed',
    })
  })

  it('marks open groups (no close date) as status "open"', () => {
    const open = tradeGroupToDb({ ...sampleGroup, closed: null })
    expect(open.status).toBe('open')
    expect(open.closed_at).toBeUndefined()
  })

  it('maps a ReviewNote to snake_case columns', () => {
    expect(reviewNoteToDb(sampleNote)).toEqual({
      buy_reason: 'pullback to MA20',
      sell_reason: 'target reached',
      execution_review: 'good entry',
      lesson: 'hold winners',
    })
  })

  it('maps an ImportBatch, routing row counts by status', () => {
    expect(importBatchToDb(sampleBatch)).toMatchObject({
      id: 'batch-1',
      source_filename: 'march.csv',
      source_type: 'csv',
      row_count: 42,
      success_count: 42,
      error_count: 0,
      status: 'imported',
    })
    expect(importBatchToDb({ ...sampleBatch, status: 'failed' })).toMatchObject({
      success_count: 0,
      error_count: 42,
    })
  })
})

describe('probeBackendDb', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true and flips availability when health reports db:true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ db: true }) }),
    )
    expect(await probeBackendDb()).toBe(true)
    expect(isDbAvailable()).toBe(true)
  })

  it('returns false when health reports db:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ db: false }) }),
    )
    expect(await probeBackendDb()).toBe(false)
    expect(isDbAvailable()).toBe(false)
  })

  it('returns false on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }))
    expect(await probeBackendDb()).toBe(false)
  })

  it('returns false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await probeBackendDb()).toBe(false)
    expect(isDbAvailable()).toBe(false)
  })
})

describe('write-through sync', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function enable() {
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ db: true }) })
    await probeBackendDb()
    fetchMock.mockClear()
  }

  async function disable() {
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ db: false }) })
    await probeBackendDb()
    fetchMock.mockClear()
  }

  it('does not call fetch when the backend DB is unavailable', async () => {
    await disable()
    syncTrades([sampleTrade])
    syncTradeGroups([sampleGroup])
    syncReviewNote('tg-001', sampleNote)
    syncImportBatch(sampleBatch)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs each trade when available', async () => {
    await enable()
    syncTrades([sampleTrade, sampleTrade])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/db/trades',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('POSTs each trade group when available', async () => {
    await enable()
    syncTradeGroups([sampleGroup])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/db/trade-groups',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('PUTs the review note to the group-scoped endpoint', async () => {
    await enable()
    syncReviewNote('tg 001', sampleNote)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/db/review-notes/tg%20001',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('POSTs the import batch when available', async () => {
    await enable()
    syncImportBatch(sampleBatch)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/db/import-batches',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
