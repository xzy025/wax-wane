// 突破次日回踩 · 纯函数判定层(无网络,可单测,纯 OHLCV)。
// 「突破生命周期」② —— 近 PB_MAX_AGO 日放量突破前高 → 守住突破位 → 今日首次回踩(下跌日)且收盘站回 MA5/前高之上 = 低吸点。
// 与第7战法「突破整理」(breakoutHoldRules:小实体十字星整理·高低点抬)互补:本战法抓的是突破后的「回踩不破」低吸。
// 信号日=回踩日(今日);全部只读信号日及之前的 K 线,零前视。阈值见 config/screener.ts 的 PBREAK。
import { PBREAK, type BreakoutPullbackConfig } from '../config/screener'
import { type Bar, mean, smaAt, r2, clamp01 } from './screenerRules'
import { consecutiveLimitUps } from './divergenceRules'


export interface BreakoutPullbackCandidate {
  group: 'breakpull'
  price: number // 回踩日收盘
  changePct: number
  daysSinceBreak: number // 突破日距今日交易日数(1=昨日突破今日回踩)
  breakClose: number // 突破日收盘
  breakVolRatio: number // 突破日放量倍数
  priorHigh: number // 突破日突破的前高(=回踩支撑下沿)
  ma5: number
  pullDepthPct: number // 今日自突破后高点回撤%
  touchedMa5: boolean // 今日低点回踩到 MA5 附近
  // 交易计划
  entry: number
  stop: number
  target: number
  riskReward: number
  positionHint: string
  tier: number // 1-3
  score: number // 0-100
  reason: string
  riskNote?: string
}

/**
 * 突破次日回踩识别(全硬门槛,除软评分 / 软门槛 LIMITUP_MAX):
 * ① 近 PB_MAX_AGO 日内存在放量突破日 P:close[P] > 前 BREAK_LOOKBACK 日高(突破前高) 且 vol[P] ≥ VOL_MULT×前均量。
 * ② P 之后守住突破位:回踩段最低 ≥ priorHigh×(1−HOLD_TOL)(不回吐进箱体)。
 * ③ 今日=回踩日:下跌日(REQUIRE_DOWN_DAY) + 自突破后高点回撤 ≥ PULL_MIN_PCT + 收盘站回 MA5 之上(CLOSE_ABOVE_MA)
 *    且 收盘 ≥ priorHigh(仍在突破位之上)。
 * 取最近的合格突破日。
 */
export function classifyBreakoutPullback(
  bars: Bar[],
  code: string,
  C: BreakoutPullbackConfig = PBREAK,
): BreakoutPullbackCandidate | null {
  const n = bars.length
  if (n < C.MIN_BARS) return null
  const last = n - 1
  const today = bars[last]
  const prev = bars[last - 1]
  if (today.close <= 0 || prev.close <= 0) return null

  const closes = bars.map((b) => b.close)
  const ma5 = smaAt(closes, C.MA_FAST, last)
  if (ma5 <= 0) return null

  // ③(先判今日回踩形态,省去无谓的突破日搜索)
  if (C.REQUIRE_DOWN_DAY && !(today.close < prev.close)) return null
  if (C.CLOSE_ABOVE_MA && !(today.close >= ma5)) return null

  // ① 搜最近的放量突破日 P(今日前 1..PB_MAX_AGO 日)
  let pIdx = -1
  let priorHigh = 0
  let breakVolRatio = 0
  for (let ago = 1; ago <= C.PB_MAX_AGO; ago++) {
    const idx = last - ago
    if (idx < C.BREAK_LOOKBACK + 1 || idx < C.VOL_MA + 1) break
    const breakWin = bars.slice(idx - C.BREAK_LOOKBACK, idx)
    if (!breakWin.length) continue
    const ph = Math.max(...breakWin.map((b) => b.high))
    if (!(bars[idx].close > ph)) continue // 非突破前高
    const volBase = mean(bars.slice(idx - C.VOL_MA, idx).map((b) => b.volume))
    if (volBase <= 0) continue
    const vr = bars[idx].volume / volBase
    if (vr < C.VOL_MULT) continue // 非放量突破
    pIdx = idx
    priorHigh = ph
    breakVolRatio = vr
    break // 取最近的合格突破日
  }
  if (pIdx < 0) return null

  // ② P 之后守住突破位(回踩不回吐进箱体)
  const sinceBreak = bars.slice(pIdx + 1, last + 1)
  if (!sinceBreak.length) return null
  const minLowSince = Math.min(...sinceBreak.map((b) => b.low))
  if (minLowSince < priorHigh * (1 - C.HOLD_TOL)) return null

  // ③ 今日仍在突破位之上 + 真回踩(自突破后高点回撤够)
  if (!(today.close >= priorHigh)) return null
  const highSince = Math.max(bars[pIdx].high, ...sinceBreak.slice(0, -1).map((b) => b.high), today.high)
  const pullDepthPct = highSince > 0 ? ((highSince - today.low) / highSince) * 100 : 0
  if (pullDepthPct < C.PULL_MIN_PCT) return null

  // 软门槛:避一字/连板妖股
  if (consecutiveLimitUps(bars, last, code) > C.LIMITUP_MAX) return null

  const touchedMa5 = today.low <= ma5 * (1 + C.TOUCH_TOL)

  // ── 交易计划:进场=回踩日收盘;止损=min(今日低, MA5)下方,封顶 −STOP_MAX_PCT%;目标 rmult ──
  const entry = today.close
  const structLow = Math.min(today.low, ma5)
  const stop = Math.max(structLow * 0.997, entry * (1 - C.STOP_MAX_PCT / 100))
  const risk = entry - stop
  if (risk <= 0) return null
  const target = entry + C.R_MULT * risk
  const changePct = (today.close / prev.close - 1) * 100
  const daysSinceBreak = last - pIdx

  // ── 打分 / 分档 ──
  const W = C.WEIGHTS
  const breakVol01 = clamp01((breakVolRatio - C.VOL_MULT) / C.VOL_MULT) // 1.8×→0, 3.6×→1
  const pullDepth01 = clamp01(1 - Math.abs(pullDepthPct - 4) / 6) // 回撤 ~4% 最优,过浅/过深降分
  const holdMa501 = touchedMa5 ? 1 : clamp01(1 - ((today.low / ma5 - 1) * 100) / 5) // 贴 MA5 越近越高
  const freshness01 = clamp01(1 - (daysSinceBreak - 1) / C.PB_MAX_AGO) // 回踩越早越高
  const score01 =
    (W.breakVol * breakVol01 + W.pullDepth * pullDepth01 + W.holdMa5 * holdMa501 + W.freshness * freshness01) /
    (W.breakVol + W.pullDepth + W.holdMa5 + W.freshness)
  const tier = score01 >= 0.6 ? 3 : score01 >= 0.4 ? 2 : 1

  const reason = `${daysSinceBreak}日前放量${r2(breakVolRatio)}×突破前高·守住${r2(priorHigh)}·今回踩${r2(pullDepthPct)}%${touchedMa5 ? '到MA5' : ''}·收站MA5上`
  const riskNote = pullDepthPct > 8 ? `回撤已${r2(pullDepthPct)}%·偏深临界变盘` : undefined

  return {
    group: 'breakpull',
    price: r2(today.close),
    changePct: r2(changePct),
    daysSinceBreak,
    breakClose: r2(bars[pIdx].close),
    breakVolRatio: r2(breakVolRatio),
    priorHigh: r2(priorHigh),
    ma5: r2(ma5),
    pullDepthPct: r2(pullDepthPct),
    touchedMa5,
    entry: r2(entry),
    stop: r2(stop),
    target: r2(target),
    riskReward: r2(C.R_MULT),
    positionHint: tier >= 3 ? '低吸 1/3(回踩不破可加)' : '低吸 1/4',
    tier,
    score: Math.round(score01 * 100),
    reason,
    riskNote,
  }
}
