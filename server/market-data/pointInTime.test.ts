import { describe, expect, it } from 'vitest'
import {
  buildPointInTimeEvidence,
  isPointInTimeCausal,
  validateHistoricalBars,
} from './pointInTime'

const times = {
  requestedAt: '2026-08-27T09:35:01+08:00',
  receivedAt: '2026-08-27T09:35:02+08:00',
  decisionAt: '2026-08-27T09:35:03+08:00',
}

describe('point-in-time evidence contract', () => {
  it('keeps source metadata and classifies receipt-only evidence as partial', () => {
    const evidence = buildPointInTimeEvidence({
      ...times,
      asOfDate: '2026-08-27',
      provider: 'fixture',
      endpointVersion: 'fixture-v1',
      adjustment: 'raw',
      payload: { code: '600001', price: 10 },
    })
    expect(evidence.quality).toBe('partial')
    expect(evidence.providerAt).toBeNull()
    expect(evidence.payloadHash).toHaveLength(64)
    expect(isPointInTimeCausal(evidence)).toBe(true)
  })

  it('rejects unsorted, duplicate, future and unknown-adjustment bars', () => {
    const result = validateHistoricalBars([
      { date: '2026-08-27', open: 10, high: 11, low: 9, close: 10, volume: 100 },
      { date: '2026-08-27', open: 10, high: 11, low: 9, close: 10, volume: 100 },
      { date: '2026-08-28', open: 10, high: 11, low: 9, close: 10, volume: 100 },
    ], { asOfDate: '2026-08-27', adjustment: 'unknown' })
    expect(result.valid).toBe(false)
    expect(result.reasons).toEqual(expect.arrayContaining([
      'bar日期重复:2026-08-27',
      'bar超出asOfDate:2026-08-28',
      '复权口径未知',
    ]))
  })

  it('rejects a weekend bar from a daily historical series', () => {
    const result = validateHistoricalBars([{
      date: '2026-08-29',
      open: 10,
      high: 11,
      low: 9,
      close: 10,
      volume: 100,
    }])
    expect(result.valid).toBe(false)
    expect(result.reasons).toContain('bar日期不是交易日:2026-08-29')
  })
})
