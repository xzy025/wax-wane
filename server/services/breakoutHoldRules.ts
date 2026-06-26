// 突破整理·延续 · 纯函数判定层(无网络,可单测,纯 OHLCV)。
// 来源:用户给精测电子(300567)截图——「放量大阳线过前高 → 1~2根阳线/十字星整理 → 高低点双抬」。
// 抓"突破已完成、现在小K线缩量整理且不回吐(高低点齐抬、守住突破位)"的延续介入点。
// 与「今日已突破」(只抓突破当天)互补:本战法的信号日是 pole 之后的整理日(今日=最后一根小K线)。
// 全部只读信号日及之前的 K 线,零前视。阈值见 config/screener.ts 的 BHOLD。
import { BHOLD, type BreakoutHoldConfig } from '../config/screener'
import { type Bar, mean } from './screenerRules'
import { consecutiveLimitUps } from './divergenceRules'

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export interface BreakoutHoldCandidate {
  group: 'bhold'
  price: number // 信号日(整理日)收盘
  changePct: number
  consolDays: number // 整理小K线根数(1~2)
  poleBodyPct: number // pole 大阳线实体涨幅%
  poleVolRatio: number // pole 量 / pole 前均量(放量)
  poleClose: number // pole 收盘
  priorHigh: number // pole 突破的"前高"
  higherHigh: boolean // 整理期高点抬高
  higherLow: boolean // 整理期低点抬高
  // 交易计划
  trigger: number // 确认入场位 = 整理段(含pole)最高;次日突破此位才介入(旗形突破确认)
  consolLow: number // 整理段最低(结构止损依据)
  entry: number // 收盘介入参考(=信号日收盘;实战以 trigger 突破确认为准)
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
 * 突破整理·延续识别(全硬门槛,除可选 REQUIRE_HIGHER_HIGH/LOW / 软门槛 LIMITUP_MAX):
 * 在 consolN ∈ [1, MAX_CONSOL] 上搜——令今日=最后一根整理小K线,pole=今日前 consolN 根:
 * ① pole 是「放量大阳线过前高」:实体涨幅 ≥POLE_BODY_MIN、量 ≥POLE_VOL_MULT×前均量、
 *    收盘 > 前 POLE_BREAK_LOOKBACK 日最高(突破前高)。
 * ② pole 之后 [pole+1..今日] 每根小实体(|收−开|/振幅 ≤DOJI_BODY_MAX = 十字星/小阳)、缩量(软)、
 *    高点抬高(高≥前一根高)+ 低点抬高(低≥前一根低)、低点守在被突破前高之上(不回吐)。
 * ③ 整理日收盘不过度脱离 pole 收盘(≤EXT_MAX_PCT,防整理已大幅续涨再追)。
 * 命中即取最小可行 consolN(优先 1 根整理)。
 */
export function classifyBreakoutHold(bars: Bar[], code: string, C: BreakoutHoldConfig = BHOLD): BreakoutHoldCandidate | null {
  const n = bars.length
  if (n < C.MIN_BARS) return null
  const last = n - 1
  const today = bars[last]
  const prev = bars[last - 1]
  if (today.close <= 0 || prev.close <= 0) return null

  for (let consolN = 1; consolN <= C.MAX_CONSOL; consolN++) {
    const poleIdx = last - consolN
    if (poleIdx < C.POLE_BREAK_LOOKBACK + 1 || poleIdx < C.POLE_VOL_MA + 1) continue
    const pole = bars[poleIdx]
    if (pole.open <= 0) continue

    // ① pole = 放量大阳线过前高
    const poleBody = (pole.close / pole.open - 1) * 100
    if (poleBody < C.POLE_BODY_MIN) continue
    const breakWin = bars.slice(poleIdx - C.POLE_BREAK_LOOKBACK, poleIdx)
    if (!breakWin.length) continue
    const priorHigh = Math.max(...breakWin.map((b) => b.high))
    if (!(pole.close > priorHigh)) continue // 突破前高
    const poleVolBase = mean(bars.slice(poleIdx - C.POLE_VOL_MA, poleIdx).map((b) => b.volume))
    if (poleVolBase <= 0) continue
    const poleVolRatio = pole.volume / poleVolBase
    if (poleVolRatio < C.POLE_VOL_MULT) continue

    // ② 整理段 [poleIdx+1 .. last]:小实体 + 缩量(软) + 高低点抬升 + 守突破位
    let ok = true
    let higherHigh = true
    let higherLow = true
    let minBody = 1
    for (let j = poleIdx + 1; j <= last && ok; j++) {
      const b = bars[j]
      const prevBar = bars[j - 1]
      const range = b.high - b.low
      const bodyRatio = range > 0 ? Math.abs(b.close - b.open) / range : 1
      if (bodyRatio > C.DOJI_BODY_MAX) { ok = false; break } // 非小实体十字星
      minBody = Math.min(minBody, bodyRatio)
      if (b.volume > C.CONSOL_VOL_MAX * pole.volume) { ok = false; break } // 整理需缩量(软门槛偏宽)
      if (b.high < prevBar.high) higherHigh = false
      if (b.low < prevBar.low) higherLow = false
      if (C.HOLD_ABOVE_BREAK && b.low < priorHigh) { ok = false; break } // 回吐进箱体
      // 整理日收盘不过度脱离 pole 收盘(防整理已续涨一大截再追)
      if ((b.close / pole.close - 1) * 100 > C.EXT_MAX_PCT) { ok = false; break }
    }
    if (!ok) continue
    if (C.REQUIRE_HIGHER_HIGH && !higherHigh) continue
    if (C.REQUIRE_HIGHER_LOW && !higherLow) continue

    // 软门槛:避一字/连板妖股(买不到)
    if (consecutiveLimitUps(bars, last, code) > C.LIMITUP_MAX) continue

    // ── 交易计划:确认入场位 trigger=整理段(含pole)最高(次日突破才介入);止损=整理段最低(结构),封顶 −STOP_MAX_PCT% ──
    const consolBars = bars.slice(poleIdx + 1, last + 1)
    const minConsolLow = Math.min(...consolBars.map((b) => b.low))
    const trigger = Math.max(pole.high, ...consolBars.map((b) => b.high))
    const entry = today.close // 收盘介入参考;实战/回测以 trigger 突破确认为准
    const stop = Math.max(minConsolLow * 0.997, entry * (1 - C.STOP_MAX_PCT / 100))
    const risk = entry - stop
    if (risk <= 0) continue
    const target = entry + C.R_MULT * risk
    const changePct = (today.close / prev.close - 1) * 100

    // ── 打分 / 分档 ──
    const W = C.WEIGHTS
    const poleVol01 = clamp01((poleVolRatio - C.POLE_VOL_MULT) / C.POLE_VOL_MULT) // 1.8×→0, 3.6×→1
    const poleBody01 = clamp01((poleBody - C.POLE_BODY_MIN) / 5) // 5%→0, 10%→1
    const tight01 = clamp01(1 - minBody / C.DOJI_BODY_MAX) // 实体越小越紧凑→越高
    const stepUp01 = clamp01(((today.high / pole.high) - 1) * 20) // 整理高点较 pole 抬升 5%→1
    const score01 =
      (W.poleVol * poleVol01 + W.poleBody * poleBody01 + W.tight * tight01 + W.stepUp * clamp01(stepUp01)) /
      (W.poleVol + W.poleBody + W.tight + W.stepUp)
    const tier = score01 >= 0.6 ? 3 : score01 >= 0.4 ? 2 : 1

    const reason = `放量${r2(poleVolRatio)}×大阳(实体+${r2(poleBody)}%)过前高·${consolN}根${minBody <= 0.3 ? '十字星' : '小阳'}整理·${higherHigh && higherLow ? '高低点双抬' : higherHigh ? '高点抬高' : '低点抬高'}·守突破位`
    const riskNote = (today.close / pole.close - 1) * 100 > C.EXT_MAX_PCT * 0.75 ? '整理已接近脱离 pole·临界追高' : undefined

    return {
      group: 'bhold',
      price: r2(today.close),
      changePct: r2(changePct),
      consolDays: consolN,
      poleBodyPct: r2(poleBody),
      poleVolRatio: r2(poleVolRatio),
      poleClose: r2(pole.close),
      priorHigh: r2(priorHigh),
      higherHigh,
      higherLow,
      trigger: r2(trigger),
      consolLow: r2(minConsolLow),
      entry: r2(entry),
      stop: r2(stop),
      target: r2(target),
      riskReward: r2(C.R_MULT),
      positionHint: tier >= 3 ? '试错仓 1/3(放量续涨可加)' : '试错仓 1/4',
      tier,
      score: Math.round(score01 * 100),
      reason,
      riskNote,
    }
  }
  return null
}
