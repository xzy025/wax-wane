// 趋势中军·监控清单(发现型视图,非战法) · 纯函数判定层(无网络,可单测,纯 OHLCV)。
//
// 与「趋势新高(第8战法 trendNewHighRules)」的关系:趋势新高是【买点信号】——收强≥0.4、追高 guard
// 收≤MA20×1.15、贴52周高≤5%(均经回测校准),故把已脱离 MA20 的强势龙头(京东方000725/士兰微600460)
// 挡在外。本清单是趋势新高的【放宽超集·纯监控】:同样要 完整多头排列 + 持续创新高 + 连续站上 MA5,
// 但【放宽收强/追高/贴高这些"买点质量"门槛】,让"正在持续创新高的趋势中军"在选股池里看得见。
//
// 【监控·非买点·未回测】——不产出 entry/stop/target 交易计划,只给监控指标(距52周高/持续新高次数/
// 连续站上MA5天数/距MA20偏离度/RS),按趋势强度排序。阈值见 config/screener.ts 的 TRENDWATCH。
import { TRENDWATCH, type TrendWatchConfig } from '../config/screener'
import { type Bar, smaAt, rsRaw, trendTemplate, r2, clamp01 } from './screenerRules'
import { consecutiveLimitUps } from './divergenceRules'


/** 自 endIdx 末尾回数,连续满足 close ≥ MA5(SMA5) 的天数(站上五日线的持续性)。 */
export function consecutiveAboveMA5(closes: number[], endIdx: number): number {
  let n = 0
  for (let i = endIdx; i >= 0; i--) {
    const ma5 = smaAt(closes, 5, i)
    if (ma5 > 0 && closes[i] >= ma5) n++
    else break
  }
  return n
}

export interface TrendLeaderCandidate {
  group: 'trendwatch'
  price: number // 信号日收盘
  changePct: number
  nhDays: number // 近 RECENT_WIN 日内创"近 NH_LOOKBACK 日新高"的天数(持续新高度)
  dist52Pct: number // 距 52 周高%:≤0 创/平新高,>0 在高点下方
  ma5HoldDays: number // 连续站上 MA5 天数
  extPct: number // 距 MA_REF(MA20)偏离%(追高/回踩观察,非买点)
  rs: number // 相对强度原值(rsRaw)
  maRef: number // MA20:结构参考/回踩位(非买点)
  closeStrength: number // (收−低)/(高−低),仅展示(本清单不卡收强)
  tier: number // 1-3(趋势质量分档)
  score: number // 0-100(趋势质量分,非买点质量)
  reason: string
  riskNote?: string // 偏离 MA20 过大时的追高提示
  relStrength?: number // 相对大盘强度(个股−指数 当日涨跌幅 pp);事后 enrichRelStrength 写入
  counterTrend?: boolean // 逆势强:大盘明显下跌日逆势收红
}

/**
 * 趋势中军识别(放宽买点门槛的监控清单,硬门槛 ①②③ + 软门槛 EXT/连板):
 * ① 完整多头排列(trendTemplate.pass:C>MA20>MA60>MA120>MA250、MA250 上行、距52周低≥25%、距52周高≤15%)。
 * ② 近期持续创新高:近 RECENT_WIN 根里 ≥MIN_NH_DAYS 根创"近 NH_LOOKBACK 根新高"(零前视,排除一次性脉冲)。
 * ③ 连续站上 MA5 ≥ MA5_HOLD_MIN 天(持续性,对应"连续N日站上五日线")。
 * 放宽:无收强门槛、无 5% 贴高硬卡(模板 15% 已够)、追高 guard 放宽到 EXT_MAX_PCT(只滤垂直顶)。
 * 软门槛:连板数 ≤ LIMITUP_MAX(剔除买不到的一字妖股)。不产出交易计划。
 */
export function classifyTrendLeader(bars: Bar[], code: string, C: TrendWatchConfig = TRENDWATCH): TrendLeaderCandidate | null {
  const n = bars.length
  if (n < C.MIN_BARS) return null
  const last = n - 1
  const today = bars[last]
  const prev = bars[last - 1]
  if (today.close <= 0 || prev.close <= 0) return null

  // ① 完整多头排列(趋势中军定义,复用趋势模板,顺带拿 52 周高)
  const tt = trendTemplate(bars)
  if (!tt || !tt.pass) return null
  const hi52 = tt.hi52

  // ② 近期持续创新高:窗内创"近 NH_LOOKBACK 根新高"的天数
  const highs = bars.map((b) => b.high)
  let nhDays = 0
  for (let j = last - C.RECENT_WIN + 1; j <= last; j++) {
    if (j - C.NH_LOOKBACK < 0) continue
    const priorHigh = Math.max(...highs.slice(j - C.NH_LOOKBACK, j)) // 不含 j,零前视
    if (highs[j] >= priorHigh) nhDays++
  }
  if (nhDays < C.MIN_NH_DAYS) return null

  // ③ 连续站上 MA5
  const closes = bars.map((b) => b.close)
  const ma5HoldDays = consecutiveAboveMA5(closes, last)
  if (ma5HoldDays < C.MA5_HOLD_MIN) return null

  // 追高 guard(宽松,只滤垂直顶)
  const maRef = smaAt(closes, C.MA_REF, last)
  if (maRef <= 0) return null
  const extPct = (today.close / maRef - 1) * 100
  if (extPct > C.EXT_MAX_PCT) return null

  // 软门槛:连板妖股(买不到)
  if (consecutiveLimitUps(bars, last, code) > C.LIMITUP_MAX) return null

  // ── 监控指标(无买点计划)──
  const range = today.high - today.low
  const closeStrength = range > 0 ? (today.close - today.low) / range : 1
  const changePct = (today.close / prev.close - 1) * 100
  const dist52Pct = (today.close / hi52 - 1) * 100
  const rs = rsRaw(closes)

  // ── 趋势质量打分 / 分档(非买点质量)──
  const W = C.WEIGHTS
  const nh01 = clamp01(nhDays / (C.RECENT_WIN * 0.5)) // 窗内半数日创新高→满分
  const rs01 = clamp01(rs / 0.5) // 加权年化 +50% → 满分
  const ma5hold01 = clamp01(ma5HoldDays / (C.RECENT_WIN * 0.5)) // 连续站上 MA5 半窗→满分
  const distHighPct = Math.max(0, ((hi52 - today.close) / hi52) * 100)
  const near01 = clamp01(1 - distHighPct / 15) // 距 52 周高(模板 15% 带内)越贴越高
  const score01 = (W.rs * rs01 + W.nh * nh01 + W.ma5hold * ma5hold01 + W.near * near01) / (W.rs + W.nh + W.ma5hold + W.near)
  const tier = score01 >= 0.6 ? 3 : score01 >= 0.4 ? 2 : 1

  const newHighToday = dist52Pct >= -0.05
  const reason = `多头排列·近${C.RECENT_WIN}日${nhDays}次创新高·连续站上MA5 ${ma5HoldDays}日·${newHighToday ? '今日创/平新高' : `距52周高${r2(distHighPct)}%`}`
  const riskNote = extPct > 20 ? `偏离 MA${C.MA_REF} ${r2(extPct)}%·追高风险` : undefined

  return {
    group: 'trendwatch',
    price: r2(today.close),
    changePct: r2(changePct),
    nhDays,
    dist52Pct: r2(dist52Pct),
    ma5HoldDays,
    extPct: r2(extPct),
    rs: r2(rs),
    maRef: r2(maRef),
    closeStrength: r2(closeStrength),
    tier,
    score: Math.round(score01 * 100),
    reason,
    riskNote,
  }
}
