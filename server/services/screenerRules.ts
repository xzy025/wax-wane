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
  // 以下二者来自 EM 日线(已解析进 KlineBar,经 `as Bar[]` 透传);Tencent 兜底缺成交额。
  turnover?: number // 成交额(元,EM f57);日内均价 VWAP=turnover/(volume×100手→股) 用,见 divergenceRules.dailyVWAP
  amplitude?: number // 振幅%(EM f58);缺失时用 (高−低)/昨收 计算
}

export type ScreenerGroup = 'trigger' | 'breakout' | 'watch'

/** 经典枢轴位(floor pivot):压力 R1/R2、支撑 S1/S2。 */
export interface Pivots {
  r1: number
  r2: number
  s1: number
  s2: number
}

/** 由最近一根 bar 的 H/L/C 计算经典枢轴位(投射下一交易日的压力/支撑)。 */
export function pivotLevels(bar: { high: number; low: number; close: number }): Pivots {
  const p = (bar.high + bar.low + bar.close) / 3
  const range = bar.high - bar.low
  return {
    r1: Math.round((2 * p - bar.low) * 100) / 100,
    r2: Math.round((p + range) * 100) / 100,
    s1: Math.round((2 * p - bar.high) * 100) / 100,
    s2: Math.round((p - range) * 100) / 100,
  }
}

export interface Candidate {
  group: ScreenerGroup
  price: number
  changePct: number
  pivot: number
  entry: number // 介入/试探价 = 当日收盘(实际成交):突破组=突破日收盘,扳机组=现价试探
  add: number // 加仓价:突破组=介入+ADD_R_MULT×风险(金字塔,高于介入);扳机组=pivot(放量突破补主仓)
  stopLoss: number
  target: number
  rsRaw: number
  coil: number
  trendStrength: number
  volRatio: number // volMA5 / volMA50
  atrRatio: number // ATR10 / ATR50
  volScore: number // 0-1,突破看放量、扳机看缩量
  breakoutVolRatio?: number // 今日量 / 50日均量(突破放量倍数,卡片「放量 1.8x」跟注)
  ma5?: number // 5日线(加仓参考:首次回踩不破即加仓,启发式未回测)
  firstBreakout?: boolean // 突破组:今日首次站上前高(昨收≤前高)→「今日首次突破」组;false=已突破仍在区内
  watchReason?: string // 临界观察组:距触发还差什么(放量逼近/已突破待确认/收盘弱)
  distToPivotPct: number // 距 pivot(前高)%:>0 在下方(扳机)、<0 已在上方(突破/延伸)
  dist52Pct: number // 距 52 周高%:>0 在高点下方、≤0 创新高
  pivots: Pivots // 经典枢轴位 R1/R2/S1/S2
  signals: { trendOk: boolean; volDry: boolean; atrContract: boolean; breakoutVol: boolean; pattern: string }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
/** 算术均值(空数组=0)。导出供并列战法(pullbackRules)复用。 */
export const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

/** 末端 N 根收盘均值(SMA,以 endIdx 结尾)。导出供并列战法复用。 */
export function smaAt(closes: number[], period: number, endIdx: number): number {
  if (endIdx - period + 1 < 0) return 0
  return mean(closes.slice(endIdx - period + 1, endIdx + 1))
}

/** ATR:以 endIdx 结尾的 period 根真实波幅均值。导出供并列战法复用。 */
export function atr(bars: Bar[], period: number, endIdx: number): number {
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
  const breakoutVolRatio = volSlow > 0 ? today.volume / volSlow : 0
  const range = today.high - today.low
  const closeStrengthRatio = range > 0 ? (close - today.low) / range : 1
  const closeStrong = closeStrengthRatio >= C.CLOSE_STRENGTH
  const notExtended = close <= pivot * (1 + C.EXT_MAX / 100)

  let group: ScreenerGroup | null = null
  let pattern = ''
  let volScore = 0
  let watchReason = ''
  let firstBreakout = false
  if (close > pivot && breakoutVol && closeStrong && notExtended) {
    group = 'breakout'
    pattern = '放量突破前高'
    volScore = clamp01((today.volume / volSlow - 1) / 2)
    firstBreakout = prev.close <= pivot // 今日首次站上前高(昨收≤前高)→「今日首次突破」组
  } else if (distToPivotPct > 0 && distToPivotPct <= C.NEAR_PCT && volDry) {
    // 扳机:强趋势 + 贴近 52 周高 + 量能未放大(尚未启动)。ATR 收敛作为加分项(coil),
    // 不做硬门槛——强势龙头逼近新高时波动通常偏大,强求收敛会让清单恒空。
    group = 'trigger'
    pattern = atrContract ? '缩量收敛·贴近前高' : '缩量蓄势·贴近前高'
    volScore = 1 - clamp01(volRatio)
  } else if (C.WATCH_ENABLE) {
    // 临界观察:趋势完美但落在突破/扳机之间的「放量逼近/待确认」空档(追求模糊的正确)。
    if (close > pivot && notExtended && breakoutVol && !closeStrong) {
      group = 'watch' // 放量够但收盘弱=冲高回落(京东方型),待次日确认非假突破
      pattern = '放量突破·收盘弱'
      watchReason = `放量突破但收盘弱·收${Math.round(closeStrengthRatio * 100)}%(待次日确认)`
    } else if (close > pivot && notExtended && closeStrong && breakoutVolRatio >= C.BREAKOUT_VOL - C.WATCH_VOL_MARGIN) {
      group = 'watch' // 已突破但放量差一丝(晶方型)
      pattern = '刚突破·待放量确认'
      watchReason = `已突破·放量${breakoutVolRatio.toFixed(2)}x 略欠确认线${C.BREAKOUT_VOL}x`
    } else if (distToPivotPct > 0 && distToPivotPct <= C.NEAR_PCT + C.WATCH_NEAR_EXTRA && volRatio >= C.WATCH_VOL_HOT) {
      group = 'watch' // 放量逼近前高但未破(大族型:真·放量,非仅"不缩量")
      pattern = '放量逼近前高'
      watchReason = `放量逼近·距前高${distToPivotPct.toFixed(1)}%(放量站上${r2(pivot)}即突破)`
    }
  }
  if (!group) return null
  const closes = bars.map((b) => b.close)
  const ma5 = smaAt(closes, C.ADD_MA, last) // 5日线(参考量)

  // 止损(rmult 目标位依赖风险 = 进场 − 止损,故先定):
  //  · 突破/观察组:结构止损 = min(pivot, 当日低),封顶 STOP_MAX%(8→7 已回测校准)。
  //  · 扳机试探仓:未突破的盘整区结构天然紧 → max(MA20, close×(1−STARTER_STOP%)),MA20 须在价下方。
  let stopLoss: number
  if (group === 'trigger') {
    const ma20 = smaAt(closes, C.MA_FAST, last)
    const pctStop = close * (1 - C.STARTER_STOP_PCT / 100)
    stopLoss = ma20 > 0 && ma20 < close ? Math.max(ma20, pctStop) : pctStop
  } else {
    const rawStop = Math.min(pivot, today.low)
    stopLoss = Math.max(rawStop, close * (1 - C.STOP_MAX_PCT / 100))
  }
  const target = computeTarget(bars, { close, pivot, stopLoss }, C)
  // 介入/试探 = 当日收盘(实际成交价);加仓分组:
  //  · 突破组金字塔顺势加:介入 + ADD_R_MULT×风险(高于介入,只给 +1R 赢家加注)。
  //  · 扳机/观察组:加主仓 = pivot(放量站上突破位当天补主仓)。
  const entry = close
  const add = group === 'breakout' ? close + C.ADD_R_MULT * (close - stopLoss) : pivot

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
    entry: r2(entry),
    add: r2(add),
    stopLoss: r2(stopLoss),
    target: r2(target),
    rsRaw: rsRaw(bars.map((b) => b.close)),
    coil: r2(coil),
    trendStrength: r2(trendStrength),
    volRatio: r2(volRatio),
    atrRatio: r2(atrRatio),
    volScore: r2(volScore),
    breakoutVolRatio: r2(breakoutVolRatio),
    ma5: r2(ma5),
    firstBreakout,
    watchReason: watchReason || undefined,
    distToPivotPct: r2(distToPivotPct),
    dist52Pct: r2(tt.hi52 > 0 ? ((tt.hi52 - close) / tt.hi52) * 100 : 0),
    pivots: pivotLevels(today),
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

/** 最终评分:RS 百分位 + 弹簧度 + 趋势强度 + 量能 + 流动性 + 外部加分(龙虎榜机构/板块强弱)。0-100。
 *  extra(lhb01/board01,均 0..1)与对应权重(WEIGHTS.lhb/board)缺省时按权重和归一,
 *  使加分因子权重=0 时本函数与旧版完全等价(下游 rotation 下钻调用不传 extra 不受影响)。 */
export function finalScore(
  c: Candidate,
  rsRank01: number,
  liq01: number,
  C: ScreenerConfig = SCREENER,
  extra?: { lhb01?: number; board01?: number; ta01?: number },
): number {
  const w = C.WEIGHTS
  const lhbW = w.lhb ?? 0
  const boardW = w.board ?? 0
  const taW = w.ta ?? 0
  const lhb01 = extra?.lhb01 ?? 0
  const board01 = extra?.board01 ?? 0
  // ta01 缺省按中性 0.5(技术分析组合无数据时不偏不倚,等价于不加分不减分)。
  const ta01 = extra?.ta01 ?? 0.5
  const wsum = w.rs + w.coil + w.trend + w.vol + w.liq + lhbW + boardW + taW
  return r2(
    (100 / wsum) *
      (w.rs * rsRank01 +
        w.coil * c.coil +
        w.trend * c.trendStrength +
        w.vol * c.volScore +
        w.liq * liq01 +
        lhbW * lhb01 +
        boardW * board01 +
        taW * ta01),
  )
}
