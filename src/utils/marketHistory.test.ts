import { describe, expect, it } from 'vitest'
import { getLastSettledTradingDay } from './marketHistory'

describe('getLastSettledTradingDay', () => {
  it('keeps the previous session as the ladder signal date before 15:10', () => {
    expect(getLastSettledTradingDay(new Date('2026-08-19T09:35:00+08:00'))).toBe('2026-08-18')
  })

  it('allows the current session after the ladder settlement window starts', () => {
    expect(getLastSettledTradingDay(new Date('2026-08-19T15:10:00+08:00'))).toBe('2026-08-19')
  })

  it('steps back across a weekend', () => {
    expect(getLastSettledTradingDay(new Date('2026-08-24T09:35:00+08:00'))).toBe('2026-08-21')
  })
})
