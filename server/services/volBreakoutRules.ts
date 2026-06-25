// 放量新高 / 资金驱动突破 · 纯函数判定层(无网络,可单测,纯 OHLCV)。
// 与「新高战法」(screenerRules.classify)并列的另一类形态:刚从大箱体/下跌里翻上来、
// 中期均线尚未理顺(MA60<MA120 → 完整多头排列不过)的强势股,靠连续大幅放量(资金驱动)
// 突破中期平台、创新高。现有 trendTemplate 的完整多头排列会一票否决它(如 600141 兴发集团),
// 故放宽到「短期多头 MA5>MA21(上行)」+「持续放量」+「突破中期新高」独立成此规则。阈值见
// config/screener.ts 的 VOLBREAK。⚠ 大幅放量是双刃(资金启动 or 顶部出货),正期望与否由回测裁决。
//
// 全部只读信号日及之前的 K 线,零前视。
import { VOLBREAK, type VolBreakConfig } from '../config/screener'
import { type Bar, mean, smaAt } from './screenerRules'
import { consecutiveLimitUps } from './divergenceRules'

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export interface VolBreakCandidate {
  group: 'volbreak'
  price: number // 突破日收盘
  changePct: number
  ma5: number
  ma21: number
  baseVol: number // 放量启动前 BASE_LOOKBACK 日均量(基准)
  volBurstDays: number // 近 VOL_WIN 日里成交量 ≥ VOL_MULT×基准 的天数
  volAvgRatio: number // 近 VOL_AVG_WIN 日均量 / 基准
  priorHigh: number // 被突破的中期(BREAKOUT_LOOKBACK 日)前高
  dist52Pct: number // 距 52 周高%(展示用,非门槛除非 REQUIRE_52W_NEAR)
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
 * 资金驱动型放量突破识别(全硬门槛,除可选 REQUIRE_52W_NEAR / 软门槛 LIMITUP_MAX):
 * ① 短期多头:C>MA5>MA21 且 MA21 上行(放宽版,替代完整多头排列)。
 * ② 持续放量(宽松·多数达标):基准=放量窗口之前的 BASE_LOOKBACK 日均量;近 VOL_WIN 日里
 *    ≥MIN_VOL_DAYS 日成交量 ≥VOL_MULT×基准,且 近 VOL_AVG_WIN 日均量 ≥VOL_MULT×基准。
 * ③ 突破中期平台:今日收盘 ≥ 近 BREAKOUT_LOOKBACK 日(排除今日)前高 = 创中期新高。
 * ④ 收盘强 + 不过度追高(防 5 日垂直拉升后追在顶上)。
 * ⑤ 软门槛:连板数 ≤ LIMITUP_MAX(一字/连板妖股买不到,不收)。
 */
export function classifyVolBreakout(bars: Bar[], code: string, C: VolBreakConfig = VOLBREAK): VolBreakCandidate | null {
  const n = bars.length
  if (n < C.MIN_BARS) return null
  const last = n - 1
  const today = bars[last]
  const prev = bars[last - 1]
  if (prev.close <= 0 || today.close <= 0) return null

  const closes = bars.map((b) => b.close)
  const ma5 = smaAt(closes, C.MA_FAST, last)
  const ma21 = smaAt(closes, C.MA_SLOW, last)
  const ma21prev = smaAt(closes, C.MA_SLOW, last - C.RISE_LOOKBACK)

  // ① 短期多头(放宽版)
  if (!(ma5 > 0 && ma21 > 0 && ma21prev > 0)) return null
  if (!(today.close > ma5 && ma5 > ma21)) return null
  if (!(ma21 > ma21prev)) return null // MA21 上行 → 排除下跌中继的死猫跳

  // ② 持续放量(宽松·多数达标):基准取放量爆发之前,否则爆发自抬基准
  const baseStart = last - C.VOL_WIN - C.BASE_LOOKBACK + 1
  const baseEnd = last - C.VOL_WIN + 1 // exclusive
  if (baseStart < 0) return null
  const baseVol = mean(bars.slice(baseStart, baseEnd).map((b) => b.volume))
  if (baseVol <= 0) return null
  const winBars = bars.slice(last - C.VOL_WIN + 1, last + 1) // 近 VOL_WIN 日(含今日)
  const volBurstDays = winBars.filter((b) => b.volume >= C.VOL_MULT * baseVol).length
  if (volBurstDays < C.MIN_VOL_DAYS) return null
  const avgVol = mean(bars.slice(last - C.VOL_AVG_WIN + 1, last + 1).map((b) => b.volume))
  const volAvgRatio = baseVol > 0 ? avgVol / baseVol : 0
  if (volAvgRatio < C.VOL_MULT) return null

  // ③ 突破中期平台:创 BREAKOUT_LOOKBACK 日新高(排除今日)
  const boStart = Math.max(0, last - C.BREAKOUT_LOOKBACK)
  const priorWin = bars.slice(boStart, last)
  if (!priorWin.length) return null
  const priorHigh = Math.max(...priorWin.map((b) => b.high))
  if (!(today.close >= priorHigh)) return null

  // 52 周高(近 250 根,展示用;REQUIRE_52W_NEAR 时作硬门槛)
  const win52 = bars.slice(Math.max(0, n - 250))
  const hi52 = Math.max(...win52.map((b) => b.high))
  const dist52 = hi52 > 0 ? ((hi52 - today.close) / hi52) * 100 : 0
  if (C.REQUIRE_52W_NEAR && today.close < 0.85 * hi52) return null

  // ④ 收盘强 + 不过度追高
  const range = today.high - today.low
  const closeStrong = range > 0 ? (today.close - today.low) / range : 1
  if (closeStrong < C.CLOSE_STRENGTH) return null
  const extAbovePct = (today.close / ma5 - 1) * 100
  if (extAbovePct > C.EXT_MAX_PCT) return null

  // ⑤ 软门槛:避一字/连板妖股(买不到)
  if (consecutiveLimitUps(bars, last, code) > C.LIMITUP_MAX) return null

  // ── 交易计划 ──
  const entry = today.close
  const stop = Math.max(ma21, entry * (1 - C.STOP_MAX_PCT / 100))
  const risk = entry - stop
  if (risk <= 0) return null
  const target = entry + C.R_MULT * risk

  const changePct = (today.close / prev.close - 1) * 100

  // ── 打分 / 分档 ──
  const W = C.WEIGHTS
  const burst01 = clamp01(volBurstDays / C.VOL_WIN) // 窗内达标天数占比
  const volRatio01 = clamp01((volAvgRatio - C.VOL_MULT) / C.VOL_MULT) // 2×→0,4×→1
  const slope01 = clamp01((ma21 / ma21prev - 1) * 20) // MA21 在 RISE_LOOKBACK 内涨 5%→1
  const score01 =
    (W.burst * burst01 + W.volRatio * volRatio01 + W.closeStrong * clamp01(closeStrong) + W.slope * slope01) /
    (W.burst + W.volRatio + W.closeStrong + W.slope)
  const tier = score01 >= 0.6 ? 3 : score01 >= 0.4 ? 2 : 1

  const reason = `持续放量·近${C.VOL_WIN}日${volBurstDays}日≥${C.VOL_MULT}×·均量${r2(volAvgRatio)}×·破${C.BREAKOUT_LOOKBACK}日高·MA5>MA21`
  const riskNote =
    dist52 > 30 ? `仍低于52周高 ${r2(dist52)}%·中期突破非全程新高` : !C.REQUIRE_52W_NEAR && extAbovePct > C.EXT_MAX_PCT * 0.75 ? '已偏离MA5较远·临界追高' : undefined

  return {
    group: 'volbreak',
    price: r2(today.close),
    changePct: r2(changePct),
    ma5: r2(ma5),
    ma21: r2(ma21),
    baseVol: Math.round(baseVol),
    volBurstDays,
    volAvgRatio: r2(volAvgRatio),
    priorHigh: r2(priorHigh),
    dist52Pct: r2(dist52),
    entry: r2(entry),
    stop: r2(stop),
    target: r2(target),
    riskReward: r2(C.R_MULT),
    positionHint: tier >= 3 ? '试错仓 1/3(放量持续可加)' : '试错仓 1/4',
    tier,
    score: Math.round(score01 * 100),
    reason,
    riskNote,
  }
}
