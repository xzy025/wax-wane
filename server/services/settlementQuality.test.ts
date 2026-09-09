import { expect, it } from 'vitest'
import { validSettlementArchive } from './settlementQuality'
const date = '2026-09-07'
it('rejects weak forward archives and future signal inputs', () => {
  expect(validSettlementArchive({ asof: date, overall: {} }, date, 'forward')).toBe(false)
  const forward = { asof: date, overall: { n: 0 }, snapshotCount: 1, strategies: [{ picks: [{ asof: '2026-09-08', exitDate: '' }] }] }
  expect(validSettlementArchive(forward, date, 'forward')).toBe(false)
  forward.strategies[0].picks[0].asof = date
  expect(validSettlementArchive(forward, date, 'forward')).toBe(true)
})
it('rejects Friday bars labelled Monday and rows missing Monday', () => {
  const result = { asof: date, dates: ['2026-09-04'], benchmark: { cells: [{ date: '2026-09-04' }] }, rows: [{ cells: [{ date }] }] }
  expect(validSettlementArchive(result, date, 'tempo')).toBe(false)
  result.dates = [date]
  result.benchmark.cells = [{ date }]
  expect(validSettlementArchive(result, date, 'tempo')).toBe(true)
  result.rows[0].cells = [{ date: '2026-09-04' }]
  expect(validSettlementArchive(result, date, 'tempo')).toBe(false)
})
it('does not accept empty review or missing ladder eligibility', () => {
  expect(validSettlementArchive({ asof: date, overnight: [], calendar: [] }, date, 'review')).toBe(false)
  expect(validSettlementArchive({ asof: date, generatedAt: date }, date, 'ladder')).toBe(false)
})
it('core-settled is distinct from formal eligibility', () => {
  const result = { asof: date, stocks: [{}], archiveStage: 'core-settled', formalSignalEligible: false,
    quality: { sourceDate: date, coreDataComplete: true, settled: true, sentimentStatus: 'full', limitFieldsComplete: true,
      klineTotal: 1, klineComplete: 1, receivedAt: date, adjustment: 'raw' } }
  expect(validSettlementArchive(result, date, 'ladder')).toBe(true)
  result.formalSignalEligible = true
  expect(validSettlementArchive(result, date, 'ladder')).toBe(false)
})
