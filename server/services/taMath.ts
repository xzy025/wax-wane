// 通用技术分析原语（无策略参数、无网络、可单测）。
//
// 本文件从 `screenerRules.ts` 拆出：那一版把通用数学与「新高战法」判定混在一个模块里，
// 而通用部分被 50+ 个文件引用（横跨采集、复盘、脚本、回测）。拆分后
// `screenerRules.ts` 归入私有战法层，本文件留在公开侧作为 host 原语。
//
// 边界：这里**只放与策略无关**的东西 —— K 线结构、均值、ATR、枢轴位。
// 任何带策略阈值参数（`ScreenerConfig` 之类）的函数都不属于本文件。

export interface Bar {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  // 以下二者来自 EM 日线(已解析进 KlineBar,经 `as Bar[]` 透传);Tencent 兜底缺成交额。
  turnover?: number | null // 成交额(元,EM f57);缺失保持 null，计算须显式降级
  amplitude?: number // 振幅%(EM f58);缺失时用 (高−低)/昨收 计算
  /** Optional provenance carried by point-in-time market-data adapters. */
  provider?: string
  adjustment?: 'raw' | 'qfq' | 'hfq' | 'none' | 'unknown'
  providerAt?: string | null
  receivedAt?: string
  settled?: boolean
  /** Optional next-session execution metadata supplied by a replay adapter. */
  tradable?: boolean
  suspended?: boolean
  limitUp?: boolean
  limitDown?: boolean
  raw?: {
    open: number
    close: number
    high: number
    low: number
  } | null
  adjustmentFactor?: number | null
}

/** 经典枢轴位(floor pivot):压力 R1/R2、支撑 S1/S2。 */
export interface Pivots {
  r1: number
  r2: number
  s1: number
  s2: number
}

/** 由最近一根 bar 的 H/L/C 计算经典枢轴位(投射下一交易日的压力/支撑)。 */
export function pivotLevels(bar: { high: number; low: number; close: number }): Pivots {
  const p = (bar.high + bar.low + bar.close) / 3
  const range = bar.high - bar.low
  return {
    r1: Math.round((2 * p - bar.low) * 100) / 100,
    r2: Math.round((p + range) * 100) / 100,
    s1: Math.round((2 * p - bar.high) * 100) / 100,
    s2: Math.round((p - range) * 100) / 100,
  }
}

/** 保留两位小数(展示口径)。 */
export const r2 = (n: number) => Math.round(n * 100) / 100
/** 夹取 [0,1](打分归一)。 */
export const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
/** 算术均值(空数组=0)。 */
export const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

/** 末端 N 根收盘均值(SMA,以 endIdx 结尾)。 */
export function smaAt(closes: number[], period: number, endIdx: number): number {
  if (endIdx - period + 1 < 0) return 0
  return mean(closes.slice(endIdx - period + 1, endIdx + 1))
}

/** ATR:以 endIdx 结尾的 period 根真实波幅均值。 */
export function atr(bars: Bar[], period: number, endIdx: number): number {
  let sum = 0
  let cnt = 0
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    if (i <= 0) continue
    const h = bars[i].high
    const l = bars[i].low
    const pc = bars[i - 1].close
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
    cnt++
  }
  return cnt ? sum / cnt : 0
}

// ── K 线形态比（从 `divergenceRules.ts` 拆出）──────────────────────────
//
// `divergenceRules.ts` 整体归入私有战法层（它带 DIVERGENCE / HIGHDIV 阈值），
// 但这四个是**无参数的形态比**，被公开侧的 `limitLadder` 与私有侧的多个战法共用。
// 判定依据：函数体里没有任何阈值常量，纯几何。

/** 当日振幅（高−低）。 */
export const candleRange = (b: Bar) => b.high - b.low

/** 实体率 |收−开|/(高−低)。 */
export const bodyRatio = (b: Bar) => (candleRange(b) > 0 ? Math.abs(b.close - b.open) / candleRange(b) : 0)

/** 下影率 (min(开,收)−低)/(高−低)。 */
export const lowerWickRatio = (b: Bar) =>
  candleRange(b) > 0 ? (Math.min(b.open, b.close) - b.low) / candleRange(b) : 0

/** 上影率 (高−max(开,收))/(高−低)。 */
export const upperWickRatio = (b: Bar) =>
  candleRange(b) > 0 ? (b.high - Math.max(b.open, b.close)) / candleRange(b) : 0
