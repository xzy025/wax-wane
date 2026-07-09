// 大盘反攻日·先锋股 — 纯函数判定层(无网络,可单测)。
// 事件:指数连续杀跌数日后放量大阳反攻(2026-07-09 原型:上证连跌后 +1.65%/量比过线)。
// 先锋两型:① 长电科技型=反攻日率先涨停(低位首板/二板) ② 东山精密型=连跌窗内抗跌·反攻日放量领涨。
// reversalDay 是独立事件判据,不合并进 buildRegime(情绪 phase)/marketRegime(均线趋势)两套现有 regime。
// 相对强度分工:单日 pp 差=screenerRules.enrichRelStrength(RELSTR,裁决现状不动);多日窗口累计=本文件 cumRelStrength。
import { REBOUND, type ReboundConfig } from '../config/screener'
import { type Bar, mean, r2 } from './screenerRules'
import { isLimitUpDay, consecutiveLimitUps } from './divergenceRules'

/** 指数日线(与 ashare.fetchIndexKline 返回的 IndexKlineBar 结构兼容;纯层自持类型,同 Bar/KlineBar 惯例)。 */
export interface IndexBar {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount?: number
}

export interface ReversalSignal {
  date: string
  chgPct: number // 反攻日指数涨幅%
  volRatio: number // 当日量 / 前 VOL_BASE_WIN 日均量
  downDays: number // 反攻日前连续下跌天数
  downCumPct: number // 前 DOWN_WINDOW 日累计涨跌幅%(负=杀跌)
}

/** 连跌窗(先锋抗跌因子的对齐窗口):[连跌起点前一日(基准日) .. 反攻日前一交易日]。
 *  含基准日 → 窗内首尾累计涨跌幅覆盖完整下跌段(与 downCumPct 同基准),首个下跌日的逆势红盘可计入配对。 */
export interface DeclineWindow {
  fromDate: string
  toDate: string
}

const minBarsForSignal = (C: ReboundConfig) => Math.max(C.VOL_BASE_WIN + 1, C.DOWN_WINDOW + 2)

/** 反攻日前连续下跌天数(以 last-1 为最后一个候选下跌日往前数)。 */
function consecutiveDownDays(bars: IndexBar[]): number {
  let n = 0
  for (let i = bars.length - 2; i >= 1; i--) {
    if (bars[i].close < bars[i - 1].close) n++
    else break
  }
  return n
}

/**
 * 判定序列最后一根是否为「反攻日」:
 * (连跌 ≥ DOWN_DAYS_MIN 或 近 DOWN_WINDOW 日累计 ≤ DOWN_CUM_PCT) 且 涨幅 ≥ UP_PCT_MIN 且 收阳 且 量比 ≥ VOL_RATIO_MIN。
 * 只看序列内数据(调用方 slice(0,i+1) 喂,天然防前视,与 classify 同约定)。
 */
export function detectReversalDay(bars: IndexBar[], C: ReboundConfig = REBOUND): ReversalSignal | null {
  const len = bars.length
  if (len < minBarsForSignal(C)) return null
  const last = bars[len - 1]
  const prev = bars[len - 2]
  if (prev.close <= 0) return null

  const chgPct = ((last.close - prev.close) / prev.close) * 100
  if (chgPct < C.UP_PCT_MIN) return null
  if (last.close <= last.open) return null // 须收阳(大阳反攻,排除低开高走仍收阴的弱反抽)

  const baseVol = mean(bars.slice(len - 1 - C.VOL_BASE_WIN, len - 1).map((b) => b.volume))
  if (baseVol <= 0) return null
  const volRatio = last.volume / baseVol
  if (volRatio < C.VOL_RATIO_MIN) return null

  const downDays = consecutiveDownDays(bars)
  const cumBase = bars[len - 2 - C.DOWN_WINDOW].close
  const downCumPct = cumBase > 0 ? ((prev.close - cumBase) / cumBase) * 100 : 0
  if (downDays < C.DOWN_DAYS_MIN && downCumPct > C.DOWN_CUM_PCT) return null

  return { date: last.date, chgPct: r2(chgPct), volRatio: r2(volRatio), downDays, downCumPct: r2(downCumPct) }
}

/** 逐日打标(回测事件闸门用;镜像 buildRegimeByDate 的逐日 slice 写法)。 */
export function buildReversalByDate(bars: IndexBar[], C: ReboundConfig = REBOUND): Map<string, ReversalSignal> {
  const out = new Map<string, ReversalSignal>()
  for (let i = minBarsForSignal(C) - 1; i < bars.length; i++) {
    const sig = detectReversalDay(bars.slice(0, i + 1), C)
    if (sig) out.set(sig.date, sig)
  }
  return out
}

/**
 * 连跌窗定界(序列最后一根=反攻日;复盘卡与回测共用同一口径)。
 * 连续口径命中时用更紧的连跌段,否则退到累计口径的固定 DOWN_WINDOW 窗;两者都不成立返回 null。
 */
export function declineWindow(bars: IndexBar[], C: ReboundConfig = REBOUND): DeclineWindow | null {
  const len = bars.length
  if (len < minBarsForSignal(C)) return null
  const downDays = consecutiveDownDays(bars)
  if (downDays >= C.DOWN_DAYS_MIN && len - 2 - downDays >= 0) {
    return { fromDate: bars[len - 2 - downDays].date, toDate: bars[len - 2].date }
  }
  const cumBase = bars[len - 2 - C.DOWN_WINDOW].close
  const downCumPct = cumBase > 0 ? ((bars[len - 2].close - cumBase) / cumBase) * 100 : 0
  if (downCumPct <= C.DOWN_CUM_PCT) {
    return { fromDate: bars[len - 2 - C.DOWN_WINDOW].date, toDate: bars[len - 2].date }
  }
  return null
}

/** 连跌窗内累计抗跌因子(多日口径;单日口径见 enrichRelStrength,分工互不替代)。 */
export interface CumRelStrength {
  cumRelPct: number // 个股窗内累计涨跌 − 指数窗内累计涨跌(pp),排序主键
  counterTrendDays: number // 窗内「指数跌、个股涨」的逆势红盘天数,展示副证
  stockChgPct: number
  indexChgPct: number
}

/**
 * 按日期交集对齐计算(停牌/新股缺日容错);窗内有效重叠 < 2 日返回 null。
 * 首尾同用对齐后日期集,个股与指数口径对称。
 */
export function cumRelStrength(
  stockBars: { date: string; close: number }[],
  idxBars: { date: string; close: number }[],
  win: DeclineWindow,
): CumRelStrength | null {
  const idxByDate = new Map<string, number>()
  for (const b of idxBars) {
    if (b.date >= win.fromDate && b.date <= win.toDate && b.close > 0) idxByDate.set(b.date, b.close)
  }
  const aligned = stockBars.filter((b) => idxByDate.has(b.date) && b.close > 0)
  if (aligned.length < 2) return null
  const idxCloses = aligned.map((b) => idxByDate.get(b.date) ?? 0) // has() 已过滤,?? 仅为消 non-null 断言

  const sFirst = aligned[0].close
  const sLast = aligned[aligned.length - 1].close
  const iFirst = idxCloses[0]
  const iLast = idxCloses[idxCloses.length - 1]
  if (iFirst <= 0) return null
  const stockChgPct = (sLast / sFirst - 1) * 100
  const indexChgPct = (iLast / iFirst - 1) * 100

  let counterTrendDays = 0
  for (let k = 1; k < aligned.length; k++) {
    const sRet = aligned[k].close - aligned[k - 1].close
    const iRet = idxCloses[k] - idxCloses[k - 1]
    if (iRet < 0 && sRet > 0) counterTrendDays++
  }

  return {
    cumRelPct: r2(stockChgPct - indexChgPct),
    counterTrendDays,
    stockChgPct: r2(stockChgPct),
    indexChgPct: r2(indexChgPct),
  }
}

/** 长电型命中明细。 */
export interface PioneerHit {
  lbc: number // 连板数(含反攻日,1=首板)
  posPct: number // 52周分位(0=最低,100=最高)
}

/**
 * 长电科技型:序列最后一根=反攻日,封死涨停 + 低位(52周分位≤PIONEER_POS_MAX) + 首板/二板(连板≤PIONEER_LB_MAX)。
 * 「率先」(封板时间)不在纯层判定——历史 fbt 由涨停池数据侧提供,此处 OHLCV 口径不计先后。
 */
export function classifyReboundPioneer(bars: Bar[], code: string, C: ReboundConfig = REBOUND): PioneerHit | null {
  const len = bars.length
  if (len < C.MIN_BARS) return null
  const last = bars[len - 1]
  const prevClose = bars[len - 2].close
  if (!isLimitUpDay(last, prevClose, code)) return null

  const lbc = consecutiveLimitUps(bars, len - 1, code)
  if (lbc > C.PIONEER_LB_MAX) return null

  const window = bars.slice(-Math.min(250, len))
  let hi = -Infinity
  let lo = Infinity
  for (const b of window) {
    if (b.high > hi) hi = b.high
    if (b.low < lo) lo = b.low
  }
  if (!(hi > lo)) return null
  const posPct = ((last.close - lo) / (hi - lo)) * 100
  if (posPct > C.PIONEER_POS_MAX) return null

  return { lbc, posPct: r2(posPct) }
}

/** 东山型命中明细。 */
export interface ResilientHit extends CumRelStrength {
  chgPct: number // 反攻日个股涨幅%
  volRatio: number // 反攻日个股量比(前 VOL_BASE_WIN 日均量)
}

/**
 * 东山精密型:序列最后一根=反攻日,非涨停(涨停归先锋组,两组不重叠) + 涨幅≥LEAD_CHG_MIN +
 * 量比≥LEAD_VOL_MIN + 连跌窗内累计相对强度≥LEAD_CUMREL_MIN(抗跌证据)。
 */
export function classifyReboundResilient(
  bars: Bar[],
  code: string,
  idxBars: IndexBar[],
  win: DeclineWindow,
  C: ReboundConfig = REBOUND,
): ResilientHit | null {
  const len = bars.length
  if (len < C.VOL_BASE_WIN + 2) return null
  const last = bars[len - 1]
  const prevClose = bars[len - 2].close
  if (prevClose <= 0) return null
  if (isLimitUpDay(last, prevClose, code)) return null

  const chgPct = ((last.close - prevClose) / prevClose) * 100
  if (chgPct < C.LEAD_CHG_MIN) return null

  const baseVol = mean(bars.slice(len - 1 - C.VOL_BASE_WIN, len - 1).map((b) => b.volume))
  if (baseVol <= 0) return null
  const volRatio = last.volume / baseVol
  if (volRatio < C.LEAD_VOL_MIN) return null

  const rel = cumRelStrength(bars, idxBars, win)
  if (!rel || rel.cumRelPct < C.LEAD_CUMREL_MIN) return null

  return { chgPct: r2(chgPct), volRatio: r2(volRatio), ...rel }
}
