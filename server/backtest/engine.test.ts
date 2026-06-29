import { describe, it, expect } from 'vitest'
import { simForward, makeTrade, aggregate, type Trade } from './engine'
import type { Bar } from '../services/screenerRules'

// 小工具:构造一根 K 线(volume 任意,撮合内核不用)。
const bar = (date: string, open: number, high: number, low: number, close: number): Bar => ({
  date, open, high, low, close, volume: 1000,
})

describe('simForward', () => {
  // 信号日 i=0,entry 日收盘=10;后续逐日撮合。
  const sig = bar('2026-01-05', 10, 10, 10, 10)

  it('盘中触及目标 → target,exit=target', () => {
    const bars = [sig, bar('2026-01-06', 10, 12, 9.8, 11)]
    const sim = simForward(bars, 0, 9, 11.5, 20)
    expect(sim).toEqual({ exit: 11.5, reason: 'target', exitIdx: 1 })
  })

  it('盘中触及止损 → stop,exit=stop', () => {
    const bars = [sig, bar('2026-01-06', 9.5, 10, 8.5, 9)]
    const sim = simForward(bars, 0, 9, 12, 20)
    expect(sim).toEqual({ exit: 9, reason: 'stop', exitIdx: 1 })
  })

  it('跳空高开越过目标 → target-gap,exit=open', () => {
    const bars = [sig, bar('2026-01-06', 13, 14, 12.5, 13.5)]
    const sim = simForward(bars, 0, 9, 12, 20)
    expect(sim).toEqual({ exit: 13, reason: 'target-gap', exitIdx: 1 })
  })

  it('跳空低开跌破止损 → stop-gap,exit=open', () => {
    const bars = [sig, bar('2026-01-06', 8, 9, 7.5, 8.2)]
    const sim = simForward(bars, 0, 9, 12, 20)
    expect(sim).toEqual({ exit: 8, reason: 'stop-gap', exitIdx: 1 })
  })

  it('同根止损与目标同现 → 保守判止损先到', () => {
    // open 介于 stop/target 之间,low<=stop 且 high>=target → 止损优先(backtest 一致)。
    const bars = [sig, bar('2026-01-06', 10, 12, 8.5, 11)]
    const sim = simForward(bars, 0, 9, 11.5, 20)
    expect(sim.reason).toBe('stop')
    expect(sim.exit).toBe(9)
  })

  it('窗口内无触发 → time,exit=末根收盘,exitIdx=min(i+hold,len-1)', () => {
    const bars = [sig, bar('2026-01-06', 10, 11, 9, 10), bar('2026-01-07', 10, 11, 9, 10.5)]
    const sim = simForward(bars, 0, 5, 20, 2)
    expect(sim).toEqual({ exit: 10.5, reason: 'time', exitIdx: 2 })
  })

  it('hold 截断在 i+hold(未到序列末尾)', () => {
    const bars = [
      sig,
      bar('2026-01-06', 10, 11, 9, 10.2),
      bar('2026-01-07', 10, 11, 9, 10.4),
      bar('2026-01-08', 10, 11, 9, 10.9),
    ]
    const sim = simForward(bars, 0, 5, 20, 1) // hold=1 → end=i+1
    expect(sim).toEqual({ exit: 10.2, reason: 'time', exitIdx: 1 })
  })
})

describe('makeTrade', () => {
  it('计算 R=(exit-entry)/risk、retPct、持有根数', () => {
    const bars = [bar('2026-01-05', 10, 10, 10, 10), bar('2026-01-06', 10, 12, 9.8, 11)]
    const sim = simForward(bars, 0, 9, 11.5, 20) // target @ 11.5
    const trade = makeTrade('600000', bars, 0, 10, 9, 11.5, 1, sim)
    expect(trade.code).toBe('600000')
    expect(trade.date).toBe('2026-01-05')
    expect(trade.entry).toBe(10)
    expect(trade.exit).toBe(11.5)
    expect(trade.exitDate).toBe('2026-01-06')
    expect(trade.R).toBe(1.5) // (11.5-10)/1
    expect(trade.retPct).toBe(15) // (11.5/10-1)*100
    expect(trade.bars).toBe(1)
    expect(trade.reason).toBe('target')
  })

  it('risk 缩放后 R 一致(复权不变性的代数基础)', () => {
    // entry/stop/target 同比例放大 2× → R 不变。
    const bars = [bar('2026-01-05', 20, 20, 20, 20), bar('2026-01-06', 20, 24, 19.6, 22)]
    const sim = simForward(bars, 0, 18, 23, 20)
    const trade = makeTrade('X', bars, 0, 20, 18, 23, 2, sim)
    expect(trade.R).toBe(1.5) // (23-20)/2
  })
})

describe('aggregate', () => {
  const mk = (date: string, R: number, retPct: number, bars: number, reason: Trade['reason']): Trade => ({
    code: 'X', date, entry: 10, stop: 9, target: 12, exit: 10, exitDate: date, reason, retPct, R, bars,
  })

  it('空集合 → 全 0', () => {
    const m = aggregate([])
    expect(m).toMatchObject({ n: 0, winRate: 0, expectancyR: 0, profitFactor: 0, maxDDR: 0 })
  })

  it('胜率/期望/盈亏因子/最大回撤/出场占比', () => {
    const trades = [
      mk('2026-01-01', 2, 20, 3, 'target'),
      mk('2026-01-02', -1, -5, 2, 'stop'),
      mk('2026-01-03', -1, -5, 2, 'stop'),
    ]
    const m = aggregate(trades)
    expect(m.n).toBe(3)
    expect(m.winRate).toBe(33.33) // 1/3
    expect(m.expectancyR).toBe(0) // (2-1-1)/3
    expect(m.profitFactor).toBe(1) // 2 / 2
    expect(m.payoff).toBe(2) // 平均盈2 / |平均亏1|
    expect(m.maxDDR).toBe(2) // 资金曲线 +2 → +1 → 0,峰值2回撤到0
    expect(m.avgHoldBars).toBe(2.33) // (3+2+2)/3
    expect(m.targetRate).toBe(33.33)
    expect(m.stopRate).toBe(66.67)
    expect(m.timeRate).toBe(0)
  })

  it('win 判定为 R>0(R=0 计亏)', () => {
    const m = aggregate([mk('2026-01-01', 0, 0, 5, 'time')])
    expect(m.winRate).toBe(0)
  })
})
