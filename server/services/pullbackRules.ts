// 回调二次启动 / 圆弧底反包 · 纯函数判定层(无网络,可单测)。
// 与「新高战法」(screenerRules.ts)并列的另一类形态:曾经的领涨龙头深度回调后,
// 在低位筑圆弧底、均线重新拐头、放量二次启动。现有趋势模板 `距52周高≤15%` 会把
// 回调票一票否决,故独立成此规则。阈值见 config/screener.ts 的 PULLBACK。
//
// 六要素(全部只读信号日及之前的 K 线,零前视):
//   ① 曾是龙头(近高/52周低 ≥ 比 且 C>MA250)
//   ② 斐波回调(depth 落带 且 尚未收复)
//   ③ 调整够久(距近高 ≥ N 个交易日)
//   ④ 圆弧底(低点居中 + 自低回升 + 短均拐头)
//   ⑤ 均线即将/已金叉
//   ⑥ 异常放量启动(=触发/买点)
import { PULLBACK, type PullbackConfig } from '../config/screener'
import { type Bar, type Pivots, mean, smaAt, rsRaw, pivotLevels } from './screenerRules'

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const FIB = [0.382, 0.5, 0.618] // 评分用斐波档(深度越贴近越高分)

export interface PullbackCandidate {
  price: number
  changePct: number
  priorHigh: number // 近高(回调起点 = 测量目标)
  arcLow: number // 圆弧底低点(= 结构化止损位)
  retracePct: number // 回调深度%(距近高)
  daysSinceHigh: number // 距近高交易日数
  recoverPct: number // 自圆弧底低点回升%
  stopLoss: number
  target: number
  rsRaw: number
  score: number // 0-100
  pivots: Pivots // 经典枢轴位 R1/R2/S1/S2
  signals: { leader: boolean; arcUp: boolean; maCrossNear: boolean; volSpike: boolean; pattern: string }
}

/**
 * 回调二次启动判定:六要素全过返回候选,任一硬门槛不过返回 null。
 * bars 末根=信号日。进场=信号日收盘,止损=圆弧底低点(可选封顶),目标=测量到近高或 R 倍数。
 */
export function classifyPullback(bars: Bar[], C: PullbackConfig = PULLBACK): PullbackCandidate | null {
  const n = bars.length
  const minBars = C.MA_LONG + C.MA_LONG_RISE_LOOKBACK + 1
  if (n < minBars) return null

  const closes = bars.map((b) => b.close)
  const last = n - 1
  const today = bars[last]
  const prev = bars[last - 1]
  const c = today.close

  // 均线
  const ma250 = smaAt(closes, C.MA_LONG, last)
  const maFast = smaAt(closes, C.MA_TURN_FAST, last)
  const maX = smaAt(closes, C.MA_X, last)
  const maY = smaAt(closes, C.MA_Y, last)

  // 近高(最近 RECENT_HIGH_MAX 根内的最高 high)+ 52 周低
  const hiStart = Math.max(0, n - C.RECENT_HIGH_MAX)
  let hi = -Infinity
  let idxHi = last
  for (let i = hiStart; i < n; i++) {
    if (bars[i].high > hi) {
      hi = bars[i].high
      idxHi = i
    }
  }
  const loStart = Math.max(0, n - C.PRIOR_HIGH_LOOKBACK)
  let lo52 = Infinity
  for (let i = loStart; i < n; i++) if (bars[i].low < lo52) lo52 = bars[i].low

  // ① 龙头:曾翻倍级 + 长期上行中
  const leader = lo52 > 0 && hi / lo52 >= C.LEADER_HILO_MIN && (!C.REQUIRE_ABOVE_MA_LONG || c > ma250)
  if (!leader) return null

  // ③ 调整够久(距近高)+ 近高在过去(非今日)
  const daysSinceHigh = last - idxHi
  if (daysSinceHigh < C.CORRECTION_MIN_DAYS) return null

  // 回调区间最低(从近高之后到今日)
  let corrLow = Infinity
  let idxLow = last
  for (let i = idxHi; i <= last; i++) {
    if (bars[i].low < corrLow) {
      corrLow = bars[i].low
      idxLow = i
    }
  }

  // ② 斐波回调深度 + 尚未收复
  const depth = hi > 0 ? (hi - corrLow) / hi : 0
  if (depth < C.RETRACE_MIN || depth > C.RETRACE_MAX) return null
  if (c > hi * (1 - C.STILL_BELOW_MIN)) return null

  // ④ 圆弧底 / 转向:低点已确立(N 根前、不太陈旧)+ 自低回升落带 + 收复短均(c≥MA5)。
  // 不要求 MA5 上行/≥MA10——深跌票放量启动当日短均常仍在下行(滞后于量),硬卡会漏掉启动点。
  const lowAge = last - idxLow
  if (lowAge < C.ARC_LOW_MIN_AGO || lowAge > C.ARC_LOW_MAX_AGO) return null
  const recover = corrLow > 0 ? (c - corrLow) / corrLow : 0
  if (recover < C.ARC_RECOVER_MIN || recover > C.ARC_RECOVER_MAX) return null
  const reclaimFast = c >= maFast
  if (!reclaimFast) return null

  // ⑤ 均线即将/已金叉 —— 仅评分(不 gate):深跌后 MA10 远低于 MA20,作硬门槛会让本战法永不触发。
  const gap = maY > 0 ? (maY - maX) / maY : 1 // >0 未交叉
  const maCrossNear = maX >= maY || gap <= C.CROSS_NEAR

  // ⑥ 异常放量启动(触发/买点):放量 + 收阳
  const volMa = mean(bars.slice(n - C.VOL_MA, n).map((b) => b.volume))
  const volSpike = volMa > 0 && today.volume >= C.VOL_SPIKE * volMa && c > prev.close
  if (!volSpike) return null

  // 进/止/目标
  const stopLoss = C.STOP_MAX_PCT > 0 ? Math.max(corrLow, c * (1 - C.STOP_MAX_PCT / 100)) : corrLow
  const risk = c - stopLoss
  if (risk <= 0) return null
  const target = C.TARGET_MODE === 'rmult' ? c + C.TARGET_R_MULT * risk : hi

  // 评分(0-100,按权重和归一)
  const fibDist = Math.min(...FIB.map((f) => Math.abs(depth - f)))
  const fibScore = clamp01(1 - fibDist / 0.15) // 距最近斐波档 ≤0.15 给分
  const arcScore = clamp01(recover / 0.2) // 回升越多越确认(20% 封顶)
  const crossScore = maX >= maY ? 1 : clamp01(1 - gap / C.CROSS_NEAR) // 已交叉=满分,越贴近越高
  const volScore = clamp01((today.volume / volMa - 1) / 2) // 放量倍数
  const rs = rsRaw(closes)
  const rsScore = clamp01((rs + 0.2) / 0.6) // 粗归一(-0.2~0.4 → 0~1)
  const w = C.WEIGHTS
  const wsum = w.fib + w.arc + w.cross + w.vol + w.rs
  const score = r2((100 / wsum) * (w.fib * fibScore + w.arc * arcScore + w.cross * crossScore + w.vol * volScore + w.rs * rsScore))

  const changePct = prev.close > 0 ? (c / prev.close - 1) * 100 : 0
  return {
    price: r2(c),
    changePct: r2(changePct),
    priorHigh: r2(hi),
    arcLow: r2(corrLow),
    retracePct: r2(depth * 100),
    daysSinceHigh,
    recoverPct: r2(recover * 100),
    stopLoss: r2(stopLoss),
    target: r2(target),
    rsRaw: rs,
    score,
    pivots: pivotLevels(today),
    signals: { leader, arcUp: reclaimFast, maCrossNear, volSpike, pattern: '回调圆弧底·放量二次启动' },
  }
}
