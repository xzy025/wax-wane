import { describe, it, expect } from 'vitest'
import {
  buildQuickTinyRotationResult,
  normalizeRotationUniverse,
  rankTopMovers,
  returnsAgainstBenchmark,
  selectRotationUniverse,
} from './rotation'
import { makeQuickTinyBoardCode, parseQuickTinyBoardCode, type QuickTinyRotationPayload } from './quicktinyRotation'

describe('rankTopMovers(成分股当日涨跌幅榜)', () => {
  it('按 changePct 降序排序', () => {
    const members = [
      { code: 'a', changePct: 1 },
      { code: 'b', changePct: 7.09 },
      { code: 'c', changePct: -3 },
      { code: 'd', changePct: 4.7 },
    ]
    const top = rankTopMovers(members, 10)
    expect(top.map((m) => m.code)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('按 n 截断,不改变原数组', () => {
    const members = [
      { code: 'a', changePct: 1 },
      { code: 'b', changePct: 2 },
      { code: 'c', changePct: 3 },
    ]
    const top = rankTopMovers(members, 2)
    expect(top.map((m) => m.code)).toEqual(['c', 'b'])
    expect(members.map((m) => m.code)).toEqual(['a', 'b', 'c']) // 原数组未被 sort 原地修改
  })

  it('空数组 → 空结果', () => {
    expect(rankTopMovers([], 10)).toEqual([])
  })

  it('蓝筹反转场景(保险板块示例):真实涨幅数据能正确排出领涨股', () => {
    // 对应 2026-07-01 真实场景:保险板块今日 +7.09%,验证成分股排行逻辑本身正确。
    const members = [
      { code: '601318', name: '中国平安', changePct: 6.2 },
      { code: '601336', name: '新华保险', changePct: 8.1 },
      { code: '601601', name: '中国太保', changePct: 5.4 },
      { code: '601628', name: '中国人寿', changePct: 7.0 },
    ]
    const top = rankTopMovers(members, 3)
    expect(top.map((m) => m.name)).toEqual(['新华保险', '中国人寿', '中国平安'])
  })
})

describe('selectRotationUniverse', () => {
  it('行业成交额截断时仍保留食品饮料和白酒', () => {
    const universe = Array.from({ length: 121 }, (_, i) => ({
      code: `BK${String(i).padStart(4, '0')}`, name: `行业${i}`, todayChg: 0, amount: 1_000 - i,
    }))
    universe[120] = { code: 'BK0438', name: '食品饮料', todayChg: 0, amount: 1 }
    universe[119] = { code: 'BK1575', name: '白酒Ⅲ', todayChg: 0, amount: 2 }
    const selected = selectRotationUniverse('industry', universe)
    expect(selected.some((b) => b.code === 'BK0438')).toBe(true)
    expect(selected.some((b) => b.code === 'BK1575')).toBe(true)
  })

  it('去重可以确定的Ⅱ/Ⅲ层级重复，保留更细的Ⅲ级行业', () => {
    const result = normalizeRotationUniverse('industry', [
      { code: 'BK1277', name: '白酒Ⅱ', todayChg: 0, amount: 100 },
      { code: 'BK1575', name: '白酒Ⅲ', todayChg: 0, amount: 90 },
      { code: 'BK0438', name: '食品饮料', todayChg: 0, amount: 80 },
    ])
    expect(result.map((b) => b.code)).toEqual(['BK1575', 'BK0438'])
  })
})

describe('returnsAgainstBenchmark', () => {
  const benchmark = [
    { date: '2026-01-01', close: 100 },
    { date: '2026-01-02', close: 101 },
    { date: '2026-01-03', close: 102 },
  ]

  it('以相同交易日计算板块原始收益与相对超额收益', () => {
    const board = [
      { date: '2026-01-01', close: 100 },
      { date: '2026-01-02', close: 103 },
      { date: '2026-01-03', close: 106 },
    ]
    const result = returnsAgainstBenchmark(board, benchmark, 2)
    expect(result?.raw).toBeCloseTo(6, 10)
    expect(result?.excess).toBeCloseTo(4, 10)
  })

  it('板块缺失窗口起止交易日时不伪造固定窗口收益', () => {
    const board = [{ date: '2026-01-02', close: 103 }, { date: '2026-01-03', close: 106 }]
    expect(returnsAgainstBenchmark(board, benchmark, 2)).toBeNull()
  })
})

describe('QuickTiny 分类适配', () => {
  it('题材板块代码可以无损往返中文名称', () => {
    const code = makeQuickTinyBoardCode('kpl', 'Micro（硅基）OLED')
    expect(parseQuickTinyBoardCode(code)).toEqual({ source: 'kpl', name: 'Micro（硅基）OLED' })
  })

  it('按开盘啦原始涨跌映射四象限并保留量比/区间/股数', () => {
    const payload: QuickTinyRotationPayload = {
      quadrants: {
        highStrong: [{ name: '硅光技术概念', todayChange: 3, periodChange: 20.05, recentChange: 16.5, stockCount: 22, volumeRatio: 0.72, positionInRange: 74 }],
        lowStrong: [{ name: '光纤', todayChange: 2.9, periodChange: -6.82, recentChange: 6.92, stockCount: 18 }],
        highWeak: [],
        lowWeak: [],
      },
      meta: {
        source: 'kpl',
        sourceLabel: '开盘啦题材',
        period: 60,
        strengthPeriod: 5,
        date: '20260814',
        sectorCount: 2,
        volumeProgress: 100,
      },
    }
    const result = buildQuickTinyRotationResult('theme', 60, 5, payload)
    expect(result.provider).toBe('quicktiny')
    expect(result.sourceLabel).toBe('开盘啦题材')
    expect(result.asof).toBe('2026-08-14')
    expect(result.summary).toMatchObject({ total: 2, hs: 1, ls: 1, hw: 0, lw: 0 })
    expect(result.boards[0]).toMatchObject({
      name: '硅光技术概念',
      quadrant: 'hs',
      longChg: 20.05,
      shortChg: 16.5,
      stockCount: 22,
      volumeRatio: 0.72,
      positionInRange: 74,
    })
  })
})
