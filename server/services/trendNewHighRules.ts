// 趋势新高 战法(第八类) · 纯函数判定层(无网络,可单测,纯 OHLCV)。
// 与「突破/放量新高」互补:突破战法只抓"刚突破那一刻"并主动拦截追高(notExtended,收盘≤pivot×1.05),
// 故已走出来、远离平台、持续创新高的趋势中军(如 600176 中国巨石)反而进不了任何桶。
// 本战法专收这类:完整多头排列(复用 trendTemplate)+ 贴近/站上 52 周高 + 近期持续创新高。
// 价格口径(非突破口径),全部只读信号日及之前的 K 线,零前视。阈值见 config/screener.ts 的 TRENDNEW。
import { TRENDNEW, type TrendNewConfig } from '../config/screener'
import { type Bar, smaAt, rsRaw, trendTemplate } from './screenerRules'
import { consecutiveLimitUps } from './divergenceRules'

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export interface TrendNewCandidate {
  group: 'trendnew'
  price: number // 信号日收盘
  changePct: number
  nhDays: number // 近 RECENT_WIN 日内创"近 NH_LOOKBACK 日新高"的天数(持续新高度)
  dist52Pct: number // 距 52 周高%:≤0 创/平新高,>0 在高点下方
  rs: number // 相对强度原值(rsRaw)
  maRef: number // 参考均线(MA_REF,追高/止损依据)
  closeStrength: number // (收−低)/(高−低)
  // 交易计划
  entry: number // 介入参考 = 信号日收盘(趋势跟随,EOD)
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
 * 趋势新高识别(硬门槛 + 软门槛 LIMITUP_MAX):
 * ① 完整多头排列(trendTemplate.pass:C>MA20>MA60>MA120>MA250、MA250 上行、距52周低≥25%、距52周高≤15%)。
 * ② 贴近/站上 52 周高:收盘 ≥ 52周高 ×(1 − NEAR_HIGH_PCT/100)。
 * ③ 近期持续创新高:近 RECENT_WIN 根里,有 ≥MIN_NH_DAYS 根创"近 NH_LOOKBACK 根新高"
 *    (该根 high ≥ 其前 NH_LOOKBACK 根最高)——排除一次性脉冲,要的是反复破新高的趋势中军。
 * ④ 收盘强度 ≥ CLOSE_STRENGTH(收在振幅上半区)。
 * ⑤ 追高 guard(宽松,防垂直顶):收盘 ≤ MA_REF ×(1 + EXT_MAX_PCT/100)。
 * ⑥ 软门槛:连板数 ≤ LIMITUP_MAX(剔除买不到的一字妖股)。
 * 止损 = max(MA_REF×0.99, 进场×(1−STOP_MAX_PCT/100))(结构 + 封顶取紧者);目标 = 进场 + R_MULT×风险。
 */
export function classifyTrendNewHigh(bars: Bar[], code: string, C: TrendNewConfig = TRENDNEW): TrendNewCandidate | null {
  const n = bars.length
  if (n < C.MIN_BARS) return null
  const last = n - 1
  const today = bars[last]
  const prev = bars[last - 1]
  if (today.close <= 0 || prev.close <= 0) return null

  // ① 多头排列(复用趋势模板,顺带拿到 52 周高)
  const tt = trendTemplate(bars)
  if (!tt || !tt.pass) return null
  const hi52 = tt.hi52

  // ② 贴近/站上 52 周高
  if (!(today.close >= hi52 * (1 - C.NEAR_HIGH_PCT / 100))) return null

  // ③ 近期持续创新高:窗内创"近 NH_LOOKBACK 根新高"的天数
  const highs = bars.map((b) => b.high)
  let nhDays = 0
  for (let j = last - C.RECENT_WIN + 1; j <= last; j++) {
    if (j - C.NH_LOOKBACK < 0) continue
    const priorHigh = Math.max(...highs.slice(j - C.NH_LOOKBACK, j)) // 不含 j,零前视
    if (highs[j] >= priorHigh) nhDays++
  }
  if (nhDays < C.MIN_NH_DAYS) return null

  // ④ 收盘强度
  const range = today.high - today.low
  const closeStrength = range > 0 ? (today.close - today.low) / range : 1
  if (closeStrength < C.CLOSE_STRENGTH) return null

  // ⑤ 追高 guard(宽松)
  const closes = bars.map((b) => b.close)
  const maRef = smaAt(closes, C.MA_REF, last)
  if (maRef <= 0) return null
  const extPct = (today.close / maRef - 1) * 100
  if (extPct > C.EXT_MAX_PCT) return null

  // ⑥ 软门槛:连板妖股(买不到)
  if (consecutiveLimitUps(bars, last, code) > C.LIMITUP_MAX) return null

  // ── 交易计划 ──
  const entry = today.close
  const stop = Math.max(maRef * 0.99, entry * (1 - C.STOP_MAX_PCT / 100))
  const risk = entry - stop
  if (risk <= 0) return null
  const target = entry + C.R_MULT * risk
  const changePct = (today.close / prev.close - 1) * 100
  const dist52Pct = (today.close / hi52 - 1) * 100
  const rs = rsRaw(closes)

  // ── 打分 / 分档 ──
  const W = C.WEIGHTS
  const nh01 = clamp01(nhDays / (C.RECENT_WIN * 0.5)) // 窗内半数日创新高→满分
  const rs01 = clamp01(rs / 0.5) // 加权年化 +50% → 满分
  const closeStrong01 = clamp01((closeStrength - C.CLOSE_STRENGTH) / (1 - C.CLOSE_STRENGTH))
  const distHighPct = Math.max(0, (hi52 - today.close) / hi52 * 100)
  const near01 = clamp01(1 - distHighPct / C.NEAR_HIGH_PCT) // 贴 52 周高越近越高
  const score01 = (W.nh * nh01 + W.rs * rs01 + W.closeStrong * closeStrong01 + W.near * near01) / (W.nh + W.rs + W.closeStrong + W.near)
  const tier = score01 >= 0.6 ? 3 : score01 >= 0.4 ? 2 : 1

  const newHighToday = dist52Pct >= -0.05
  const reason = `多头排列·近${C.RECENT_WIN}日${nhDays}次创新高·${newHighToday ? '今日创/平新高' : `距52周高${r2(distHighPct)}%`}·收强${r2(closeStrength * 100)}%`
  const riskNote = extPct > C.EXT_MAX_PCT * 0.75 ? `已较 MA${C.MA_REF} 偏离 ${r2(extPct)}%·临界追高` : undefined

  return {
    group: 'trendnew',
    price: r2(today.close),
    changePct: r2(changePct),
    nhDays,
    dist52Pct: r2(dist52Pct),
    rs: r2(rs),
    maRef: r2(maRef),
    closeStrength: r2(closeStrength),
    entry: r2(entry),
    stop: r2(stop),
    target: r2(target),
    riskReward: r2(C.R_MULT),
    positionHint: tier >= 3 ? '趋势中军·回踩不破 MA20 可加' : '试错仓 1/4·趋势跟随',
    tier,
    score: Math.round(score01 * 100),
    reason,
    riskNote,
  }
}
