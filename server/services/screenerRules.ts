// 新高战法 · 纯函数判定层(无网络,可单测)。
// 趋势模板(Stage2) → VCP/即将新高 → 突破触发分组 → RS/评分。规则参数见 config/screener.ts。
import { SCREENER, type ScreenerConfig } from '../config/screener'

export interface Bar {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
}

export type ScreenerGroup = 'trigger' | 'breakout'

export interface Candidate {
  group: ScreenerGroup
  price: number
  changePct: number
  pivot: number
  stopLoss: number
  target: number
  rsRaw: number
  coil: number
  trendStrength: number
  volRatio: number // volMA5 / volMA50
  atrRatio: number // ATR10 / ATR50
  volScore: number // 0-1,突破看放量、扳机看缩量
  distToPivotPct: number
  signals: { trendOk: boolean; volDry: boolean; atrContract: boolean; breakoutVol: boolean; pattern: string }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

/** 末端 N 根收盘均值(SMA,以 endIdx 结尾)。 */
function smaAt(closes: number[], period: number, endIdx: number): number {
  if (endIdx - period + 1 < 0) return 0
  return mean(closes.slice(endIdx - period + 1, endIdx + 1))
}

/** ATR:以 endIdx 结尾的 period 根真实波幅均值。 */
function atr(bars: Bar[], period: number, endIdx: number): number {
  let sum = 0
  let cnt = 0
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    if (i <= 0) continue
    const h = bars[i].high
    const l = bars[i].low
    const pc = bars[i - 1].close
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
    cnt++
  }
  return cnt ? sum / cnt : 0
}

export interface TrendTemplate {
  pass: boolean
  ma: { f: number; m: number; s: number; l: number }
  hi52: number
  lo52: number
}

/**
 * 趋势模板(硬门槛):多头排列 C>MA20>MA60>MA120>MA250、MA250 上行、
 * 距 52 周低 ≥25%、距 52 周高 ≤15%。bars 不足返回 null(次新股跳过)。
 */
export function trendTemplate(bars: Bar[], C: ScreenerConfig = SCREENER): TrendTemplate | null {
  const n = bars.length
  if (n < C.MA_LONG + C.MA_LONG_RISE_LOOKBACK + 1) return null
  const closes = bars.map((b) => b.close)
  const last = n - 1
  const c = closes[last]
  const maF = smaAt(closes, C.MA_FAST, last)
  const maM = smaAt(closes, C.MA_MID, last)
  const maS = smaAt(closes, C.MA_SLOW, last)
  const maL = smaAt(closes, C.MA_LONG, last)
  const maLPrev = smaAt(closes, C.MA_LONG, last - C.MA_LONG_RISE_LOOKBACK)
  const win = bars.slice(-C.MA_LONG)
  const hi52 = Math.max(...win.map((b) => b.high))
  const lo52 = Math.min(...win.map((b) => b.low))
  const pass =
    c > maF &&
    maF > maM &&
    maM > maS &&
    maS > maL &&
    maL > maLPrev &&
    c >= C.LO52_MULT * lo52 &&
    c >= C.HI52_NEAR * hi52
  return { pass, ma: { f: maF, m: maM, s: maS, l: maL }, hi52, lo52 }
}

export interface VCP {
  atrRatio: number
  volRatio: number
  resistPrior: number // 阻力(不含今日)
  posPct: number // 区间位置 0-100
  volSlow: number // volMA50
}

/** VCP/即将新高量化:波动收缩、缩量、前高阻力、区间位置。 */
export function computeVCP(bars: Bar[], C: ScreenerConfig = SCREENER): VCP {
  const n = bars.length
  const last = n - 1
  const atrF = atr(bars, C.ATR_FAST, last)
  const atrS = atr(bars, C.ATR_SLOW, last)
  const atrRatio = atrS > 0 ? atrF / atrS : 1
  const volF = mean(bars.slice(n - C.VOL_FAST, n).map((b) => b.volume))
  const volSlow = mean(bars.slice(n - C.VOL_SLOW, n).map((b) => b.volume))
  const volRatio = volSlow > 0 ? volF / volSlow : 1
  const prior = bars.slice(n - 1 - C.RESIST_LOOKBACK, n - 1) // 排除今日
  const resistPrior = prior.length ? Math.max(...prior.map((b) => b.high)) : bars[last].high
  const winBars = bars.slice(n - C.RESIST_LOOKBACK, n)
  const winHi = Math.max(...winBars.map((b) => b.high))
  const winLo = Math.min(...winBars.map((b) => b.low))
  const posPct = winHi > winLo ? ((bars[last].close - winLo) / (winHi - winLo)) * 100 : 100
  return { atrRatio, volRatio, resistPrior, posPct, volSlow }
}

/** 相对强度原值:加权 63/126/189/252 日收益。 */
export function rsRaw(closes: number[]): number {
  const n = closes.length
  const c = closes[n - 1]
  const ret = (k: number) => (n - 1 - k >= 0 && closes[n - 1 - k] > 0 ? c / closes[n - 1 - k] - 1 : 0)
  return 0.4 * ret(63) + 0.2 * ret(126) + 0.2 * ret(189) + 0.2 * ret(252)
}

/** 上方最近阻力(测算目标位);无套牢盘则给测算下限。 */
function nextResistanceAbove(highs: number[], level: number, price: number, C: ScreenerConfig): number {
  const above = highs.filter((h) => h > level * 1.001)
  if (above.length) return Math.min(...above)
  return Math.max(level, price) * (1 + C.TARGET_MIN_PCT / 100)
}

/**
 * 目标位:按 C.TARGET_MODE 选择算法。
 *  - rmult:进场 + R_MULT×风险(直接锁定盈亏比,修复 payoff<1;不套地板,地板会破坏 R:R)。
 *  - measured:pivot + 基底高度(pivot − 近 BASE_LOOKBACK 根最低),测量幅度上投;套地板。
 *  - atr:进场 + k×ATR(ATR_SLOW);套地板。
 *  - resistance:pivot 上方最近历史高点(原始行为,无额外地板;nextResistanceAbove 自带下限回退)。
 */
function computeTarget(
  bars: Bar[],
  ctx: { close: number; pivot: number; stopLoss: number },
  C: ScreenerConfig,
): number {
  const { close, pivot, stopLoss } = ctx
  const floor = close * (1 + C.TARGET_MIN_PCT / 100)
  switch (C.TARGET_MODE) {
    case 'rmult':
      return close + C.TARGET_R_MULT * (close - stopLoss)
    case 'atr': {
      const a = atr(bars, C.ATR_SLOW, bars.length - 1)
      return Math.max(close + C.TARGET_ATR_MULT * a, floor)
    }
    case 'measured': {
      const win = bars.slice(-C.BASE_LOOKBACK)
      const baseLow = win.length ? Math.min(...win.map((b) => b.low)) : pivot
      return Math.max(pivot + (pivot - baseLow), floor)
    }
    case 'resistance':
    default:
      return nextResistanceAbove(bars.map((b) => b.high), Math.max(pivot, close), close, C)
  }
}

/**
 * 主判定:通过趋势模板的票,按今日相对前高阻力的位置分到
 * 「今日已突破(放量、收强、不追高)」或「即将突破(缩量收敛、贴近前高)」。
 * 不满足任一组返回 null。延伸段(收盘 > pivot×1.05)被剔除——正是追高拦截。
 */
export function classify(bars: Bar[], C: ScreenerConfig = SCREENER): Candidate | null {
  const tt = trendTemplate(bars, C)
  if (!tt || !tt.pass) return null

  const n = bars.length
  const last = n - 1
  const today = bars[last]
  const prev = bars[last - 1]
  const close = today.close
  const changePct = prev.close > 0 ? (close / prev.close - 1) * 100 : 0

  const { atrRatio, volRatio, resistPrior, volSlow } = computeVCP(bars, C)
  const pivot = resistPrior
  const distToPivotPct = pivot > 0 ? ((pivot - close) / pivot) * 100 : 0
  const atrContract = atrRatio < C.ATR_RATIO_MAX
  const volDry = volRatio < C.VOL_DRY_MAX
  const breakoutVol = volSlow > 0 && today.volume >= C.BREAKOUT_VOL * volSlow
  const range = today.high - today.low
  const closeStrong = range > 0 ? (close - today.low) / range >= C.CLOSE_STRENGTH : true
  const notExtended = close <= pivot * (1 + C.EXT_MAX / 100)

  let group: ScreenerGroup | null = null
  let pattern = ''
  let volScore = 0
  if (close > pivot && breakoutVol && closeStrong && notExtended) {
    group = 'breakout'
    pattern = '放量突破前高'
    volScore = clamp01((today.volume / volSlow - 1) / 2)
  } else if (distToPivotPct > 0 && distToPivotPct <= C.NEAR_PCT && volDry) {
    // 扳机:强趋势 + 贴近 52 周高 + 量能未放大(尚未启动)。ATR 收敛作为加分项(coil),
    // 不做硬门槛——强势龙头逼近新高时波动通常偏大,强求收敛会让清单恒空。
    group = 'trigger'
    pattern = atrContract ? '缩量收敛·贴近前高' : '缩量蓄势·贴近前高'
    volScore = 1 - clamp01(volRatio)
  }
  if (!group) return null

  // 先定止损(rmult 目标位依赖风险 = 进场 − 止损),再按模式算目标位。
  const rawStop = Math.min(pivot, today.low)
  const stopLoss = Math.max(rawStop, close * (1 - C.STOP_MAX_PCT / 100))
  const target = computeTarget(bars, { close, pivot, stopLoss }, C)

  const coil = clamp01(
    0.4 * (1 - Math.min(Math.max(distToPivotPct, 0), C.NEAR_PCT) / C.NEAR_PCT) +
      0.3 * (1 - Math.min(atrRatio, 1)) +
      0.3 * (1 - Math.min(volRatio, 1)),
  )
  const trendStrength = clamp01((close / tt.ma.m - 1) / 0.2) // 高于 MA60 达20% 封顶

  return {
    group,
    price: r2(close),
    changePct: r2(changePct),
    pivot: r2(pivot),
    stopLoss: r2(stopLoss),
    target: r2(target),
    rsRaw: rsRaw(bars.map((b) => b.close)),
    coil: r2(coil),
    trendStrength: r2(trendStrength),
    volRatio: r2(volRatio),
    atrRatio: r2(atrRatio),
    volScore: r2(volScore),
    distToPivotPct: r2(distToPivotPct),
    signals: { trendOk: true, volDry, atrContract, breakoutVol, pattern },
  }
}

// ── 大盘环境(指数趋势代理)→ 动态目标位 R 倍数 ───────────────────────
export type MarketRegime = 'strong' | 'neutral' | 'weak'

/**
 * 用宽基指数收盘序列判大盘环境(纯函数,回测/线上共用):
 *  strong(进攻):close > MA_FAST 且 MA_FAST > MA_SLOW(多头趋势);
 *  weak(退潮):close < MA_SLOW(跌破中期均线);其余 neutral。
 * 历史不足(< MA_SLOW)返回 neutral(中性,不激进)。
 */
export function marketRegime(closes: number[], C: ScreenerConfig = SCREENER): MarketRegime {
  const n = closes.length
  if (n < C.MARKET_MA_SLOW) return 'neutral'
  const last = n - 1
  const c = closes[last]
  const maF = smaAt(closes, C.MARKET_MA_FAST, last)
  const maS = smaAt(closes, C.MARKET_MA_SLOW, last)
  if (c > maF && maF > maS) return 'strong'
  if (c < maS) return 'weak'
  return 'neutral'
}

/** 按环境取目标 R 倍数:dynamic 关闭时回退标量 TARGET_R_MULT。 */
export function targetRMultFor(regime: MarketRegime, C: ScreenerConfig = SCREENER): number {
  if (!C.TARGET_R_DYNAMIC) return C.TARGET_R_MULT
  return C.TARGET_R_BY_REGIME[regime]
}

/** 最终评分:RS 百分位 + 弹簧度 + 趋势强度 + 量能 + 流动性。0-100。 */
export function finalScore(c: Candidate, rsRank01: number, liq01: number, C: ScreenerConfig = SCREENER): number {
  const w = C.WEIGHTS
  return r2(
    100 *
      (w.rs * rsRank01 + w.coil * c.coil + w.trend * c.trendStrength + w.vol * c.volScore + w.liq * liq01),
  )
}
