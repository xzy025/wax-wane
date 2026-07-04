import { describe, it, expect } from 'vitest'
import { buildCalendar, windowDatesFor } from './calendar'
import type { StockBars } from './universe'
import type { Bar } from '../services/screenerRules'

const bar = (date: string): Bar => ({ date, open: 10, high: 10, low: 10, close: 10, volume: 1000 })
const sb = (code: string, dates: string[]): StockBars => ({ code, name: code, bars: dates.map(bar) })

describe('buildCalendar', () => {
  it('多票日期并集去重升序 + date→idx', () => {
    const { calendar, idxByDate } = buildCalendar([
      sb('A', ['2026-01-06', '2026-01-05']),
      sb('B', ['2026-01-07', '2026-01-05']),
    ])
    expect(calendar).toEqual(['2026-01-05', '2026-01-06', '2026-01-07'])
    expect(idxByDate.get('2026-01-07')).toBe(2)
  })
})

describe('windowDatesFor — 信号日前 k 个交易日(不含当日,防龙虎榜盘后数据前视)', () => {
  const { calendar, idxByDate } = buildCalendar([
    sb('A', ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09']),
  ])

  it('正常窗:k=2 → 恰好前 2 个交易日,不含信号日', () => {
    const win = windowDatesFor(calendar, idxByDate, '2026-01-08', 2)
    expect(win).toEqual(['2026-01-06', '2026-01-07'])
    expect(win).not.toContain('2026-01-08') // 旧实现含当日=前视,已修
  })

  it('边界:信号日在日历开头附近(i<k)→ 截到日历起点', () => {
    expect(windowDatesFor(calendar, idxByDate, '2026-01-06', 5)).toEqual(['2026-01-05'])
    expect(windowDatesFor(calendar, idxByDate, '2026-01-05', 5)).toEqual([]) // 首日无前置窗
  })

  it('信号日不在日历 → [](调用方按无因子处理)', () => {
    expect(windowDatesFor(calendar, idxByDate, '2026-02-01', 5)).toEqual([])
  })
})
