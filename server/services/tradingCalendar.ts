import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { todayShanghai } from '../lib/time'

export interface ShanghaiClockAt {
  day: number
  minutes: number
  seconds: number
}

export interface TradingCalendar {
  readonly source: string
  readonly version?: string
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

function calendarFilePath(): string | null {
  const configured = (process.env.TRADING_CALENDAR_FILE || process.env.A_SHARE_TRADING_CALENDAR_FILE || '').trim()
  return configured ? resolve(configured) : null
}

function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return parsed.toISOString().slice(0, 10) === value
}

interface TradingCalendarFile {
  schemaVersion: 'cn-trading-calendar-v1'
  source: string
  version: string
  tradingDates: string[]
}

function loadConfiguredCalendar(): TradingCalendar | null {
  const path = calendarFilePath()
  if (!path) return null
  if (!existsSync(path)) throw new Error(`交易日历文件不存在: ${path}`)

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`交易日历文件无法解析: ${path}`, { cause: error })
  }

  const record = raw && typeof raw === 'object' ? raw as Partial<TradingCalendarFile> : {}
  if (
    record.schemaVersion !== 'cn-trading-calendar-v1' ||
    typeof record.source !== 'string' ||
    !record.source.trim() ||
    typeof record.version !== 'string' ||
    !record.version.trim() ||
    !Array.isArray(record.tradingDates) ||
    record.tradingDates.length === 0 ||
    !record.tradingDates.every(isValidCalendarDate)
  ) {
    throw new Error(`交易日历文件 schema 无效（需要 cn-trading-calendar-v1）: ${path}`)
  }

  const dates = new Set(record.tradingDates)
  if (dates.size !== record.tradingDates.length) throw new Error(`交易日历文件含重复日期: ${path}`)

  return {
    source: `${record.source.trim()}:${basename(path)}`,
    version: record.version.trim(),
    isTradingDay: (tradeDate) => dates.has(tradeDate),
  }
}

function defaultCalendar(): TradingCalendar {
  const configured = loadConfiguredCalendar()
  if (configured) return configured
  const holidays = configuredHolidaySet()
  return {
    source: holidays.size ? 'env-holidays' : 'weekdays-only',
    isTradingDay(tradeDate: string): boolean {
      const day = new Date(tradeDate + 'T00:00:00Z').getUTCDay()
      return day !== 0 && day !== 6 && !holidays.has(tradeDate)
    },
  }
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return parsed.toISOString().slice(0, 10) === value
}

/** Return the configured calendar dates in ascending order, without fetching market data. */
export function listTradingDates(fromDate: string, toDate: string): string[] {
  if (!validCalendarDate(fromDate) || !validCalendarDate(toDate) || fromDate > toDate) {
    throw new Error('交易日历范围必须是有效的 YYYY-MM-DD，且 from 不得晚于 to')
  }
  const rangeDays = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000
  if (rangeDays > 366) throw new Error('交易日历查询范围不能超过366天')
  const dates: string[] = []
  const cursor = new Date(`${fromDate}T00:00:00Z`)
  const end = new Date(`${toDate}T00:00:00Z`).getTime()
  while (cursor.getTime() <= end) {
    const date = cursor.toISOString().slice(0, 10)
    if (isTradingDay(date)) dates.push(date)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
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

export function tradingCalendarVersion(): string | null {
  return activeTradingCalendar().version ?? null
}

/** Test seam for holiday calendars; production callers should use the configured calendar. */
export function setTradingCalendarForTests(calendar: TradingCalendar | null): void {
  testCalendar = calendar
}
