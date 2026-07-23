// 盘后持仓深度技术分析 · 纯函数判定层(零 IO,可单测)。
// 【管理视图·非战法·不进回测】:对持仓逐只产出结构化 TA——三法合成(technicalCombo)+
// 多头排列(trendTemplate)+ MA5/10/20/60/250 + 量比 + 52周高距离 + RS + ATR/pivot 档位,
// 并与上一份存档做 delta(评分升降/失守均线/新增派发)。IO/缓存/落盘见 holdingsTA.ts。
import { HOLDINGS, type HoldingsConfig } from '../config/screener'
import { technicalCombo, type TechnicalCombo } from './technicalScore'
import { type Bar, type Pivots, atr, computeVCP, pivotLevels, r2, rsRaw, smaAt, trendTemplate } from './screenerRules'
import { max52w } from './ashare'
import { analyzeNPattern, nStrengthLabel, type NPatternResult } from './nPattern'

export type MAKey = 'ma5' | 'ma10' | 'ma20' | 'ma60' | 'ma250'
export const MA_KEYS: readonly MAKey[] = ['ma5', 'ma10', 'ma20', 'ma60', 'ma250'] as const
const MA_PERIODS: Record<MAKey, number> = { ma5: 5, ma10: 10, ma20: 20, ma60: 60, ma250: 250 }

export interface HoldingTADelta {
  prevDate: string
  /** 三法合成分变化(今 − 昨)。 */
  score01: number
  biasChanged: { from: TechnicalCombo['bias']; to: TechnicalCombo['bias'] } | null
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
  /** N字运动变化:'N强弱:弱势反弹→强势反弹' / '⚡抗跌转强' / 'N字延续确认'…(两日都有 nPattern 才比;旧磁盘存档缺此字段故可选)。 */
  nChanges?: string[]
}

export interface HoldingTAItem {
  code: string
  name: string
  /** 信号日 = 最后一根 K 线日期。 */
  date: string
  close: number
  changePct: number
  /** 三法合成(Wyckoff+价格行为+道氏):score01/bias/distribution/wyckoffPhase/tags/note。 */
  combo: TechnicalCombo
  /** 多头排列(趋势模板);bars<271(次新)无法判 → null。 */
  trendTemplateOk: boolean | null
  ma: Record<MAKey, number>
  /** 站上与否(该均线数据不足=0 时恒 false,前端按"—"展示)。 */
  aboveMa: Record<MAKey, boolean>
  /** volMA5 / volMA50(computeVCP 口径)。 */
  volRatio: number
  /** 今日量 / volMA50(当日放量倍数)。 */
  breakoutVolRatio: number
  hi52: number
  /** 距 52 周高%:>0 在高点下方、≤0 创新高。 */
  dist52Pct: number
  /** 加权 63/126/189/252 日收益(次新缺项按 0 退化)。 */
  rsRaw: number
  /** 相对大盘强度(当日 pp 差,事后 enrichRelStrength 写入)。 */
  relStrength?: number
  counterTrend?: boolean
  atr14: number
  /** 波动止损参考 = close − ATR_STOP_MULT×ATR。 */
  atrStop: number
  /** 250 日前高(不含今日,computeVCP.resistPrior 口径)。 */
  pivotHigh250: number
  /** 经典枢轴位 R1/R2/S1/S2(投射下一交易日)。 */
  pivots: Pivots
  /** N字运动(波段角度/时间/异动;数据不足 → null,前端整块不渲染)。 */
  nPattern?: NPatternResult | null
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
  benchmarks: { hs300: number; chinext: number; star50: number }
  items: HoldingTAItem[]
  narrative: HoldingsTANarrative | null
  fromArchive?: boolean
}

const r4 = (n: number) => Math.round(n * 10000) / 10000

/** 单票结构化 TA(不含 relStrength/delta,二者事后补)。bars < 2 无法计算 → null(调用方标 error)。 */
export function buildHoldingTAFromBars(
  code: string,
  name: string,
  bars: Bar[],
  cfg: HoldingsConfig = HOLDINGS,
): HoldingTAItem | null {
  const n = bars.length
  if (n < 2) return null
  const last = n - 1
  const today = bars[last]
  const prev = bars[last - 1]
  if (!(today.close > 0)) return null
  const closes = bars.map((b) => b.close)

  const ma = {} as Record<MAKey, number>
  const aboveMa = {} as Record<MAKey, boolean>
  for (const k of MA_KEYS) {
    const v = smaAt(closes, MA_PERIODS[k], last)
    ma[k] = r2(v)
    aboveMa[k] = v > 0 && today.close > v
  }

  const combo = technicalCombo(bars, code)
  const tt = trendTemplate(bars)
  const vcp = computeVCP(bars)
  const hi52 = max52w(bars.map((b) => b.high))
  const atrV = atr(bars, cfg.ATR_PERIOD, last)

  return {
    code,
    name,
    date: today.date,
    close: today.close,
    changePct: prev.close > 0 ? r2((today.close / prev.close - 1) * 100) : 0,
    combo,
    trendTemplateOk: tt ? tt.pass : null,
    ma,
    aboveMa,
    volRatio: r2(vcp.volRatio),
    breakoutVolRatio: vcp.volSlow > 0 ? r2(today.volume / vcp.volSlow) : 1,
    hi52: r2(hi52),
    dist52Pct: hi52 > 0 ? r2(((hi52 - today.close) / hi52) * 100) : 0,
    rsRaw: r4(rsRaw(closes)),
    atr14: r2(atrV),
    atrStop: r2(today.close - cfg.ATR_STOP_MULT * atrV),
    pivotHigh250: r2(vcp.resistPrior),
    pivots: pivotLevels(today),
    nPattern: analyzeNPattern(bars),
    delta: null,
  }
}

/** 今昨两份同票 TA 的变化(昨档由服务层按信号日之前最近存档取出)。 */
export function diffHoldingTA(prev: HoldingTAItem, cur: HoldingTAItem, prevDate: string): HoldingTADelta {
  const maCrossings: string[] = []
  for (const k of MA_KEYS) {
    if (!(prev.ma[k] > 0) || !(cur.ma[k] > 0)) continue // 数据不足不算穿越
    if (prev.aboveMa[k] && !cur.aboveMa[k]) maCrossings.push(`lost:${k}`)
    else if (!prev.aboveMa[k] && cur.aboveMa[k]) maCrossings.push(`regain:${k}`)
  }
  // N字运动变化(任一侧缺 nPattern —— 如旧存档 —— 不比,回 [])。
  const nChanges: string[] = []
  const pn = prev.nPattern
  const cn = cur.nPattern
  if (pn && cn) {
    const pLabel = nStrengthLabel(pn.role, pn.strength)
    const cLabel = nStrengthLabel(cn.role, cn.strength)
    if (pLabel !== cLabel) nChanges.push(`N强弱:${pLabel}→${cLabel}`)
    if (cn.anomaly && cn.anomaly.type !== pn.anomaly?.type) nChanges.push(`⚡${cn.anomaly.type}`)
    if (!pn.nBreak && cn.nBreak) nChanges.push('N字延续确认')
  }

  return {
    prevDate,
    score01: r2(cur.combo.score01 - prev.combo.score01),
    biasChanged: prev.combo.bias !== cur.combo.bias ? { from: prev.combo.bias, to: cur.combo.bias } : null,
    wyckoffChanged:
      prev.combo.wyckoffPhase !== cur.combo.wyckoffPhase
        ? { from: prev.combo.wyckoffPhase, to: cur.combo.wyckoffPhase }
        : null,
    distributionNew: !prev.combo.distribution && cur.combo.distribution,
    maCrossings,
    trendTemplateChanged:
      prev.trendTemplateOk !== null && cur.trendTemplateOk !== null && prev.trendTemplateOk !== cur.trendTemplateOk,
    relStrengthDelta:
      typeof prev.relStrength === 'number' && typeof cur.relStrength === 'number'
        ? r2(cur.relStrength - prev.relStrength)
        : null,
    dist52PctDelta: r2(cur.dist52Pct - prev.dist52Pct),
    volRatioDelta: r2(cur.volRatio - prev.volRatio),
    nChanges,
  }
}

/**
 * 当前时钟下,日线数据是否已定盘:周末 true;工作日 [09:15, 15:10) 为盘中 live(集合竞价 09:15
 * 起当日 bar 开始变动),其余(盘前=昨日定盘、15:10 后=今日定盘,与叙事门控 15:10 对齐)true。
 */
export function isSettledClock(clock: { day: number; minutes: number }): boolean {
  if (clock.day === 0 || clock.day === 6) return true
  return clock.minutes < 9 * 60 + 15 || clock.minutes >= 15 * 60 + 10
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
  if (codesKey(prev.items.map((i) => i.code)) !== codesKey(next.items.map((i) => i.code))) return true
  return okCount(next) >= okCount(prev)
}

/** 存档形状守卫(损坏档 → 弃用)。 */
export function isHoldingsTAResult(v: unknown): v is HoldingsTAResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.date === 'string' && typeof r.generatedAt === 'string' && Array.isArray(r.items)
}
