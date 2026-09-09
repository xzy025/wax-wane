import { describe, expect, it } from 'vitest'
import { validateHithinkStockPayload } from './schemas'

describe('Hithink research schemas', () => {
  it('preserves valid null and negative valuation values', () => {
    expect(validateHithinkStockPayload('valuation', {
      item: [{ thscode: '600519.SH', pe_ttm: -2, pb_mrq: null, currency: 'CNY' }],
    }, '600519.SH')).toEqual({ ok: true })
  })

  it('rejects incomplete financial rows, invalid dates, duplicates and wrong codes', () => {
    expect(validateHithinkStockPayload('income', { item: [{ thscode: '600519.SH' }] }, '600519.SH').ok).toBe(false)
    expect(validateHithinkStockPayload('balance', { item: [{ thscode: '600519.SH', report_date: '2026-02-30' }] }, '600519.SH').ok).toBe(false)
    expect(validateHithinkStockPayload('cashflow', { item: [
      { thscode: '600519.SH', report_date_ms: 1 }, { thscode: '600519.SH', report_date_ms: 1 },
    ] }, '600519.SH').ok).toBe(false)
    expect(validateHithinkStockPayload('valuation', { item: [{ thscode: '000001.SZ', pe_ttm: 1 }] }, '600519.SH').ok).toBe(false)
  })
})
