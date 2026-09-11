// 持仓复盘 TA 的**数据契约**（公开侧）。
//
// 与 `screenerDataContract.ts` 同一条边界逻辑：公开侧要在不安装私有战法包的前提下
// 取数、缓存、落盘、展示持仓复盘，所以它必须知道「一张持仓 TA 卡长什么样」。
// 但**怎么算出这些数**（趋势模板 / VCP / N 字波段 / 三法合成 / 相对强度）属于私有层。
//
// 因此本文件只放两类东西：
//   ① 结构（类型）—— 字段名与取值范围，公开侧据此展示与拼 prompt；
//   ② 纯数据工具 —— 存档文件名解析、代码集合签名、同日覆盖守卫、形状守卫、时钟判定。
//
// 刻意**不**放：`buildHoldingTAFromBars` / `diffHoldingTA` / `enrichRelStrength`。
// 那三个要读战法阈值，由私有包实现，公开侧通过 `StrategyTechnicalAnalysis` 钩子调用。
//
// 从 `holdingsTARules.ts` 拆出（原 254 行）。拆的判据：把阈值常量全删掉之后，
// 本文件剩下的部分仍然自洽 —— 说明它是数据结构而不是战法。

import type { Pivots } from './taMath'
import type { SecurityMarket } from './securityCode'

export type MAKey = 'ma5' | 'ma10' | 'ma20' | 'ma60' | 'ma250'
export const MA_KEYS: readonly MAKey[] = ['ma5', 'ma10', 'ma20', 'ma60', 'ma250'] as const

/** 三法合成（Wyckoff + 价格行为 + 道氏）。**只描述形状**，口径由战法层给。 */
export interface HoldingTACombo {
  /** 0..1；<0.5 供给占优、>0.5 需求占优。 */
  score01: number
  bias: string
  /** 强派发 → 调用方降档 + ⚠。 */
  distribution: boolean
  wyckoffPhase: string
  tags: string[]
  note: string
}

/** N 字运动结果（波段角度/时间/异动）。口径属私有层，此处只取展示所需字段。 */
export interface HoldingTANPattern {
  role: string
  strength: string | null
  nBreak: boolean
  nTarget: number | null
  anomaly: { type: string } | null
  note: string
}

export interface HoldingTADelta {
  prevDate: string
  /** 三法合成分变化(今 − 昨)。 */
  score01: number
  biasChanged: { from: string; to: string } | null
  wyckoffChanged: { from: string; to: string } | null
  /** 昨无今有 = 新增派发警报(最高优先级提示)。 */
  distributionNew: boolean
  /** 'lost:ma5' / 'regain:ma20' …(仅两日该均线都有值时才算穿越,次新缺值不算)。 */
  maCrossings: string[]
  /** 多头排列翻转(两日都可判时才有意义;次新 null 不算)。 */
  trendTemplateChanged: boolean
  relStrengthDelta: number | null
  dist52PctDelta: number
  volRatioDelta: number
  /** N字运动变化(两日都有 nPattern 才比;旧磁盘存档缺此字段故可选)。 */
  nChanges?: string[]
}

export interface HoldingTAItem {
  code: string
  /** Missing on legacy archives; new results always include the resolved market. */
  market?: SecurityMarket
  name: string
  /** 信号日 = 最后一根 K 线日期。 */
  date: string
  close: number
  changePct: number
  /** 三法合成：score01/bias/distribution/wyckoffPhase/tags/note。 */
  combo: HoldingTACombo
  /** 多头排列(趋势模板);bars<271(次新)无法判 → null。 */
  trendTemplateOk: boolean | null
  ma: Record<MAKey, number>
  /** 站上与否(该均线数据不足=0 时恒 false,前端按"—"展示)。 */
  aboveMa: Record<MAKey, boolean>
  /** volMA5 / volMA50。 */
  volRatio: number
  /** 今日量 / volMA50(当日放量倍数)。 */
  breakoutVolRatio: number
  hi52: number
  /** 距 52 周高%:>0 在高点下方、≤0 创新高。 */
  dist52Pct: number
  /** 加权 63/126/189/252 日收益(次新缺项按 0 退化)。 */
  rsRaw: number
  /** 相对大盘强度(当日 pp 差,事后由战法层写入)。 */
  relStrength?: number
  counterTrend?: boolean
  atr14: number
  /** 波动止损参考 = close − ATR_STOP_MULT×ATR。 */
  atrStop: number
  /** 250 日前高(不含今日)。 */
  pivotHigh250: number
  /** 经典枢轴位 R1/R2/S1/S2(投射下一交易日)。 */
  pivots: Pivots
  /** N字运动(数据不足 → null,前端整块不渲染)。 */
  nPattern?: HoldingTANPattern | null
  delta?: HoldingTADelta | null
  /** 单票取数失败:只带 error 占位,不拖垮整包。 */
  error?: string
}

export interface HoldingsTANarrative {
  tone: string
  markdown: string
  generatedAt: string
}

export interface HoldingsTAResult {
  /** 信号日(各票最后 K 线日期的众数)。 */
  date: string
  generatedAt: string
  /** true=盘后定盘(可落盘);false=盘中 live(不落盘,前端标 live)。 */
  settled: boolean
  prevDate: string | null
  /** 三基准当日涨跌幅%(相对强度参照)。 */
  benchmarks: { hs300: number; chinext: number; star50: number; hsi?: number; hstech?: number }
  items: HoldingTAItem[]
  narrative: HoldingsTANarrative | null
  fromArchive?: boolean
}

// ── 纯数据工具（无阈值、无网络）─────────────────────────────────────────

/**
 * 当前时钟下,日线数据是否已定盘。混合持仓按最晚收市市场判定,
 * 避免 15:10 把港股半根日线落盘。
 */
export function isSettledClock(
  clock: { day: number; minutes: number },
  markets: readonly SecurityMarket[] = ['A'],
): boolean {
  if (clock.day === 0 || clock.day === 6) return true
  const close = markets.includes('HK') ? 16 * 60 + 10 : 15 * 60 + 10
  return clock.minutes < 9 * 60 + 15 || clock.minutes >= close
}

const ARCHIVE_RE = /^holdings-ta-(\d{4}-\d{2}-\d{2})\.json$/

export interface ArchiveRef {
  filename: string
  date: string
}

/** 严格前缀解析(不会捡走 screener 的 <date>.json / review-<date>.json)。 */
export function parseHoldingsTaArchiveName(filename: string): ArchiveRef | null {
  const m = ARCHIVE_RE.exec(filename)
  return m ? { filename, date: m[1] } : null
}

/** 目录清单里最近一份早于 before(信号日)的存档;无 → null。 */
export function pickPrevArchiveName(files: string[], before: string): ArchiveRef | null {
  let best: ArchiveRef | null = null
  for (const f of files) {
    const ref = parseHoldingsTaArchiveName(f)
    if (ref && ref.date < before && (!best || ref.date > best.date)) best = ref
  }
  return best
}

/** 持仓代码集合签名(排序去重;缓存 key 与存档 codes-diff 共用)。 */
export function codesKey(codes: string[]): string {
  return [...new Set(codes)].sort().join(',')
}

const okCount = (r: HoldingsTAResult) => r.items.filter((i) => !i.error).length

/**
 * 同日存档覆盖守卫(仿 screenerArchive.shouldReplaceArchive 防降级覆盖):
 * 无旧档 → 写;持仓集合变化(加减仓)→ 写;否则新档成功票数不倒退才写。
 */
export function shouldReplaceHoldingsArchive(prev: HoldingsTAResult | null, next: HoldingsTAResult): boolean {
  if (!prev) return true
  const itemKeys = (r: HoldingsTAResult) => r.items.map((i) => `${i.market ?? 'A'}:${i.code}`)
  if (codesKey(itemKeys(prev)) !== codesKey(itemKeys(next))) return true
  return okCount(next) >= okCount(prev)
}

/** 存档形状守卫(损坏档 → 弃用)。 */
export function isHoldingsTAResult(v: unknown): v is HoldingsTAResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.date === 'string' && typeof r.generatedAt === 'string' && Array.isArray(r.items)
}
