import { describe, it, expect } from 'vitest'
import { classifyPullback } from './pullbackRules'
import { type Bar } from './screenerRules'

/**
 * 合成「回调二次启动」形态(300 根):
 *   base(平台) → advance(拉升到 peak) → correction(回调到 corrLow) →
 *   arc(自低回升) → today(异常放量 + 收阳)。
 * 通过 opts 单点变异来构造各「缺一要素 → null」用例。
 */
function makeBars(o: {
  peakIdx?: number
  peak?: number
  base?: number
  corrLow?: number
  corrEndIdx?: number
  prevClose?: number
  todayClose?: number
  todayVol?: number
} = {}): Bar[] {
  const peakIdx = o.peakIdx ?? 250
  const peak = o.peak ?? 266
  const base = o.base ?? 60
  const corrLow = o.corrLow ?? 150
  const corrEndIdx = o.corrEndIdx ?? 275
  const prevClose = o.prevClose ?? 185
  const N = 300
  const bars: Bar[] = []
  const push = (i: number, close: number, vol = 1000, hi?: number, lo?: number) =>
    bars.push({ date: `d${i}`, open: close, close, high: hi ?? close * 1.01, low: lo ?? close * 0.99, volume: vol })

  const advStart = Math.max(1, peakIdx - 100)
  for (let i = 0; i < advStart; i++) push(i, base) // 平台基底 → 52周低
  for (let i = advStart; i <= peakIdx; i++) push(i, base + (peak - base) * ((i - advStart) / (peakIdx - advStart))) // 拉升
  for (let i = peakIdx + 1; i <= corrEndIdx; i++) push(i, peak + (corrLow - peak) * ((i - peakIdx) / (corrEndIdx - peakIdx))) // 回调
  for (let i = corrEndIdx + 1; i <= N - 2; i++) push(i, corrLow + (prevClose - corrLow) * ((i - corrEndIdx) / (N - 2 - corrEndIdx))) // 回弧
  const todayClose = o.todayClose ?? 188
  push(N - 1, todayClose, o.todayVol ?? 3000, todayClose * 1.02, prevClose * 0.99) // 今日:放量启动
  return bars
}

describe('classifyPullback', () => {
  it('命中典型「回调圆弧底·放量二次启动」', () => {
    const cand = classifyPullback(makeBars())
    expect(cand).not.toBeNull()
    expect(cand!.signals.leader).toBe(true)
    expect(cand!.signals.volSpike).toBe(true)
    // 近高 ≈266、调整 ≈49 天、回调深度落斐波带、目标=测量到近高、止损=圆弧底低点
    expect(cand!.priorHigh).toBeGreaterThan(260)
    expect(cand!.daysSinceHigh).toBeGreaterThanOrEqual(15)
    expect(cand!.retracePct).toBeGreaterThan(30)
    expect(cand!.retracePct).toBeLessThan(65)
    expect(cand!.target).toBeGreaterThan(cand!.price) // measured → 近高在上方
    expect(cand!.stopLoss).toBeLessThan(cand!.price) // 圆弧底低点在下方
    expect(cand!.score).toBeGreaterThan(0)
    expect(cand!.score).toBeLessThanOrEqual(100)
  })

  it('无异常放量 → null(⑥不满足)', () => {
    expect(classifyPullback(makeBars({ todayVol: 1000 }))).toBeNull()
  })

  it('今日收阴(非收阳启动)→ null(⑥不满足)', () => {
    expect(classifyPullback(makeBars({ todayClose: 183, prevClose: 185 }))).toBeNull()
  })

  it('回调过浅(未达斐波带)→ null(②不满足)', () => {
    expect(classifyPullback(makeBars({ corrLow: 240 }))).toBeNull()
  })

  it('非龙头(涨幅不足,近高/52周低偏小)→ null(①不满足)', () => {
    // base 抬到 200:hi/lo≈1.33 < 1.8,且 C 难站上 MA250
    expect(classifyPullback(makeBars({ base: 200, corrLow: 210, prevClose: 235, todayClose: 238 }))).toBeNull()
  })

  it('K 线不足 → null', () => {
    expect(classifyPullback(makeBars().slice(-100))).toBeNull()
  })
})
