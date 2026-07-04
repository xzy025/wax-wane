import { describe, it, expect } from 'vitest'
import { simulateEntry, selectFrontier, split, type Cell } from './optimize'
import type { Metrics, Trade } from './engine'
import type { Bar } from '../services/screenerRules'

const bar = (date: string, open: number, high: number, low: number, close: number): Bar => ({
  date, open, high, low, close, volume: 1000,
})

describe('simulateEntry — 入场模式 + 比率重锚', () => {
  const lv = { entry: 10, stop: 9, target: 12 } // stopFrac=0.9, targetFrac=1.2

  it('close:信号日收盘入场,entryIdx=i', () => {
    const bars = [bar('d0', 10, 10, 10, 10), bar('d1', 10, 12, 9.8, 11)]
    const r = simulateEntry(bars, 0, lv, 'close', 0, 20, 'X')
    expect(r).not.toBeNull()
    expect(r!.entryIdx).toBe(0)
    expect(r!.trade.entry).toBe(10)
    expect(r!.trade.reason).toBe('target')
    expect(r!.trade.R).toBe(2) // (12-10)/1
  })

  it('nextOpen:次日开盘入场,entryIdx=i+1、入场日起参与撮合;重锚后 R 不变', () => {
    const bars = [bar('d0', 10, 10, 10, 10), bar('d1', 10.2, 10.5, 10, 10.3), bar('d2', 10.3, 13, 10.2, 12.5)]
    const r = simulateEntry(bars, 0, lv, 'nextOpen', 0, 20, 'X')
    expect(r).not.toBeNull()
    expect(r!.entryIdx).toBe(1)
    expect(r!.trade.entry).toBe(10.2) // 次日开盘
    // 重锚:stop=10.2*0.9=9.18, target=10.2*1.2=12.24;d1 未触发,d2 high13≥12.24 → target
    expect(r!.trade.reason).toBe('target')
    expect((r!.trade.exit - r!.trade.entry) / (r!.trade.entry - r!.trade.stop)).toBeCloseTo(r!.trade.R, 5)
    expect(r!.trade.R).toBe(2) // 比率保留 → 仍 2R
  })

  it('nextOpen:入场日盘中触及重锚止损 → 当日 stop、R=-1(修复前被漏撮合记成后日结果)', () => {
    // d1 open=10.2 → stop=9.18;d1 low=9.0≤9.18,当日止损;d2 涨停也救不回。
    const bars = [bar('d0', 10, 10, 10, 10), bar('d1', 10.2, 10.6, 9.0, 9.2), bar('d2', 10, 13, 10, 12.9)]
    const r = simulateEntry(bars, 0, lv, 'nextOpen', 0, 20, 'X')
    expect(r).not.toBeNull()
    expect(r!.trade.reason).toBe('stop')
    expect(r!.trade.exitDate).toBe('d1')
    expect(r!.trade.R).toBe(-1)
  })

  it('nextOpen:入场日冲高触及重锚目标 → 当日 target', () => {
    // d1 open=10.2 → target=12.24;d1 high=12.5≥12.24 当日止盈。
    const bars = [bar('d0', 10, 10, 10, 10), bar('d1', 10.2, 12.5, 10.1, 12.2)]
    const r = simulateEntry(bars, 0, lv, 'nextOpen', 0, 20, 'X')
    expect(r).not.toBeNull()
    expect(r!.trade.reason).toBe('target')
    expect(r!.trade.exitDate).toBe('d1')
    expect(r!.trade.R).toBe(2)
  })

  it('nextGapUp:未达高开阈值 → null', () => {
    // bars[0].close=10,阈值 2% 需 open≥10.2;d1.open=10.1 → 不入场
    const bars = [bar('d0', 10, 10, 10, 10), bar('d1', 10.1, 10.5, 10, 10.3), bar('d2', 10.3, 13, 10.2, 12.5)]
    expect(simulateEntry(bars, 0, lv, 'nextGapUp', 2, 20, 'X')).toBeNull()
  })

  it('nextGapUp:达阈值 → 次日开盘入场', () => {
    const bars = [bar('d0', 10, 10, 10, 10), bar('d1', 10.3, 11, 10.2, 10.8), bar('d2', 10.8, 13, 10.5, 12.5)]
    const r = simulateEntry(bars, 0, lv, 'nextGapUp', 2, 20, 'X')
    expect(r).not.toBeNull()
    expect(r!.trade.entry).toBe(10.3)
  })

  it('风险≤0(stop≥entry)→ null', () => {
    const bars = [bar('d0', 10, 10, 10, 10), bar('d1', 10, 11, 9, 10)]
    expect(simulateEntry(bars, 0, { entry: 10, stop: 10, target: 12 }, 'close', 0, 20, 'X')).toBeNull()
  })

  it('nextOpen 但无次根 → null', () => {
    const bars = [bar('d0', 10, 10, 10, 10)]
    expect(simulateEntry(bars, 0, lv, 'nextOpen', 0, 20, 'X')).toBeNull()
  })
})

describe('split — train/test 时序切分(purge 泄漏防护)', () => {
  const trade = (date: string, exitDate: string, R: number): Trade => ({
    code: 'X', date, entry: 10, stop: 9, target: 12, exit: 10 + R, exitDate,
    reason: 'time', retPct: R * 10, R, bars: 3,
  })
  const cutoff = '2025-06-01'

  it('持有窗完全在 train 段 → train;信号日在 cutoff 后 → test', () => {
    const { train, test, purged } = split(
      [trade('2025-01-05', '2025-01-20', 1), trade('2025-07-01', '2025-07-10', -1)],
      cutoff,
    )
    expect(train.n).toBe(1)
    expect(test.n).toBe(1)
    expect(purged).toBe(0)
  })

  it('信号日在 cutoff 前、出场在 cutoff 后(跨界带)→ 两集皆不进,计 purged', () => {
    const crossing = trade('2025-05-20', '2025-06-10', 2) // train 交易的出场价来自 test 段 K 线
    const { train, test, purged } = split([crossing], cutoff)
    expect(train.n).toBe(0) // 旧版按信号日二分会把它计入 train=泄漏
    expect(test.n).toBe(0)
    expect(purged).toBe(1)
  })

  it('出场恰在 cutoff 当日 → 不进 train(train 需 exitDate < cutoff)', () => {
    const { train, purged } = split([trade('2025-05-20', '2025-06-01', 1)], cutoff)
    expect(train.n).toBe(0)
    expect(purged).toBe(1)
  })
})

describe('selectFrontier — 约束·期望·OOS 门槛', () => {
  const m = (over: Partial<Metrics>): Metrics => ({
    n: 0, winRate: 0, avgRetPct: 0, avgWinPct: 0, avgLossPct: 0, payoff: 0,
    profitFactor: 0, expectancyR: 0, maxDDR: 0, avgHoldBars: 0, targetRate: 0, stopRate: 0, timeRate: 0, ...over,
  })
  const cell = (id: string, train: Partial<Metrics>, test: Partial<Metrics>): Cell => ({
    entry: id, hold: 3, rMult: 2, stop: 8, train: m(train), test: m(test),
  })

  it('约束带内取期望最高、且 OOS 站得住的格(跳过 OOS 崩的更高期望格)', () => {
    const cells = [
      cell('A', { n: 100, winRate: 50, expectancyR: 0.3 }, { winRate: 40, expectancyR: 0.2 }), // 合格 + OOS 过
      cell('B', { n: 100, winRate: 60, expectancyR: 0.5 }, { winRate: 20, expectancyR: -0.1 }), // 期望更高但 OOS 崩
      cell('C', { n: 20, winRate: 70, expectancyR: 0.6 }, { winRate: 60, expectancyR: 0.5 }), // n<MIN_N 出局
      cell('D', { n: 100, winRate: 30, expectancyR: 0.4 }, { winRate: 30, expectancyR: 0.3 }), // train 胜率<40 出局
    ]
    const { recommended } = selectFrontier(cells, 30)
    expect(recommended).not.toBeNull()
    expect(recommended!.entry).toBe('A') // B 期望更高但 OOS 不过 → 退而取 A
  })

  it('约束带内无 OOS 通过 → recommended=null(不强凑)', () => {
    const cells = [
      cell('B', { n: 100, winRate: 60, expectancyR: 0.5 }, { winRate: 20, expectancyR: -0.1 }),
      cell('D', { n: 100, winRate: 30, expectancyR: 0.4 }, { winRate: 30, expectancyR: 0.3 }),
    ]
    expect(selectFrontier(cells, 30).recommended).toBeNull()
  })

  it('Pareto 前沿:被两维都不更差且至少一维更优者支配的格不在前沿', () => {
    const cells = [
      cell('A', { n: 100, winRate: 50, expectancyR: 0.3 }, {}),
      cell('B', { n: 100, winRate: 60, expectancyR: 0.5 }, {}), // 支配 A 与 D
      cell('D', { n: 100, winRate: 30, expectancyR: 0.4 }, {}),
      cell('C', { n: 20, winRate: 99, expectancyR: 9 }, {}), // n<MIN_N 不进池
    ]
    const { frontier } = selectFrontier(cells, 30)
    const keys = frontier.map((c) => c.entry)
    expect(keys).toContain('B')
    expect(keys).not.toContain('A')
    expect(keys).not.toContain('C') // 小样本被 MIN_N 挡在池外
  })
})
