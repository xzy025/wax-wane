// 资金流共振·机构调研 · 纯函数判定层(无网络,可单测)。
// 「杭州高手」量化短线的**可回测子集**:用纯 OHLCV 的「放量 + 短期多头强势」代理"资金涌入"
// (主力净流入排名∩成交量排名 —— 真排名东财不给免费历史,故代理),叠加可回溯的「机构近 N 日调研」
// 事件(surveyOrgs 由调用方按信号日窗口算好传入,保持本函数纯净可单测)。
// 入场=信号日收盘(EOD,与其他战法一致),短持有(HOLD≈3 日)。阈值见 config/screener.ts 的 FUNDRES。
// ⚠ 主力净流入(f62)这条真因子只在实盘 live 跑(env 门控,见 services/fundFlow);此处验证的是代理子集。
//
// 全部只读信号日及之前的 K 线 + 截至信号日的调研家数,零前视。
import { FUNDRES, type FundResConfig } from '../config/screener'
import { type Bar, mean, smaAt, r2, clamp01 } from './screenerRules'
import { consecutiveLimitUps } from './divergenceRules'


export interface FundResCandidate {
  group: 'fundres'
  price: number // 信号日收盘
  changePct: number
  ma5: number
  ma20: number
  volRatio: number // 今量 / 近 VOL_MA 日均量(成交量因子)
  mom: number // 近 MA_MID 日动量%
  surveyOrgs: number // 信号日前 SURVEY_LOOKBACK 日内调研机构家数
  gapUp: boolean // 信号日是否高开(今开 > 昨收)
  gapPct: number // 高开幅度%(今开/昨收−1)
  // 交易计划
  entry: number
  stop: number
  target: number
  riskReward: number
  holdHint: number // 建议持股交易日数(≈3)
  positionHint: string
  tier: number // 1-3
  score: number // 0-100
  reason: string
  riskNote?: string
}

/**
 * 资金流共振识别(全硬门槛,除可选 REQUIRE_GAP_UP / 软门槛 LIMITUP_MAX):
 * ① 短期多头强势:C>MA5>MA20 且 MA5 上行(资金推动上行 = 主力净流入的价格代理)。
 * ② 成交量因子(放量):今量 ≥ VOL_MULT×近 VOL_MA 日均量(资金涌入 = 净流入/成交量排名靠前的代理)。
 * ③ 机构调研确认:信号日前 SURVEY_LOOKBACK 日内被 ≥SURVEY_MIN_ORGS 家机构调研(图里"机构周调研前N")。
 * ④ 近 MA_MID 日动量 ≥ MOM_MIN_PCT;收盘强 ≥ CLOSE_STRENGTH;不过度追高(距 MA5 ≤ EXT_MAX_PCT)。
 * ⑤ 可选高开 + 软门槛连板数 ≤ LIMITUP_MAX。
 *
 * @param surveyOrgs 信号日前 SURVEY_LOOKBACK 日内调研机构家数(调用方算好;无调研数据传 0)。
 */
export function classifyFundResonance(
  bars: Bar[],
  code: string,
  surveyOrgs: number,
  C: FundResConfig = FUNDRES,
): FundResCandidate | null {
  const n = bars.length
  if (n < C.MIN_BARS) return null
  const last = n - 1
  const today = bars[last]
  const prev = bars[last - 1]
  if (prev.close <= 0 || today.close <= 0) return null

  const closes = bars.map((b) => b.close)
  const ma5 = smaAt(closes, C.MA_FAST, last)
  const ma20 = smaAt(closes, C.MA_MID, last)
  const ma5prev = smaAt(closes, C.MA_FAST, last - C.RISE_LOOKBACK)

  // ① 短期多头强势(资金推动上行)
  if (!(ma5 > 0 && ma20 > 0 && ma5prev > 0)) return null
  if (!(today.close > ma5 && ma5 > ma20)) return null
  if (!(ma5 > ma5prev)) return null // MA5 上行 → 排除下跌中继

  // ② 成交量因子:放量(资金涌入代理)
  const volBase = mean(bars.slice(Math.max(0, last - C.VOL_MA), last).map((b) => b.volume))
  if (volBase <= 0) return null
  const volRatio = today.volume / volBase
  if (volRatio < C.VOL_MULT) return null

  // ③ 机构调研确认(图里"机构周调研")。SURVEY_MIN_ORGS=0 时本条不约束(纯放量强势)。
  if (C.SURVEY_MIN_ORGS > 0 && surveyOrgs < C.SURVEY_MIN_ORGS) return null

  // ④ 短期动量 + 收盘强 + 不追高
  const refIdx = Math.max(0, last - C.MA_MID)
  const mom = bars[refIdx].close > 0 ? (today.close / bars[refIdx].close - 1) * 100 : 0
  if (mom < C.MOM_MIN_PCT) return null
  const range = today.high - today.low
  const closeStrong = range > 0 ? (today.close - today.low) / range : 1
  if (closeStrong < C.CLOSE_STRENGTH) return null
  const extAbovePct = (today.close / ma5 - 1) * 100
  if (extAbovePct > C.EXT_MAX_PCT) return null

  // ⑤ 高开(可选硬门槛)+ 连板软门槛
  const gapPct = (today.open / prev.close - 1) * 100
  const gapUp = gapPct > 0
  if (C.REQUIRE_GAP_UP && gapPct < C.GAP_MIN_PCT) return null
  if (consecutiveLimitUps(bars, last, code) > C.LIMITUP_MAX) return null

  // ── 交易计划(短线:止损较紧,目标 rmult,持有 ≈3 日)──
  const entry = today.close
  const stop = entry * (1 - C.STOP_MAX_PCT / 100)
  const risk = entry - stop
  if (risk <= 0) return null
  const target = entry + C.R_MULT * risk

  const changePct = (today.close / prev.close - 1) * 100

  // ── 打分 / 分档 ──
  const W = C.WEIGHTS
  const survey01 = clamp01(surveyOrgs / 5) // 5 家封顶
  const volRatio01 = clamp01((volRatio - C.VOL_MULT) / C.VOL_MULT) // VOL_MULT×→0, 2×VOL_MULT×→1
  const mom01 = clamp01(mom / 30) // 近 MA_MID 日 +30%→1
  const score01 =
    (W.survey * survey01 + W.volRatio * volRatio01 + W.mom * mom01 + W.closeStrong * clamp01(closeStrong)) /
    (W.survey + W.volRatio + W.mom + W.closeStrong)
  const tier = score01 >= 0.6 ? 3 : score01 >= 0.4 ? 2 : 1

  const surveyTxt = surveyOrgs > 0 ? `近${C.SURVEY_LOOKBACK}日${surveyOrgs}家机构调研·` : ''
  const reason = `${surveyTxt}放量${r2(volRatio)}×·C>MA5>MA20·近${C.MA_MID}日+${r2(mom)}%${gapUp ? `·高开${r2(gapPct)}%` : ''}`
  const riskNote =
    extAbovePct > C.EXT_MAX_PCT * 0.75
      ? '已偏离MA5较远·临界追高'
      : surveyOrgs === 0 && C.SURVEY_MIN_ORGS === 0
        ? '无机构调研背书·纯放量强势'
        : undefined

  return {
    group: 'fundres',
    price: r2(today.close),
    changePct: r2(changePct),
    ma5: r2(ma5),
    ma20: r2(ma20),
    volRatio: r2(volRatio),
    mom: r2(mom),
    surveyOrgs,
    gapUp,
    gapPct: r2(gapPct),
    entry: r2(entry),
    stop: r2(stop),
    target: r2(target),
    riskReward: r2(C.R_MULT),
    holdHint: C.HOLD,
    positionHint: tier >= 3 ? '试错仓 1/3(放量持续可加)' : '试错仓 1/4',
    tier,
    score: Math.round(score01 * 100),
    reason,
    riskNote,
  }
}
