import { describe, it, expect } from 'vitest'
import {
  buildBreadthByDate, median, labelBreadth, labelChop, labelCombo, bucketTrades, gateEval, tercileEdges,
  type BreadthDay,
} from './regimeBucket'
import type { StockBars } from './universe'
import type { Trade } from './engine'
import type { Bar } from '../services/screenerRules'

// 21 根等差日期的 bar 序列;close 由调用方给定(其余字段撮合不涉及)。
const mkBars = (closes: number[]): Bar[] =>
  closes.map((c, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    open: c, high: c, low: c, close: c, volume: 1000,
  }))
const sb = (code: string, closes: number[]): StockBars => ({ code, name: code, bars: mkBars(closes) })

describe('buildBreadthByDate — 样本横截面 breadth 序列', () => {
  it('MA20 成型前的日期无值;成型后 aboveMa20Pct/medRet5Pct 正确', () => {
    // A:单调上行(末日 close 高于 MA20);B:单调下行(末日低于 MA20)。各 21 根。
    const up = Array.from({ length: 21 }, (_, i) => 10 + i * 0.1)
    const down = Array.from({ length: 21 }, (_, i) => 12 - i * 0.1)
    const m = buildBreadthByDate([sb('A', up), sb('B', down)])
    expect(m.has('2026-01-19')).toBe(false) // j=18 < 19,MA20 未成型
    const d21 = m.get('2026-01-21')
    expect(d21).toBeDefined()
    expect(d21!.aboveMa20Pct).toBeCloseTo(0.5, 5) // A 在上、B 在下
    expect(d21!.coverage).toBe(1)
    // 5 日收益:A=(12/11.5−1)=+4.35%、B=(10/10.5−1)=−4.76% → 中位=两者均值 −0.21%
    expect(d21!.medRet5Pct).toBeCloseTo((4.35 + -4.76) / 2, 1)
  })

  it('coverage < 50% 的日期剔除(短历史票不拉低样本早期)', () => {
    // A 有 21 根;B/C 只有 5 根(永远算不出 MA20)→ 任何日期 coverage=1/3 <0.5 → 全剔。
    const m = buildBreadthByDate([
      sb('A', Array.from({ length: 21 }, (_, i) => 10 + i * 0.1)),
      sb('B', [1, 1, 1, 1, 1]),
      sb('C', [1, 1, 1, 1, 1]),
    ])
    expect(m.size).toBe(0)
  })
})

describe('median', () => {
  it('奇偶长度/空集', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})

describe('label — 固定阈值边界', () => {
  const b = (aboveMa20Pct: number, medRet5Pct: number): BreadthDay => ({ date: 'd', aboveMa20Pct, medRet5Pct, coverage: 1 })

  it('breadth:≥0.60 强 / ≤0.40 弱 / 之间中性(边界含等号)', () => {
    expect(labelBreadth(b(0.6, 0))).toBe('bStrong')
    expect(labelBreadth(b(0.59, 0))).toBe('bMid')
    expect(labelBreadth(b(0.4, 0))).toBe('bWeak')
    expect(labelBreadth(b(0.41, 0))).toBe('bMid')
  })

  it('chop:|medRet5| ≤1% 横盘,否则趋势(方向不论)', () => {
    expect(labelChop(b(0.5, 1))).toBe('chop')
    expect(labelChop(b(0.5, -1))).toBe('chop')
    expect(labelChop(b(0.5, 1.01))).toBe('trending')
    expect(labelChop(b(0.5, -2.5))).toBe('trending')
  })

  it('组合桶:bMid×chop(实盘 11 天假设桶)', () => {
    expect(labelCombo(b(0.5, 0.3))).toBe('bMid×chop')
    expect(labelCombo(b(0.7, 2))).toBe('bStrong×trending')
  })
})

describe('bucketTrades / gateEval', () => {
  const trade = (date: string, R: number): Trade => ({
    code: 'X', date, entry: 10, stop: 9, target: 12, exit: 10 + R, exitDate: date,
    reason: R > 0 ? 'target' : 'stop', retPct: R * 10, R, bars: 2,
  })
  const labels = new Map<string, string>([
    ['2026-01-05', 'chop'],
    ['2026-01-06', 'trending'],
  ])
  const labelOf = (d: string) => labels.get(d) ?? null

  it('按信号日标签分桶;无标签日计 unlabeled 不进桶', () => {
    const { buckets, unlabeled } = bucketTrades(
      [trade('2026-01-05', -1), trade('2026-01-05', -1), trade('2026-01-06', 2), trade('2026-02-01', 1)],
      labelOf,
    )
    expect(unlabeled).toBe(1)
    const chop = buckets.find((b) => b.label === 'chop')
    const trend = buckets.find((b) => b.label === 'trending')
    expect(chop?.metrics.n).toBe(2)
    expect(chop?.metrics.expectancyR).toBe(-1)
    expect(trend?.metrics.expectancyR).toBe(2)
  })

  it('gateEval:拦截桶与保留桶互斥完备,期望可对照', () => {
    const trades = [trade('2026-01-05', -1), trade('2026-01-06', 2)]
    const { all, kept, blocked } = gateEval(trades, (d) => labels.get(d) === 'chop')
    expect(all.n).toBe(2)
    expect(kept.n).toBe(1)
    expect(blocked.n).toBe(1)
    expect(kept.expectancyR).toBe(2) // 拦掉 chop 后期望 0.5→2
    expect(blocked.expectancyR).toBe(-1)
  })
})

describe('tercileEdges', () => {
  it('三分位边界(诊断用)', () => {
    const [t1, t2] = tercileEdges([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(t1).toBe(4)
    expect(t2).toBe(7)
    expect(tercileEdges([])).toEqual([0, 0])
  })
})
