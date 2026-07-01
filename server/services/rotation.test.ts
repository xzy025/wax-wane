import { describe, it, expect } from 'vitest'
import { rankTopMovers } from './rotation'

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
