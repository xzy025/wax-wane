import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isTradingDay,
  isTradingDayAt,
  listTradingDates,
  setTradingCalendarForTests,
  tradingCalendarSource,
  tradingCalendarVersion,
} from './tradingCalendar'

const tempRoots: string[] = []

afterEach(() => {
  setTradingCalendarForTests(null)
  vi.unstubAllEnvs()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
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

  it('lists a calendar range independently of market-data archive availability', () => {
    setTradingCalendarForTests({
      source: 'test-calendar',
      isTradingDay: (tradeDate) => {
        const day = new Date(`${tradeDate}T00:00:00Z`).getUTCDay()
        return day !== 0 && day !== 6 && tradeDate !== '2026-09-01'
      },
    })
    expect(listTradingDates('2026-08-28', '2026-09-03')).toEqual([
      '2026-08-28',
      '2026-08-31',
      '2026-09-02',
      '2026-09-03',
    ])
  })

  it('uses a versioned, audited calendar file when configured', () => {
    const root = mkdtempSync(join(process.cwd(), 'trading-calendar-test-'))
    tempRoots.push(root)
    const path = join(root, 'calendar.json')
    writeFileSync(path, JSON.stringify({
      schemaVersion: 'cn-trading-calendar-v1',
      source: 'exchange-holiday-plan',
      version: '2026.09.01',
      tradingDates: ['2026-08-31', '2026-09-01', '2026-09-02'],
    }))
    vi.stubEnv('TRADING_CALENDAR_FILE', path)

    expect(listTradingDates('2026-08-31', '2026-09-02')).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ])
    expect(isTradingDay('2026-09-05')).toBe(false)
    expect(tradingCalendarSource()).toBe('exchange-holiday-plan:calendar.json')
    expect(tradingCalendarVersion()).toBe('2026.09.01')
  })

  it('fails closed when a configured calendar file is missing or malformed', () => {
    vi.stubEnv('TRADING_CALENDAR_FILE', join(process.cwd(), 'missing-trading-calendar.json'))
    expect(() => isTradingDay('2026-09-01')).toThrow(/交易日历文件不存在/)

    const root = mkdtempSync(join(process.cwd(), 'trading-calendar-test-'))
    tempRoots.push(root)
    const path = join(root, 'bad.json')
    writeFileSync(path, JSON.stringify({ schemaVersion: 'wrong', tradingDates: ['2026-09-01'] }))
    vi.stubEnv('TRADING_CALENDAR_FILE', path)
    expect(() => listTradingDates('2026-09-01', '2026-09-01')).toThrow(/schema 无效/)
  })
})

