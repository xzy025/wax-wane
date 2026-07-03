// 放量吸筹 · 持续异常放量横盘 监控清单(纯函数判定层,无网络,可单测,纯 OHLCV)。
// 形态:成交量连续巨幅放大(每日 ≈ 之前均量好几倍),但价格横盘、均线走平 = 主力在箱体内吸筹/换手。
//   与「放量新高·资金驱动突破」(volBreakoutRules)正相反——那个要的是突破新高+多头上行,本战法要的是
//   放量但价不走(横盘)。核心硬门槛＝持续放量;用户两条"加分"做成评分因子:① 均线走平(MA_REF 斜率近 0)
//   ② 横盘越久越加分(价格箱体维持的连续天数)。发现型(同 trendLeaderRules):给观察触发位(箱体上沿,
//   放量站上＝吸筹转拉升),不给止损/目标。阈值见 config/screener.ts 的 ACCUM。
// 全部只读信号日及之前的 K 线,零前视。
import { ACCUM, type AccumConfig } from '../config/screener'
import { type Bar, mean, smaAt } from './screenerRules'
import { consecutiveLimitUps } from './divergenceRules'

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export interface AccumCandidate {
  group: 'accum'
  price: number // 今日收盘
  changePct: number
  maRef: number // MA_REF(20)
  baseVol: number // 放量启动前 BASE_LOOKBACK 日均量(基准)
  avgVolRatio: number // 近 VOL_WIN 日均量 / 基准(放量倍数)
  burstDays: number // VOL_WIN 内单日量 ≥ VOL_MULT×基准 的天数
  surgeRunDays: number // 自今日向前持续放量约 N 日(软门槛 walk-back)
  maSlopePct: number // MA_REF 在 FLAT_WIN 内的斜率(绝对%,越小越走平)
  consolDays: number // 横盘箱体维持的连续天数(越长越吸筹)
  boxLow: number // 横盘箱体下沿
  boxHigh: number // 横盘箱体上沿
  breakLevel: number // 观察触发位(= boxHigh):放量站上＝吸筹转拉升
  // ── 确认买点(2026-07-03 入场日撮合修正后 0.01R/PF1.02 不再过线,降级为触发位提示;吸筹途中收盘进 −0.24R)──
  entryTrigger: number // 触发买点:放量站上箱体上沿(= boxHigh)才介入,确认窗 CONFIRM_WINDOW 日
  stopRef: number // 止损:max(箱体下沿, 进场×(1−ENTRY_STOP_PCT/100))
  targetRef: number // 目标:进场 + ENTRY_R_MULT×风险
  posPct: number // 收盘在 52 周区间的分位%(低位偏吸筹 / 高位谨防出货)
  winNetChgPct: number // 放量窗内净涨跌幅%(放量下跌＝出货嫌疑)
  vol01: number // 放量强度因子 0..1
  flat01: number // 均线走平因子 0..1
  consol01: number // 横盘时长因子 0..1
  tier: number // 1-3
  score: number // 0-100
  reason: string
  riskNote?: string
  relStrength?: number // 相对大盘强度(enrichRelStrength 事后写入)
  counterTrend?: boolean // 逆势强(enrichRelStrength 事后写入)
}

/**
 * 持续异常放量横盘识别(硬门槛=持续放量,其余为打分因子):
 * ① 持续放量(硬):基准=放量窗之前 BASE_LOOKBACK 日均量;近 VOL_WIN 日里 ≥MIN_BURST_DAYS 日
 *    单日量 ≥VOL_MULT×基准,且 近 VOL_WIN 日均量 ≥VOL_MULT×基准("每天好几倍")。
 * ② 软门槛:连板数 ≤ LIMITUP_MAX(一字/连板妖股剔除)。
 * 评分(归一 0-100):放量强度 vol01 + 均线走平 flat01 + 横盘时长 consol01,权重见 WEIGHTS。
 */
export function classifyAccum(bars: Bar[], code: string, C: AccumConfig = ACCUM): AccumCandidate | null {
  const n = bars.length
  if (n < C.MIN_BARS) return null
  const last = n - 1
  const today = bars[last]
  const prev = bars[last - 1]
  if (today.close <= 0 || prev.close <= 0) return null

  // ① 持续放量(硬门槛):基准取放量窗之前,否则放量自抬基准
  const baseStart = last - C.VOL_WIN - C.BASE_LOOKBACK + 1
  const baseEnd = last - C.VOL_WIN + 1 // exclusive
  if (baseStart < 0) return null
  const baseVol = mean(bars.slice(baseStart, baseEnd).map((b) => b.volume))
  if (baseVol <= 0) return null
  const winBars = bars.slice(last - C.VOL_WIN + 1, last + 1) // 近 VOL_WIN 日(含今日)
  const burstDays = winBars.filter((b) => b.volume >= C.VOL_MULT * baseVol).length
  if (burstDays < C.MIN_BURST_DAYS) return null
  const avgVolRatio = mean(winBars.map((b) => b.volume)) / baseVol
  if (avgVolRatio < C.VOL_MULT) return null

  // ② 软门槛:连板妖股剔除
  if (consecutiveLimitUps(bars, last, code) > C.LIMITUP_MAX) return null

  // 持续放量天数(walk-back,软倍数,容忍 SURGE_TOL 连续 sub-threshold)
  let surgeRunDays = 0
  let miss = 0
  for (let j = last; j >= 1; j--) {
    if (bars[j].volume >= C.SURGE_SOFT_MULT * baseVol) {
      surgeRunDays++
      miss = 0
    } else {
      miss++
      if (miss > C.SURGE_TOL) break
    }
  }

  // 均线走平(MA_REF 斜率,绝对%)
  const closes = bars.map((b) => b.close)
  const maNow = smaAt(closes, C.MA_REF, last)
  const maPast = smaAt(closes, C.MA_REF, last - C.FLAT_WIN)
  const maSlopePct = maNow > 0 && maPast > 0 ? Math.abs(maNow / maPast - 1) * 100 : 100
  const flat01 = clamp01(1 - maSlopePct / C.FLAT_MAX_PCT)

  // 横盘箱体:自今日向前,(区间最高−最低)/最低 ≤ BOX_RANGE_PCT 的最长连续段
  let hi = today.high
  let lo = today.low
  let consolDays = 1
  for (let j = last - 1; j >= 0; j--) {
    const nh = Math.max(hi, bars[j].high)
    const nl = Math.min(lo, bars[j].low)
    if (nl <= 0 || (nh - nl) / nl > C.BOX_RANGE_PCT / 100) break
    hi = nh
    lo = nl
    consolDays++
  }
  const consol01 = clamp01(consolDays / C.CONSOL_FULL)

  // 放量强度(倍数 + 窗内达标占比 + 持续天数)
  const volRatio01 = clamp01((avgVolRatio - C.VOL_MULT) / C.VOL_MULT) // VOL_MULT×→0,2×VOL_MULT→1
  const burst01 = clamp01(burstDays / C.VOL_WIN)
  const surgeLen01 = clamp01(surgeRunDays / C.SURGE_FULL)
  const vol01 = clamp01(0.5 * volRatio01 + 0.3 * burst01 + 0.2 * surgeLen01)

  // 52 周区间分位(低位吸筹 / 高位谨防出货)
  const win52 = bars.slice(Math.max(0, n - 250))
  const hi52 = Math.max(...win52.map((b) => b.high))
  const lo52 = Math.min(...win52.map((b) => b.low))
  const posPct = hi52 > lo52 ? ((today.close - lo52) / (hi52 - lo52)) * 100 : 50

  // 放量窗内净涨跌(放量下跌＝出货嫌疑)
  const winStart = bars[last - C.VOL_WIN + 1]
  const winNetChgPct = winStart.close > 0 ? (today.close / winStart.close - 1) * 100 : 0

  // 确认买点(回测裁决的入场口径):进场=放量站上箱体上沿 hi,止损=max(箱体下沿, 进场×(1−ENTRY_STOP_PCT)),目标=+ENTRY_R_MULT×R
  const entryTrigger = hi
  const stopRef = Math.max(lo, entryTrigger * (1 - C.ENTRY_STOP_PCT / 100))
  const triggerRisk = entryTrigger - stopRef
  const targetRef = triggerRisk > 0 ? entryTrigger + C.ENTRY_R_MULT * triggerRisk : entryTrigger

  // 打分 / 分档
  const W = C.WEIGHTS
  const wsum = W.vol + W.flat + W.consol
  const score01 = (W.vol * vol01 + W.flat * flat01 + W.consol * consol01) / wsum
  const tier = score01 >= 0.6 ? 3 : score01 >= 0.4 ? 2 : 1

  const changePct = (today.close / prev.close - 1) * 100
  const reason =
    `持续放量·近${C.VOL_WIN}日均量${r2(avgVolRatio)}×基准(${burstDays}日≥${C.VOL_MULT}×)·持续约${surgeRunDays}日·` +
    `MA${C.MA_REF}斜率${r2(maSlopePct)}%${maSlopePct <= C.FLAT_MAX_PCT ? '(走平)' : ''}·横盘${consolDays}日`

  let riskNote: string | undefined
  if (winNetChgPct <= -C.DROP_WARN_PCT) riskNote = `放量下跌 ${r2(winNetChgPct)}%·疑似出货(非吸筹)`
  else if (posPct >= C.HI_POS_PCT) riskNote = `高位放量(52周分位${Math.round(posPct)}%)·谨防拉升末段出货`
  else if (posPct <= C.LO_POS_PCT) riskNote = `低位放量(52周分位${Math.round(posPct)}%)·偏吸筹`

  return {
    group: 'accum',
    price: r2(today.close),
    changePct: r2(changePct),
    maRef: r2(maNow),
    baseVol: Math.round(baseVol),
    avgVolRatio: r2(avgVolRatio),
    burstDays,
    surgeRunDays,
    maSlopePct: r2(maSlopePct),
    consolDays,
    boxLow: r2(lo),
    boxHigh: r2(hi),
    breakLevel: r2(hi),
    entryTrigger: r2(entryTrigger),
    stopRef: r2(stopRef),
    targetRef: r2(targetRef),
    posPct: r2(posPct),
    winNetChgPct: r2(winNetChgPct),
    vol01: r2(vol01),
    flat01: r2(flat01),
    consol01: r2(consol01),
    tier,
    score: Math.round(score01 * 100),
    reason,
    riskNote,
  }
}
