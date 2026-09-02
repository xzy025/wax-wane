import { todayShanghai } from '../lib/time'

export interface ShanghaiClockAt {
  day: number
  minutes: number
  seconds: number
}

export interface TradingCalendar {
  readonly source: string
  isTradingDay(tradeDate: string): boolean
}

let testCalendar: TradingCalendar | null = null

export function shanghaiClockAt(nowMs = Date.now()): ShanghaiClockAt {
  const sh = new Date(nowMs + 8 * 3_600_000)
  return {
    day: sh.getUTCDay(),
    minutes: sh.getUTCHours() * 60 + sh.getUTCMinutes(),
    seconds: sh.getUTCHours() * 3_600 + sh.getUTCMinutes() * 60 + sh.getUTCSeconds(),
  }
}

function configuredHolidaySet(): Set<string> {
  const raw = process.env.A_SHARE_HOLIDAYS ?? process.env.TRADING_HOLIDAYS ?? ''
  return new Set(
    raw
      .split(',')
      .map((date) => date.trim())
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
  )
}

function defaultCalendar(): TradingCalendar {
  const holidays = configuredHolidaySet()
  return {
    source: holidays.size ? 'env-holidays' : 'weekdays-only',
    isTradingDay(tradeDate: string): boolean {
      const day = new Date(tradeDate + 'T00:00:00Z').getUTCDay()
      return day !== 0 && day !== 6 && !holidays.has(tradeDate)
    },
  }
}

export function activeTradingCalendar(): TradingCalendar {
  return testCalendar ?? defaultCalendar()
}

export function tradingDateAt(nowMs = Date.now()): string {
  return todayShanghai(nowMs)
}

export function isTradingDay(tradeDate: string): boolean {
  return activeTradingCalendar().isTradingDay(tradeDate)
}

export function isTradingDayAt(nowMs = Date.now()): boolean {
  return isTradingDay(tradingDateAt(nowMs))
}

export function tradingCalendarSource(): string {
  return activeTradingCalendar().source
}

/** Test seam for holiday calendars; production callers should use the configured calendar. */
export function setTradingCalendarForTests(calendar: TradingCalendar | null): void {
  testCalendar = calendar
}
