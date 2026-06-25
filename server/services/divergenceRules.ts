// 打板情绪·连板分歧低吸 战法 — 纯函数判定层(无网络,可单测)。
// 抓「连板/连续新高 → 分歧日(触板未封/高振幅砸盘) → 没崩(收盘站当日均价=弱转强)」的低吸点。
// 两组:① lianban 连板分歧(连板后首日分歧低吸) ② pullback2 回调二波分歧(二次启动途中的分歧确认)。
// 命门信号「收盘在均价线上方=弱转强」用当日均价(日内VWAP=成交额/成交量)实现,无需盘口/分时。
// ⚠ 超短(T+1)赔率游戏,阈值待回测校准;主力净流入暂缺,用 连板+分歧+VWAP+量价 近似。
import { DIVERGENCE, HIGHDIV, type DivergenceConfig, type HighDivConfig } from '../config/screener'
import { type Bar, mean, smaAt } from './screenerRules'

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** 板块涨停幅(%):双创/科创 20、北交 30、主板 10。选股 universe 已排除 ST,故按代码前缀即可。 */
export function boardLimitPct(code: string): number {
  if (code.startsWith('688') || code.startsWith('300') || code.startsWith('301')) return 20
  if (/^(4|8|920|43|83|87)/.test(code)) return 30 // 北交所(选股 universe 不含,稳妥起见)
  return 10
}

/** 当日均价(日内 VWAP≈分时均价线收盘值)= 成交额 / 成交量。
 *  EM 成交量单位为手(×100 股),成交额为元;单位健壮:取使均价落在 [low,high] 的口径,否则 null
 *  (Tencent 兜底无成交额 → null,调用方降级用典型价代理)。 */
export function dailyVWAP(bar: Bar): number | null {
  if (!bar.turnover || bar.turnover <= 0 || bar.volume <= 0) return null
  const perHand = bar.turnover / (bar.volume * 100) // 手→股
  if (perHand >= bar.low * 0.98 && perHand <= bar.high * 1.02) return r2(perHand)
  const perShare = bar.turnover / bar.volume
  if (perShare >= bar.low * 0.98 && perShare <= bar.high * 1.02) return r2(perShare)
  return null
}

/** 振幅%:优先用 EM 字段,缺失时 (高−低)/昨收。 */
function ampPct(bar: Bar, prevClose: number): number {
  if (bar.amplitude && bar.amplitude > 0) return bar.amplitude
  return prevClose > 0 ? ((bar.high - bar.low) / prevClose) * 100 : 0
}

/** 当日是否封死涨停(收盘≈涨停价,留 1 分容差)。 */
export function isLimitUpDay(bar: Bar, prevClose: number, code: string): boolean {
  if (prevClose <= 0) return false
  return bar.close >= prevClose * (1 + boardLimitPct(code) / 100) - 0.01
}

/** 当日触及涨停但未封住(最高=涨停价、收盘<涨停)= 盘中分歧/炸板。 */
export function touchedLimitOpened(bar: Bar, prevClose: number, code: string): boolean {
  if (prevClose <= 0) return false
  const limitPrice = prevClose * (1 + boardLimitPct(code) / 100)
  return bar.high >= limitPrice - 0.01 && bar.close < limitPrice - 0.01
}

/** 连板数:从 endIdx 往前数连续封板涨停的根数。 */
export function consecutiveLimitUps(bars: Bar[], endIdx: number, code: string): number {
  let n = 0
  for (let i = endIdx; i >= 1; i--) {
    if (isLimitUpDay(bars[i], bars[i - 1].close, code)) n++
    else break
  }
  return n
}

/** ② 回调二波启动:最近 PB2_LOOKBACK 根内有过涨停,且该启动前价格处于对前高的回调中(回调≥PB2_RETRACE)。 */
function hadRecentRestart(bars: Bar[], last: number, code: string, C: DivergenceConfig): boolean {
  const from = Math.max(1, last - C.PB2_LOOKBACK)
  let luIdx = -1
  for (let i = last - 1; i >= from; i--) {
    if (isLimitUpDay(bars[i], bars[i - 1].close, code)) {
      luIdx = i
      break
    }
  }
  if (luIdx < 1) return false
  const hStart = Math.max(0, luIdx - C.PB2_HIGH_LOOKBACK)
  const slice = bars.slice(hStart, luIdx)
  if (!slice.length) return false
  const priorHigh = Math.max(...slice.map((b) => b.high))
  const preLaunchClose = bars[luIdx - 1].close
  return priorHigh > 0 && preLaunchClose <= priorHigh * (1 - C.PB2_RETRACE)
}

export type DivergenceGroup = 'lianban' | 'pullback2'

export interface DivergenceCandidate {
  group: DivergenceGroup
  price: number // 今日收盘(分歧日)
  changePct: number
  vwap: number | null // 当日均价(日内VWAP);null=Tencent兜底无成交额
  weakToStrong: boolean // 收盘 ≥ 当日均价(弱转强✓)
  didntCollapse: boolean // 没崩:收盘较当日高回撤≤COLLAPSE_MAX 且未深跌 且弱转强
  amplitude: number // 振幅%
  boards: number // 今日之前的连板数(lianban 组)
  touchedLimit: boolean // 今日触板未封(炸板式分歧)
  volRatio: number // 今日量 / VOL_MA 均量
  // 交易计划(尾盘低吸 → 次日反包)
  buyLow: number
  buyHigh: number // 尾盘低吸区(均价附近)
  stop: number // 止损=昨收下方破位
  target: number // 目标=次日反包冲今日涨停价
  positionHint: string // 试错仓
  riskReward: number // 盈亏比 (target−买入)/(买入−止损)
  tier: number // 1-3 星强弱
  score: number // 0-100
  kPath: string // 近几日 K 线路径
  reason: string
  riskNote?: string // 换手过大 / 收盘在均价下方 等风险
}

/** mm-dd 短日期(EM 日期为 YYYY-MM-DD)。 */
const md = (d: string) => (d.length >= 10 ? d.slice(5) : d)

/**
 * 主判定:连板/连续新高 或 回调二波 之后的「分歧日」,收盘站当日均价=弱转强=低吸点。
 * 今日仍封死涨停=一致非分歧→不取;两组互斥(先判连板,priorBoards<MIN_BOARDS 才看二波)。
 */
export function classifyDivergence(bars: Bar[], code: string, C: DivergenceConfig = DIVERGENCE): DivergenceCandidate | null {
  const n = bars.length
  if (n < C.MIN_BARS) return null
  const last = n - 1
  const today = bars[last]
  const prevClose = bars[last - 1].close
  if (prevClose <= 0 || today.close <= 0) return null

  const changePct = (today.close / prevClose - 1) * 100
  const amp = ampPct(today, prevClose)
  const vwap = dailyVWAP(today)
  // 弱转强:收盘 ≥ 当日均价;无成交额时用典型价 (H+L+C)/3 代理
  const ref = vwap ?? (today.high + today.low + today.close) / 3
  const weakToStrong = today.close >= ref

  const limitPrice = prevClose * (1 + boardLimitPct(code) / 100)
  const sealedToday = today.close >= limitPrice - 0.01 // 今日仍封死=一致,排除
  const touched = touchedLimitOpened(today, prevClose, code)
  const isDivergenceDay = !sealedToday && (touched || amp >= C.AMP_DIVERGE)
  if (!isDivergenceDay) return null

  const closes = bars.map((b) => b.close)
  const priorBoards = consecutiveLimitUps(bars, last - 1, code) // 数到昨日(今日是分歧日)
  const ma20 = smaAt(closes, 20, last)

  let group: DivergenceGroup | null = null
  if (priorBoards >= C.MIN_BOARDS) group = 'lianban'
  else if (today.close > ma20 && hadRecentRestart(bars, last, code, C)) group = 'pullback2'
  if (!group) return null

  // 没崩:收盘较当日最高回撤≤COLLAPSE_MAX、未深跌(跌幅>−DOWN_MAX)、且弱转强
  const fadeFromHigh = today.high > 0 ? ((today.high - today.close) / today.high) * 100 : 0
  const didntCollapse = weakToStrong && fadeFromHigh <= C.COLLAPSE_MAX && changePct > -C.DOWN_MAX

  const volMa = mean(bars.slice(Math.max(0, n - 1 - C.VOL_MA), n - 1).map((b) => b.volume))
  const volRatio = volMa > 0 ? today.volume / volMa : 0

  // 强弱分档:站均价+没崩=3星(首选);其一=2星;都不满足=1星(弱不追)
  const tier = weakToStrong && didntCollapse ? 3 : weakToStrong || didntCollapse ? 2 : 1

  // 交易计划:尾盘低吸=均价附近;止损=昨收下方破位;目标=次日反包冲今日涨停价
  const base = vwap ?? today.close
  const buyHigh = r2(Math.max(base, today.close * (1 - 0.005)))
  const buyLow = r2(base * (1 - C.BUY_BAND / 100))
  const stop = r2(prevClose * (1 - C.STOP_BELOW / 100))
  const target = r2(limitPrice)
  const fill = (buyLow + buyHigh) / 2
  const riskReward = fill > stop ? r2((target - fill) / (fill - stop)) : 0
  const positionHint = tier >= 3 ? '试错仓 1/4(强转可加)' : '试错仓 1/4'

  // 评分(权重和归一)
  const W = C.WEIGHTS
  const sBoards = clamp01((priorBoards - 1) / 3) // 2连板→0.33、4连板→1
  const score01 =
    (W.w2s * (weakToStrong ? 1 : 0) +
      W.nocollapse * clamp01(1 - fadeFromHigh / Math.max(C.COLLAPSE_MAX, 1)) +
      W.boards * sBoards +
      W.vol * clamp01((volRatio - 1) / 2)) /
    (W.w2s + W.nocollapse + W.boards + W.vol)

  // K 线路径:近 3 根 + 今日 OHLC
  const tag = (i: number) =>
    isLimitUpDay(bars[i], bars[i - 1].close, code) ? `${md(bars[i].date)}涨停${r2(bars[i].close)}` : `${md(bars[i].date)}${r2(bars[i].close)}`
  const pathParts: string[] = []
  for (let i = Math.max(1, last - 3); i < last; i++) pathParts.push(tag(i))
  pathParts.push(`今日开${r2(today.open)}高${r2(today.high)}低${r2(today.low)}收${r2(today.close)}`)
  const kPath = pathParts.join(' → ')

  const groupTxt = group === 'lianban' ? `${priorBoards}连板后首日分歧` : '回调二波·分歧确认'
  const divTxt = touched ? '触板未封' : `高振幅${r2(amp)}%`
  const w2sTxt = weakToStrong ? '收盘站均价(弱转强)' : '收盘在均价下方(偏弱)'
  const reason = `${groupTxt}·${divTxt}·${w2sTxt}`
  const riskNote = !weakToStrong ? '收盘在均价下方·偏弱不追' : fadeFromHigh > C.COLLAPSE_MAX ? '尾盘跳水·有崩相' : undefined

  return {
    group,
    price: r2(today.close),
    changePct: r2(changePct),
    vwap,
    weakToStrong,
    didntCollapse,
    amplitude: r2(amp),
    boards: priorBoards,
    touchedLimit: touched,
    volRatio: r2(volRatio),
    buyLow,
    buyHigh,
    stop,
    target,
    positionHint,
    riskReward,
    tier,
    score: Math.round(score01 * 100),
    kPath,
    reason,
    riskNote,
  }
}

// ════════════════════════════════════════════════════════════════════════
// 连续新高·分歧低吸(纯 OHLCV) — 强势股连续新高后的「缩量十字星·守 MA5」洗盘日 = 低吸介入点。
// 不依赖成交额/VWAP/分时,故可用现有缓存回测。精选:A 前提 + B 分歧日 全为硬门槛。
// ════════════════════════════════════════════════════════════════════════
const candleRange = (b: Bar) => b.high - b.low
const bodyRatio = (b: Bar) => (candleRange(b) > 0 ? Math.abs(b.close - b.open) / candleRange(b) : 0)
const lowerWickRatio = (b: Bar) => (candleRange(b) > 0 ? (Math.min(b.open, b.close) - b.low) / candleRange(b) : 0)
const upperWickRatio = (b: Bar) => (candleRange(b) > 0 ? (b.high - Math.max(b.open, b.close)) / candleRange(b) : 0)

export interface HighDivCandidate {
  group: 'highdiv'
  price: number // 分歧日收盘
  changePct: number
  nhHigh: number // 近期(NH_LOOKBACK)新高
  retraceFromHigh: number // 距新高回撤%
  dryRatio: number // 今日量/昨量(缩量倍数)
  bodyRatio: number // 实体率(越小越像十字星)
  amplitude: number // 振幅%
  lowerWick: number // 下影/振幅(承接力)
  ma5: number
  ma10: number
  ma20: number
  upperHalf: boolean // 收盘在当日振幅上半区(弱转强代理)
  // 交易计划
  entry: number
  stop: number
  target: number
  riskReward: number
  positionHint: string
  tier: number // 1-3
  score: number // 0-100
  kPath: string
  reason: string
  riskNote?: string
}

/**
 * 连续新高强势股的「缩量十字星·守 MA5」分歧低吸日识别(精选,全硬门槛)。
 * A 前提:近 NH_RECENT 日刷新 NH_LOOKBACK 日新高 + 多头排列 + 收盘 > MA20。
 * B 分歧日:缩量带 + 十字星 + 站 MA5 + 回调可控 + 收盘上半区 + 创新高日非巨量长上影(出货)。
 */
export function classifyHighDivergence(bars: Bar[], code: string, C: HighDivConfig = HIGHDIV): HighDivCandidate | null {
  void code // 纯 OHLCV,不分板;保留签名一致
  const n = bars.length
  if (n < C.MIN_BARS) return null
  const last = n - 1
  const today = bars[last]
  const prev = bars[last - 1]
  const prevClose = prev.close
  if (prevClose <= 0 || today.close <= 0 || prev.volume <= 0) return null

  const closes = bars.map((b) => b.close)
  const ma5 = smaAt(closes, 5, last)
  const ma10 = smaAt(closes, 10, last)
  const ma20 = smaAt(closes, 20, last)
  const ma20prev = smaAt(closes, 20, last - 5)

  // ── A 前提硬门槛 ──
  const recentSlice = bars.slice(last - C.NH_RECENT + 1, last + 1)
  const recentHigh = Math.max(...recentSlice.map((b) => b.high))
  const priorWin = bars.slice(Math.max(0, last - C.NH_RECENT + 1 - C.NH_LOOKBACK), last - C.NH_RECENT + 1)
  if (!priorWin.length) return null
  const priorHigh = Math.max(...priorWin.map((b) => b.high))
  if (recentHigh < priorHigh) return null // 近 NH_RECENT 日须刷新前 NH_LOOKBACK 日高点
  if (!(ma5 > ma10 && ma10 > ma20)) return null // 多头排列
  if (!(ma20 > ma20prev)) return null // MA20 上行
  if (today.close <= ma20) return null // 没破中枢

  // ── B 分歧日硬门槛 ──
  const dryRatio = today.volume / prev.volume
  if (dryRatio < C.DRY_FLOOR || dryRatio > C.DRY) return null // 缩量(明显缩、但有承接)
  const br = bodyRatio(today)
  const amp = (candleRange(today) / prevClose) * 100
  if (br > C.DOJI || amp < C.MIN_AMP) return null // 十字星 + 有波动
  if (today.close < ma5) return null // 不破 5 日线
  const changePct = (today.close / prevClose - 1) * 100
  const nhHigh = Math.max(recentHigh, priorHigh)
  const retrace = nhHigh > 0 ? ((nhHigh - today.close) / nhHigh) * 100 : 0
  if (changePct < -C.DOWN || retrace > C.RETR) return null // 回调可控
  const upperHalf = today.close >= (today.high + today.low) / 2
  if (!upperHalf) return null // 收盘上半区(弱转强代理)

  // 创新高那根非巨量长上影(出货特征)→ 排除
  let nhIdx = last
  for (let i = last; i > last - C.NH_RECENT && i >= 1; i--) {
    if (bars[i].high >= recentHigh - 1e-6) {
      nhIdx = i
      break
    }
  }
  const nhBar = bars[nhIdx]
  const nhVolMa = mean(bars.slice(Math.max(0, nhIdx - C.VOL_MA), nhIdx).map((b) => b.volume))
  if (upperWickRatio(nhBar) > C.EXHAUST_WICK && nhVolMa > 0 && nhBar.volume >= C.EXHAUST_VOL * nhVolMa) return null

  // ── 交易计划 ──
  const entry = today.close
  const stop = Math.max(Math.min(ma5, today.low), entry * (1 - C.STOP_MAX / 100))
  const risk = entry - stop
  if (risk <= 0) return null
  const target = entry + C.R_MULT * risk

  // ── 软加分 / 分档 ──
  const lw = lowerWickRatio(today)
  const ma5up = ma5 >= smaAt(closes, 5, last - 1)
  const tight = clamp01((10 - amp) / 8) // 振幅越小越紧凑(2%→1、10%→0)
  const W = C.WEIGHTS
  const score01 =
    (W.lowerWick * clamp01(lw / 0.5) + W.ma5slope * (ma5up ? 1 : 0) + W.tight * tight) / (W.lowerWick + W.ma5slope + W.tight)
  const strong = (lw >= 0.3 ? 1 : 0) + (ma5up ? 1 : 0) + (retrace <= 4 ? 1 : 0)
  const tier = strong >= 2 ? 3 : score01 > 0.4 ? 2 : 1

  const tag = (i: number) => `${md(bars[i].date)}${r2(bars[i].close)}`
  const pathParts: string[] = []
  for (let i = Math.max(1, last - 3); i < last; i++) pathParts.push(tag(i))
  pathParts.push(`今日开${r2(today.open)}高${r2(today.high)}低${r2(today.low)}收${r2(today.close)}`)
  const kPath = pathParts.join(' → ')

  const reason = `连续新高·缩量${r2(dryRatio)}倍·${br <= 0.15 ? '十字星' : '小实体'}·守MA5·回撤${r2(retrace)}%`
  const riskNote = !ma5up ? 'MA5 走平/拐头·动能转弱' : retrace > C.RETR * 0.75 ? '回撤偏深·临界' : undefined

  return {
    group: 'highdiv',
    price: r2(today.close),
    changePct: r2(changePct),
    nhHigh: r2(nhHigh),
    retraceFromHigh: r2(retrace),
    dryRatio: r2(dryRatio),
    bodyRatio: r2(br),
    amplitude: r2(amp),
    lowerWick: r2(lw),
    ma5: r2(ma5),
    ma10: r2(ma10),
    ma20: r2(ma20),
    upperHalf,
    entry: r2(entry),
    stop: r2(stop),
    target: r2(target),
    riskReward: r2(C.R_MULT),
    positionHint: tier >= 3 ? '试错仓 1/3(强转可加)' : '试错仓 1/4',
    tier,
    score: Math.round(score01 * 100),
    kPath,
    reason,
    riskNote,
  }
}
