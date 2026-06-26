// 技术分析组合(Wyckoff 量价 + 道氏趋势结构 + Al Brooks 价格行为)· 纯函数,零网络,可单测。
// 复用项目已有方法,不重复造轮子:
//   · Wyckoff   = knowledge/wyckoff.analyzeWyckoffPhase(阶段:吸筹/上涨/派发/下跌 + 努力≠结果)
//   · 价格行为  = divergenceRules 的 bodyRatio/upperWickRatio/lowerWickRatio + screenerRules closeStrength
//   · 道氏      = screenerRules.trendTemplate(多头排列)+ 近端 HH-HL 结构
// 产出 0..1 因子(0.5 中性,供给<0.5、需求>0.5)+ bias + distribution(强派发=大族式「放量阴线/UTAD 收阴于前高」)。
// 作用:全 7 战法整体评分(新高 finalScore 加权;其余组按因子缩放 + distribution 降档 + ⚠)。见 config TECH。
import { TECH, type TechnicalComboConfig } from '../config/screener'
import { analyzeWyckoffPhase } from '../knowledge/wyckoff'
import { type Bar, mean, smaAt, trendTemplate } from './screenerRules'
import { upperWickRatio } from './divergenceRules'

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export interface TechnicalCombo {
  score01: number // 0..1(0.5 中性);<0.5 供给占优、>0.5 需求占优
  bias: 'demand' | 'supply' | 'neutral'
  distribution: boolean // 强派发(大族式出货)→ 调用方降档 + ⚠
  wyckoffPhase: string // 维科夫阶段(中文)
  tags: string[] // 命中量价信号标签
  note: string
}

const NEUTRAL: TechnicalCombo = { score01: 0.5, bias: 'neutral', distribution: false, wyckoffPhase: '未明', tags: [], note: '数据不足' }

/**
 * 三法合成的技术分析组合因子(只读信号日及之前 K 线,零前视)。
 * @param bars 候选个股日 K(已前复权)
 */
export function technicalCombo(bars: Bar[], _code: string, C: TechnicalComboConfig = TECH): TechnicalCombo {
  const n = bars.length
  if (n < Math.max(C.WYCKOFF_WIN, C.LOOKBACK, C.VOL_MA) + 2) return NEUTRAL
  const last = n - 1
  const today = bars[last]
  const prev = bars[last - 1]
  if (today.close <= 0 || prev.close <= 0) return NEUTRAL
  const closes = bars.map((b) => b.close)
  const tags: string[] = []

  // ── ① Wyckoff(阶段 + 努力≠结果)──
  const win = bars.slice(-C.WYCKOFF_WIN)
  const wk = analyzeWyckoffPhase({
    prices: win.map((b) => b.close),
    volumes: win.map((b) => b.volume),
    highs: win.map((b) => b.high),
    lows: win.map((b) => b.low),
  })
  let wySig = 0
  if (wk.phase === 'markup') wySig = wk.signals.some((s) => s.includes('动能减弱')) ? -0.1 : 0.6
  else if (wk.phase === 'accumulation') wySig = 0.3
  else if (wk.phase === 'distribution') wySig = -0.6
  else if (wk.phase === 'markdown') wySig = -0.8
  wySig *= 0.5 + 0.5 * wk.confidence // 置信度缩放
  if (wk.signals.some((s) => s.includes('努力与结果不一致'))) {
    wySig -= 0.2
    tags.push('放量滞涨·努力≠结果')
  }
  const wyPhaseName =
    wk.phase === 'markup' ? '标记上涨' : wk.phase === 'accumulation' ? '吸筹' : wk.phase === 'distribution' ? '派发' : wk.phase === 'markdown' ? '标记下跌' : '未明'

  // ── ② 价格行为(Al Brooks)bar 级供需 ──
  const volMA = mean(bars.slice(last - C.VOL_MA, last).map((b) => b.volume))
  const volHot = volMA > 0 && today.volume >= C.VOL_HOT * volMA
  const isRed = today.close < today.open
  const changePct = (today.close / prev.close - 1) * 100
  const uw = upperWickRatio(today)
  const range = today.high - today.low
  const closeStrong = range > 0 ? (today.close - today.low) / range : 1
  const recentHigh = Math.max(...bars.slice(Math.max(0, last - C.LOOKBACK), last).map((b) => b.high))
  const nearHigh = recentHigh > 0 && today.close >= recentHigh * (1 - C.NEAR_HIGH_PCT / 100)
  const gapUp = today.open / prev.close - 1 >= C.GAP_UP_PCT / 100
  const ma5 = smaAt(closes, 5, last)

  let paSig = 0
  let strongSupply = false
  // 供给(派发)
  if (volHot && isRed && nearHigh) {
    paSig -= 0.6
    strongSupply = true
    tags.push('放量阴线·派发')
  }
  if (volHot && uw >= C.UPPER_WICK && nearHigh) {
    paSig -= 0.4
    strongSupply = true
    tags.push('长上影·冲高回落(UTAD)')
  }
  if (gapUp && today.close < today.open && volHot) {
    paSig -= 0.3
    strongSupply = true
    tags.push('高开低走')
  }
  if (volHot && Math.abs(changePct) <= C.STALL_PCT) {
    paSig -= 0.3
    if (!tags.includes('放量滞涨·努力≠结果')) tags.push('放量滞涨')
  }
  // 需求
  if (volHot && !isRed && closeStrong >= C.CLOSE_STRONG) {
    paSig += 0.5
    tags.push('SOS·放量收强')
  }
  if (!volHot && isRed && today.volume < prev.volume && ma5 > 0 && today.close >= ma5) {
    paSig += 0.3
    tags.push('缩量回调·健康')
  }
  paSig = clamp(paSig, -1, 1)

  // ── ③ 道氏(趋势结构 HH-HL)──
  const tt = trendTemplate(bars)
  const ma20 = smaAt(closes, 20, last)
  let dowSig = 0
  if (tt && tt.pass) dowSig += 0.4
  else if (ma20 > 0 && today.close > ma20) dowSig += 0.1
  else dowSig -= 0.4
  if (today.high >= recentHigh) dowSig += 0.2 // 创新高(higher high)
  else if (today.high < recentHigh * 0.97) dowSig -= 0.2 // 明显 lower high(结构走弱)
  dowSig = clamp(dowSig, -1, 1)

  // ── 组合 ──
  const W = C.WEIGHTS
  const wsum = W.wyckoff + W.priceAction + W.dow
  const raw = clamp((W.wyckoff * clamp(wySig, -1, 1) + W.priceAction * paSig + W.dow * dowSig) / wsum, -1, 1)
  const score01 = (raw + 1) / 2
  // distribution(大族式强派发):bar 级强供给 + 于前高附近 + 收阴/长上影(出货确认)
  const distribution = strongSupply && nearHigh && (isRed || uw >= C.UPPER_WICK)
  // 确认出货 K 线即判供给(高位派发即使 30 日仍处上涨趋势);否则按合成 raw 定 bias。
  const bias: TechnicalCombo['bias'] = distribution ? 'supply' : raw > 0.15 ? 'demand' : raw < -0.15 ? 'supply' : 'neutral'
  const biasTxt = bias === 'supply' ? '供给占优' : bias === 'demand' ? '需求占优' : '多空均衡'
  const note = `${wyPhaseName}·${biasTxt}${tags.length ? '·' + tags.slice(0, 2).join('·') : ''}`

  return { score01: r2(score01), bias, distribution, wyckoffPhase: wyPhaseName, tags, note }
}

/** score01 → 其余组 score 的缩放倍数(供给压低、需求抬高)。 */
export function techMult(score01: number, C: TechnicalComboConfig = TECH): number {
  return C.MULT_MIN + (C.MULT_MAX - C.MULT_MIN) * clamp(score01, 0, 1)
}
