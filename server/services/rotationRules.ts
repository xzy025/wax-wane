// 板块轮动 · 纯函数判定层(无网络,可单测)。
// 2×2 象限:长期窗口(高/低)× 短期窗口(强/弱)。

export type Quadrant = 'hs' | 'ls' | 'hw' | 'lw'
// hs=高强(60日涨+近5日涨,强势延续) ls=低强(60日跌+近5日涨,底部反转)
// hw=高弱(60日涨+近5日跌,高位回调) lw=低弱(60日跌+近5日跌,持续走弱)

/** 以末根收盘相对 n 根前的涨跌幅(%)。closes 升序;数据不足/基准非正返回 NaN(由调用方过滤)。 */
export function changeOverWindow(closes: number[], n: number): number {
  const len = closes.length
  if (n <= 0 || len < n + 1) return NaN
  const last = closes[len - 1]
  const base = closes[len - 1 - n]
  if (!(base > 0)) return NaN
  return (last / base - 1) * 100
}

/** 长期涨幅(高低轴)× 短期涨幅(强弱轴)→ 象限。≥0 记为 涨/高/强。 */
export function classifyQuadrant(longChg: number, shortChg: number): Quadrant {
  const high = longChg >= 0
  const strong = shortChg >= 0
  if (high && strong) return 'hs'
  if (!high && strong) return 'ls'
  if (high && !strong) return 'hw'
  return 'lw'
}

// ════════════════════════════════════════════════════════════════════════
// 板块轮动节奏(tempo)—— 游资复盘表口径的 启动/调整 状态机(纯函数,监控/复盘用,非战法不进回测)。
// 启动日 = 收红 且 涨幅≥基准指数(纯收红普涨日无信息量、纯强于指数暴跌日把"跌得少"标成启动,取交集);
// 红=强启动(涨幅≥STRONG_PCT 或 放量≥VOL_UP)、黄=弱启动、绿=调整(强于指数时带"抗跌"注记)。

export const TEMPO = {
  STRONG_PCT: 1.5, // 强启动涨幅阈值(%)
  VOL_UP: 1.2, // 放量:当日量 ≥ 此×前 VOL_LOOKBACK 日均量
  VOL_DOWN: 0.7, // 缩量:当日量 ≤ 此×均量
  EXCESS_PCT: 1.0, // 「强于指数」chip 的超额门槛(pp):启动定义已含≥指数,chip 要"明显跑赢"才有信息量
  WINDOW: 5, // 展示窗口(交易日)
  VOL_LOOKBACK: 5, // 量比基准窗
} as const

export type TempoState = 'launch' | 'adjust'
export type TempoTier = 'strong' | 'weak' | 'adjust'
export type TempoQualifier = 'aboveIndex' | 'volUp' | 'volDown' | 'resilient'

export interface TempoDayInput {
  date: string
  boardChg: number // 板块当日涨跌幅 %
  indexChg: number // 基准指数当日涨跌幅 %
  volRatio?: number // 当日量/前 VOL_LOOKBACK 日均量;undefined/NaN=无量能(kpl 等权重构源)
}

export interface TempoCell {
  date: string
  state: TempoState
  dayN: number // 连续同状态第 N 天(≥1);用喂入的全历史计数,不受展示窗截断
  tier: TempoTier // strong红 / weak黄 / adjust绿
  chg: number // 板块当日涨跌幅(展示,两位)
  qualifiers: TempoQualifier[]
}

const tempoR2 = (n: number) => Math.round(n * 100) / 100

/** bars 升序 → 逐日涨跌幅(首根无前收,产出长度 = bars.length-1);前收非正的日子跳过。 */
export function dailyChanges(bars: { date: string; close: number }[]): { date: string; chg: number }[] {
  const out: { date: string; chg: number }[] = []
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close
    if (!(prev > 0)) continue
    out.push({ date: bars[i].date, chg: (bars[i].close / prev - 1) * 100 })
  }
  return out
}

/** volumes 升序 → 逐日 当日量/前 lookback 日均量;历史不足或均量非正 → NaN(占位,长度=volumes.length)。 */
export function volRatios(volumes: number[], lookback: number = TEMPO.VOL_LOOKBACK): number[] {
  return volumes.map((v, i) => {
    if (i < lookback) return NaN
    let sum = 0
    for (let k = i - lookback; k < i; k++) sum += volumes[k]
    const base = sum / lookback
    return base > 0 ? v / base : NaN
  })
}

/** 状态机主函数:逐日输入(升序、已按日期对齐)→ 逐日格子。dayN 从序列头部起数(头部截断处从 1 起,
 *  实战喂 ≥60 日历史,5 日展示窗内的计数准确)。 */
export function computeTempoSeries(days: TempoDayInput[]): TempoCell[] {
  const out: TempoCell[] = []
  for (const d of days) {
    const launch = d.boardChg > 0 && d.boardChg >= d.indexChg // 收红(平盘不算)且不弱于指数
    const state: TempoState = launch ? 'launch' : 'adjust'
    const prev = out[out.length - 1]
    const dayN = prev && prev.state === state ? prev.dayN + 1 : 1
    const vr = d.volRatio
    const hasVol = vr !== undefined && Number.isFinite(vr)
    const tier: TempoTier = !launch ? 'adjust' : d.boardChg >= TEMPO.STRONG_PCT || (hasVol && vr >= TEMPO.VOL_UP) ? 'strong' : 'weak'
    const qualifiers: TempoQualifier[] = []
    if (launch && d.boardChg - d.indexChg >= TEMPO.EXCESS_PCT) qualifiers.push('aboveIndex')
    if (!launch && d.boardChg > d.indexChg) qualifiers.push('resilient') // 调整日逆势抗跌(绿格单标)
    if (hasVol && vr >= TEMPO.VOL_UP) qualifiers.push('volUp')
    if (hasVol && vr <= TEMPO.VOL_DOWN) qualifiers.push('volDown')
    out.push({ date: d.date, state, dayN, tier, chg: tempoR2(d.boardChg), qualifiers })
  }
  return out
}

/** 近 window 日发酵度(行排序用):strong=2 / weak=1 / 抗跌调整=0.5 / 其余=0,按 (i+1)/window 线性加权(越近权重越大)。 */
export function tempoHeat(cells: TempoCell[], window: number = TEMPO.WINDOW): number {
  const tail = cells.slice(-window)
  let heat = 0
  for (let i = 0; i < tail.length; i++) {
    const c = tail[i]
    const base = c.tier === 'strong' ? 2 : c.tier === 'weak' ? 1 : c.qualifiers.includes('resilient') ? 0.5 : 0
    heat += base * ((i + 1) / window)
  }
  return tempoR2(heat)
}

/** 近 window 日是否出现过强启动(默认行集合「活跃板块」的过滤条件)。 */
export function hasStrongLaunch(cells: TempoCell[], window: number = TEMPO.WINDOW): boolean {
  return cells.slice(-window).some((c) => c.tier === 'strong')
}

/** 某板块「截至 dateIdx(含)」的强弱:把 closes 切到 [0..dateIdx] 再算长/短窗象限。
 *  供选股加分 + 回测(切片到信号日,避免前视)。closes 升序;数据不足返回 null。
 *  strong = 短窗为正(近 shortWin 日在涨)= 轮动顺风(对应象限 hs/ls)。
 *  score01:象限映射的 0..1 加分(hs 强势延续最高,lw 持续走弱最低),叠加短窗幅度微调。 */
export function boardStrengthAsOf(
  closes: number[],
  dateIdx: number,
  longWin: number,
  shortWin: number,
): { quadrant: Quadrant; longChg: number; shortChg: number; strong: boolean; score01: number } | null {
  if (dateIdx < 0 || dateIdx >= closes.length) return null
  const slice = closes.slice(0, dateIdx + 1)
  const longChg = changeOverWindow(slice, longWin)
  const shortChg = changeOverWindow(slice, shortWin)
  if (Number.isNaN(longChg) || Number.isNaN(shortChg)) return null
  const quadrant = classifyQuadrant(longChg, shortChg)
  const base: Record<Quadrant, number> = { hs: 0.8, ls: 0.6, hw: 0.4, lw: 0.1 }
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
  // 同象限内按近 shortWin 日幅度微调 ±0.1:-10%→base-0.1、0%→base、+10%→base+0.1。
  const adj = clamp01((shortChg + 10) / 20) // 0..1,0% 居中 0.5
  const score01 = clamp01(base[quadrant] - 0.1 + 0.2 * adj)
  const round2 = (n: number) => Math.round(n * 100) / 100
  return { quadrant, longChg: round2(longChg), shortChg: round2(shortChg), strong: shortChg >= 0, score01: round2(score01) }
}
