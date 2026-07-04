// REGIMEBUCKET 市场状态分桶 —— 纯函数内核(可单测,无网络无 IO)。
//
// 动机(2026-07-04):实盘战绩 11 个交易日(regime=caution/weak)里突破族全军覆没
// (总体 −0.33R/止损率 78.5%/平均 2.2 根出局),但历史回测曾发现「弱市(指数MA口径)
// 新高期望反而最高 0.85R」(TARGET_R_BY_REGIME 逆向映射的依据)。两个"弱"口径必须
// 分开裁决:指数 MA 位置(口径 i,buildRegimeByDate)不等于「震荡/缩量磨人市」。
// 本模块提供口径 ii —— 用回测样本自身横截面构造的 breadth/chop 序列,零外部数据:
//   · aboveMa20Pct:样本内当日站上 MA20 的比例(市场宽度)
//   · medRet5Pct  :样本内 5 日收益中位数(趋势方向/力度)
// 标签全部是固定阈值(将来若上线闸门必须线上可复算,不能用事后分位数)。
import { aggregate, type Trade, type Metrics } from './engine'
import type { StockBars } from './universe'

const r2 = (n: number) => Math.round(n * 100) / 100

// ── 固定阈值(线上可复算;三分位仅作 in-sample 对照诊断,不做闸门)──────────
export const BREADTH_STRONG = 0.6 // ≥60% 站上 MA20 → bStrong
export const BREADTH_WEAK = 0.4 // ≤40% → bWeak;之间 bMid
export const CHOP_ABS_PCT = 1 // |5日收益中位数| ≤1% → chop(横盘震荡),否则 trending
export const COVERAGE_MIN = 0.5 // 当日可算 MA20 的样本占比 <50% 的日期剔除(样本早期噪声)

export interface BreadthDay {
  date: string
  aboveMa20Pct: number // 0..1
  medRet5Pct: number // %(中位 5 日收益)
  coverage: number // 0..1(当日可算 MA20 的样本占比)
}

/** 逐票单遍滚动构造每日 breadth(300票×700根≈21万点,毫秒级)。coverage<COVERAGE_MIN 的日期剔除。 */
export function buildBreadthByDate(data: StockBars[]): Map<string, BreadthDay> {
  const acc = new Map<string, { above: number; eligible: number; rets: number[] }>()
  for (const sb of data) {
    const bars = sb.bars
    let sum = 0
    for (let j = 0; j < bars.length; j++) {
      sum += bars[j].close
      if (j >= 20) sum -= bars[j - 20].close
      if (j < 19) continue // MA20 未成型
      const ma20 = sum / 20
      const a = acc.get(bars[j].date) ?? { above: 0, eligible: 0, rets: [] }
      a.eligible++
      if (bars[j].close > ma20) a.above++
      if (bars[j - 5].close > 0) a.rets.push((bars[j].close / bars[j - 5].close - 1) * 100)
      acc.set(bars[j].date, a)
    }
  }
  const total = data.length || 1
  const out = new Map<string, BreadthDay>()
  for (const [date, a] of [...acc.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const coverage = a.eligible / total
    if (coverage < COVERAGE_MIN) continue
    out.set(date, {
      date,
      aboveMa20Pct: r2(a.above / a.eligible * 100) / 100,
      medRet5Pct: r2(median(a.rets)),
      coverage: r2(coverage),
    })
  }
  return out
}

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export type BreadthLabel = 'bStrong' | 'bMid' | 'bWeak'
export type ChopLabel = 'chop' | 'trending'

export function labelBreadth(b: BreadthDay): BreadthLabel {
  if (b.aboveMa20Pct >= BREADTH_STRONG) return 'bStrong'
  if (b.aboveMa20Pct <= BREADTH_WEAK) return 'bWeak'
  return 'bMid'
}

export function labelChop(b: BreadthDay): ChopLabel {
  return Math.abs(b.medRet5Pct) <= CHOP_ABS_PCT ? 'chop' : 'trending'
}

/** 组合桶(6格):bMid×chop 即实盘 11 天那种「中性宽度×横盘」缩量磨人市的假设桶。 */
export function labelCombo(b: BreadthDay): string {
  return `${labelBreadth(b)}×${labelChop(b)}`
}

// ── 分桶聚合 / 闸门净收益(纯函数)─────────────────────────────────────
export interface BucketRow {
  label: string
  metrics: Metrics
}

/** 按 labelOf(信号日) 分桶聚合;返回 null 的信号日不进桶(计 unlabeled,如实报告)。 */
export function bucketTrades(trades: Trade[], labelOf: (date: string) => string | null): { buckets: BucketRow[]; unlabeled: number } {
  const byLabel = new Map<string, Trade[]>()
  let unlabeled = 0
  for (const t of trades) {
    const l = labelOf(t.date)
    if (l == null) {
      unlabeled++
      continue
    }
    const arr = byLabel.get(l) ?? []
    arr.push(t)
    byLabel.set(l, arr)
  }
  return {
    buckets: [...byLabel.entries()]
      .map(([label, ts]) => ({ label, metrics: aggregate(ts) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    unlabeled,
  }
}

/** 闸门净收益:isBlocked(信号日)=true 的交易被拦截。kept=闸门后仍执行的交易。
 *  判据看 kept 相对 all 的期望/PF 变化 + blocked 桶本身是否确实差。 */
export function gateEval(trades: Trade[], isBlocked: (date: string) => boolean): { all: Metrics; kept: Metrics; blocked: Metrics } {
  const kept: Trade[] = []
  const blocked: Trade[] = []
  for (const t of trades) (isBlocked(t.date) ? blocked : kept).push(t)
  return { all: aggregate(trades), kept: aggregate(kept), blocked: aggregate(blocked) }
}

/** 三分位边界(仅诊断对照:验证固定阈值没把分布切歪;不用于闸门——事后分位数线上不可复算)。 */
export function tercileEdges(values: number[]): [number, number] {
  const s = [...values].sort((a, b) => a - b)
  if (!s.length) return [0, 0]
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]
  return [q(1 / 3), q(2 / 3)]
}
