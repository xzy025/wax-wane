import { describe, expect, it } from 'vitest'
import { backfillLimitEvents } from './limitEventBackfill'

describe('limit event backfill', () => {
  it('accepts explicit event observations and does not synthesize daily-K events', () => {
    const result = backfillLimitEvents({
      code: '600103',
      provider: 'minute-archive',
      observations: [
        { date: '2026-08-28', eventType: 'first-seal', eventAt: '2026-08-28T09:35:00+08:00' },
        { date: 'not-a-date', eventType: 'close' },
      ],
    })
    expect(result).toHaveLength(1)
    expect(result[0].eventType).toBe('first-seal')
  })
})

