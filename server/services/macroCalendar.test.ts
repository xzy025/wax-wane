import { describe, it, expect } from 'vitest'
import {
  parseJin10Day,
  isImportant,
  builtinCalendar,
  mergeCalendar,
  dateRange,
  type MacroEvent,
} from './macroCalendar'

describe('parseJin10Day — 金十单日解析容错', () => {
  it('正常数组 → 字段映射正确', () => {
    const raw = [
      { country: '美国', name: '非农就业人数', star: 3, previous: '14.7万', consensus: '11万', pub_time: '08:30' },
    ]
    const out = parseJin10Day(raw, '2026-07-03')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      date: '2026-07-03',
      time: '08:30',
      country: '美国',
      name: '非农就业人数',
      star: 3,
      previous: '14.7万',
      consensus: '11万',
      source: 'jin10',
    })
  })

  it('pub_time 为 unix 秒 → 转上海 HH:mm', () => {
    // 2026-07-03 00:30 UTC = 上海 08:30
    const sec = Date.UTC(2026, 6, 3, 0, 30) / 1000
    const out = parseJin10Day([{ name: 'CPI', country: '美国', star: 2, pub_time: sec }], '2026-07-03')
    expect(out[0].time).toBe('08:30')
  })

  it('缺 star/previous → 容错默认(star=0, previous=undefined)', () => {
    const out = parseJin10Day([{ name: 'GDP', country: '中国' }], '2026-07-06')
    expect(out[0].star).toBe(0)
    expect(out[0].previous).toBeUndefined()
  })

  it('非数组/null/字符串 → []', () => {
    expect(parseJin10Day(null, '2026-07-03')).toEqual([])
    expect(parseJin10Day('oops', '2026-07-03')).toEqual([])
    expect(parseJin10Day({ a: 1 }, '2026-07-03')).toEqual([])
  })

  it('缺 name 的脏条目跳过,不拖垮整天', () => {
    const out = parseJin10Day([{ country: '美国', star: 3 }, { name: 'CPI', country: '美国', star: 3 }], '2026-07-03')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('CPI')
  })
})

describe('isImportant — 重要度过滤', () => {
  const ev = (over: Partial<MacroEvent>): MacroEvent => ({
    date: '2026-07-03',
    country: '美国',
    name: 'x',
    star: 0,
    source: 'jin10',
    ...over,
  })

  it('star>=2 → true(含边界 2)', () => {
    expect(isImportant(ev({ star: 3 }))).toBe(true)
    expect(isImportant(ev({ star: 2 }))).toBe(true)
  })

  it('star 1 + 中国 CPI → true(关键指标名命中)', () => {
    expect(isImportant(ev({ star: 1, country: '中国', name: 'CPI年率' }))).toBe(true)
  })

  it('star 1 + 日本 GDP → false(非中美)', () => {
    expect(isImportant(ev({ star: 1, country: '日本', name: 'GDP年率' }))).toBe(false)
  })

  it('star 1 + 美国次要指标 → false', () => {
    expect(isImportant(ev({ star: 1, country: '美国', name: 'API原油库存' }))).toBe(false)
  })
})

describe('builtinCalendar — 内置规则日历', () => {
  it('2026-07-02 起 7 天 → 含 07-03 美国非农(第一个周五),不含 LPR(20日窗口外)', () => {
    const out = builtinCalendar('2026-07-02', 7)
    const nfp = out.find((e) => e.name.includes('非农'))
    expect(nfp?.date).toBe('2026-07-03')
    expect(nfp?.approx).toBe(false)
    expect(out.some((e) => e.name.includes('LPR'))).toBe(false)
  })

  it('跨月窗口 2026-06-28 起 7 天 → 命中 06-30 官方PMI(月末最后一天)', () => {
    const out = builtinCalendar('2026-06-28', 7)
    const pmi = out.find((e) => e.name.includes('PMI'))
    expect(pmi?.date).toBe('2026-06-30')
  })

  it('FOMC 窗口 2026-07-27 起 7 天 → 命中 07-29 决议日', () => {
    const out = builtinCalendar('2026-07-27', 7)
    expect(out.some((e) => e.name.includes('FOMC') && e.date === '2026-07-29')).toBe(true)
  })

  it('约X日类事件标 approx=true', () => {
    const out = builtinCalendar('2026-07-09', 1)
    const cpi = out.find((e) => e.name.includes('CPI/PPI'))
    expect(cpi?.approx).toBe(true)
  })

  it('days=0 → []', () => {
    expect(builtinCalendar('2026-07-02', 0)).toEqual([])
  })

  it('全部 star=3 且 source=builtin', () => {
    const out = builtinCalendar('2026-07-01', 31)
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((e) => e.star === 3 && e.source === 'builtin')).toBe(true)
  })
})

describe('mergeCalendar — 逐日合并与 source 判定', () => {
  const jin = (date: string, name: string): MacroEvent => ({ date, country: '美国', name, star: 3, source: 'jin10' })
  const builtin = builtinCalendar('2026-07-02', 7) // 含 07-03 非农

  it('全部日成功 → source=jin10,用金十数据', () => {
    const byDay = new Map<string, MacroEvent[] | null>([
      ['2026-07-02', [jin('2026-07-02', 'ISM制造业')]],
      ['2026-07-03', [jin('2026-07-03', '非农就业人数')]],
    ])
    const { events, source } = mergeCalendar(byDay, builtin)
    expect(source).toBe('jin10')
    expect(events.every((e) => e.source === 'jin10')).toBe(true)
  })

  it('某日 null → 该日落回 builtin,source=mixed', () => {
    const byDay = new Map<string, MacroEvent[] | null>([
      ['2026-07-02', [jin('2026-07-02', 'ISM制造业')]],
      ['2026-07-03', null],
    ])
    const { events, source } = mergeCalendar(byDay, builtin)
    expect(source).toBe('mixed')
    expect(events.some((e) => e.source === 'builtin' && e.date === '2026-07-03' && e.name.includes('非农'))).toBe(true)
  })

  it('全部 null → source=builtin', () => {
    const byDay = new Map<string, MacroEvent[] | null>([
      ['2026-07-02', null],
      ['2026-07-03', null],
    ])
    const { source } = mergeCalendar(byDay, builtin)
    expect(source).toBe('builtin')
  })

  it('某日金十返回空数组(当日确无事件)→ 视为成功不落 builtin', () => {
    const byDay = new Map<string, MacroEvent[] | null>([['2026-07-03', []]])
    const { events, source } = mergeCalendar(byDay, builtin)
    expect(source).toBe('jin10')
    expect(events).toEqual([])
  })

  it('排序:按日期,同日按时刻,无时刻排该日末尾', () => {
    const a = { ...jin('2026-07-03', 'B'), time: undefined }
    const b = { ...jin('2026-07-03', 'A'), time: '08:30' }
    const c = jin('2026-07-02', 'C')
    const byDay = new Map<string, MacroEvent[] | null>([
      ['2026-07-03', [a, b]],
      ['2026-07-02', [c]],
    ])
    const { events } = mergeCalendar(byDay, builtin)
    expect(events.map((e) => e.name)).toEqual(['C', 'A', 'B'])
  })
})

describe('dateRange — 日期窗口', () => {
  it('含起始日、跨月正确', () => {
    expect(dateRange('2026-06-29', 3)).toEqual(['2026-06-29', '2026-06-30', '2026-07-01'])
  })
})
