import { afterEach, describe, expect, it } from 'vitest'
import {
  isTradingDay,
  isTradingDayAt,
  setTradingCalendarForTests,
  tradingCalendarSource,
} from './tradingCalendar'

afterEach(() => {
  setTradingCalendarForTests(null)
})

describe('trading calendar boundary', () => {
  it('supports an injected holiday calendar instead of treating every weekday as open', () => {
    setTradingCalendarForTests({
      source: 'test-calendar',
      isTradingDay: (tradeDate) => tradeDate !== '2026-08-24',
    })

    expect(isTradingDay('2026-08-24')).toBe(false)
    expect(isTradingDayAt(Date.parse('2026-08-24T09:15:00+08:00'))).toBe(false)
    expect(tradingCalendarSource()).toBe('test-calendar')
    expect(isTradingDayAt(Date.parse('2026-08-25T09:15:00+08:00'))).toBe(true)
  })

  it('rejects weekends in the default calendar', () => {
    expect(isTradingDayAt(Date.parse('2026-08-22T09:15:00+08:00'))).toBe(false)
  })
})

