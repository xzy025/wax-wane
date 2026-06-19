import { describe, it, expect } from 'vitest'
import {
  dedupeLhbByCode,
  aggregateWindow,
  groupSeatsByCode,
  pickConcepts,
  computeSummary,
  tallyConcepts,
} from './moneyflow'

/** 窗口聚合输入的单日个股行（已按个股聚合）。 */
function core(over: Partial<{ code: string; name: string; close: number; changePct: number; buyAmt: number; sellAmt: number; netAmt: number; reason: string }>) {
  return { code: 'A', name: 'aa', close: 10, changePct: 0, buyAmt: 0, sellAmt: 0, netAmt: 0, dealAmt: 0, reason: '', ...over }
}

describe('dedupeLhbByCode', () => {
  it('sums buy/sell/net for repeated codes, computes dealAmt, joins reasons, sorts by net desc', () => {
    const out = dedupeLhbByCode([
      { code: 'A', name: 'aa', close: 10, changePct: 5, buyAmt: 150, sellAmt: 50, netAmt: 100, reason: '涨幅偏离' },
      { code: 'A', name: 'aa', close: 10, changePct: 5, buyAmt: 80, sellAmt: 20, netAmt: 60, reason: '换手率' },
      { code: 'B', name: 'bb', close: 20, changePct: 2, buyAmt: 500, sellAmt: 0, netAmt: 500, reason: '' },
    ])
    expect(out.map((r) => r.code)).toEqual(['B', 'A']) // 500 before 160
    const a = out.find((r) => r.code === 'A')!
    expect(a.netAmt).toBe(160)
    expect(a.buyAmt).toBe(230)
    expect(a.sellAmt).toBe(70)
    expect(a.dealAmt).toBe(300) // 230 + 70
    expect(a.reason).toBe('涨幅偏离; 换手率')
  })
})

describe('aggregateWindow', () => {
  it('sums net/buy/sell across days, counts board days, takes latest from most-recent day, sorts net desc', () => {
    // days passed descending (most recent first)
    const out = aggregateWindow([
      {
        date: '2026-06-18',
        rows: [
          core({ code: 'A', name: 'aa', changePct: 9, buyAmt: 150, sellAmt: 50, netAmt: 100, reason: '涨幅偏离' }),
          core({ code: 'B', name: 'bb', changePct: 3, buyAmt: 80, sellAmt: 0, netAmt: 80 }),
        ],
      },
      {
        date: '2026-06-17',
        rows: [core({ code: 'A', name: 'aa', changePct: -2, buyAmt: 60, sellAmt: 10, netAmt: 50, reason: '换手率' })],
      },
    ])
    expect(out.map((r) => r.code)).toEqual(['A', 'B']) // 150 vs 80
    const a = out[0]
    expect(a.netAmt).toBe(150)
    expect(a.buyAmt).toBe(210)
    expect(a.sellAmt).toBe(60)
    expect(a.dealAmt).toBe(270) // 210 + 60
    expect(a.days).toBe(2)
    expect(a.changePct).toBe(9) // most-recent day (06-18)
    expect(a.reason).toBe('涨幅偏离; 换手率')
    expect(out[1].days).toBe(1)
  })

  it('returns empty for no days', () => {
    expect(aggregateWindow([])).toEqual([])
  })
})

describe('groupSeatsByCode', () => {
  it('groups seats per stock, sums same-seat amounts, sorts desc, caps at topN', () => {
    const map = groupSeatsByCode(
      [
        { code: 'A', name: '机构专用', amount: 100 },
        { code: 'A', name: '机构专用', amount: 50 }, // 同营业部累加 → 150
        { code: 'A', name: '沪股通专用', amount: 200 },
        { code: 'A', name: '游资甲', amount: 30 },
        { code: 'A', name: '游资乙', amount: 10 }, // 第 4 名应被 topN=3 截掉
        { code: 'B', name: '机构专用', amount: 5 },
      ],
      3,
    )
    const a = map.get('A')!
    expect(a.map((s) => s.name)).toEqual(['沪股通专用', '机构专用', '游资甲']) // 200,150,30
    expect(a.find((s) => s.name === '机构专用')!.amount).toBe(150)
    expect(a).toHaveLength(3)
    expect(map.get('B')).toEqual([{ name: '机构专用', amount: 5 }])
  })

  it('skips rows with empty code or name', () => {
    const map = groupSeatsByCode([
      { code: '', name: '机构专用', amount: 100 },
      { code: 'A', name: '', amount: 100 },
    ])
    expect(map.size).toBe(0)
  })
})

describe('pickConcepts', () => {
  it('drops style/stat boards via blocklist, dedupes, keeps first N real concepts', () => {
    const boards = ['科技风格', '半导体', '百元股', '半导体', 'PCB', '历史新高', 'AI存储', '机器人']
    expect(pickConcepts(boards, 3)).toEqual(['半导体', 'PCB', 'AI存储']) // 风格/百元股/历史新高 滤除，去重，截 3
  })

  it('returns empty when all boards are filtered out', () => {
    expect(pickConcepts(['百元股', '融资融券', '沪股通', '近期新高'])).toEqual([])
  })
})

describe('computeSummary', () => {
  it('splits inflow/outflow by net sign and totals (outflow positive)', () => {
    const s = computeSummary([{ netAmt: 100 }, { netAmt: 50 }, { netAmt: -30 }, { netAmt: 0 }])
    expect(s.inflowCount).toBe(2)
    expect(s.outflowCount).toBe(1)
    expect(s.totalInflow).toBe(150)
    expect(s.totalOutflow).toBe(30)
  })
})

describe('tallyConcepts', () => {
  it('counts concept occurrences across stocks, sorts by count desc', () => {
    const out = tallyConcepts([
      { concepts: ['PCB', '半导体'] },
      { concepts: ['PCB', '机器人'] },
      { concepts: ['PCB'] },
    ])
    expect(out[0]).toEqual({ name: 'PCB', count: 3 })
    expect(out.map((c) => c.name)).toContain('半导体')
    expect(out.find((c) => c.name === '机器人')!.count).toBe(1)
  })
})
