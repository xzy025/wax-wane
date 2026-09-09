import { describe, expect, it } from 'vitest'
import {
  SETTLEMENT_ARCHIVE_DEADLINE_MINUTES,
  SETTLEMENT_ARCHIVE_START_MINUTES,
  settlementDeadlineAt,
  settlementNextRetryAt,
  settlementRetryDelayMs,
} from './settlementArchiveRetry'

describe('settlement archive retry policy', () => {
  it('uses the Shanghai post-close window and stops before midnight rollover', () => {
    expect(SETTLEMENT_ARCHIVE_START_MINUTES).toBe(910)
    expect(SETTLEMENT_ARCHIVE_DEADLINE_MINUTES).toBe(1410)
    expect(new Date(settlementDeadlineAt('2026-08-31')).toISOString()).toBe('2026-08-31T15:30:00.000Z')
  })

  it('uses bounded job-level backoff and never schedules past the deadline', () => {
    expect(settlementRetryDelayMs(1)).toBe(2 * 60_000)
    expect(settlementRetryDelayMs(4)).toBe(20 * 60_000)
    expect(settlementRetryDelayMs(99)).toBe(60 * 60_000)

    const beforeDeadline = Date.parse('2026-08-31T23:29:00+08:00')
    expect(settlementNextRetryAt('2026-08-31', 1, beforeDeadline)).toBeNull()

    const earlier = Date.parse('2026-08-31T20:00:00+08:00')
    expect(settlementNextRetryAt('2026-08-31', 1, earlier)).toBe(earlier + 2 * 60_000)
  })
})
