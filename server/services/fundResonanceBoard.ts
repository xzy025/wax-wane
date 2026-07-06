// 资金共振榜(Top10,纯排行·非战法·非买点·未回测)——与 FUNDRES 第6战法(classifyFundResonance)完全独立。
// 成交额前200 ∩ 主力净流入前200 的"共振"交集,按净流入金额降序取前10,叠加当日/近期龙虎榜数据(best-effort)。
import { createCache, sessionTtl } from '../lib/cache'
import { fetchInflowRankTop, fetchTurnoverRankTop, isFundFlowEnabled, type TurnoverRankEntry } from './fundFlow'
import { fetchDragonTiger, type Seat } from './moneyflow'
import { fetchRecentOrgSurvey, surveyWindowStart } from './orgSurvey'
import { FUND_RESONANCE_BOARD, FUNDRES } from '../config/screener'

export interface FundResonanceBoardRow {
  code: string
  name: string
  price: number
  changePct: number
  netInflow: number
  netInflowPct: number
  turnoverRank: number
  inflowRank: number
  surveyOrgs?: number // 近 FUNDRES.SURVEY_LOOKBACK 交易日调研机构家数(best-effort,缺=前端显示 —)
  lhb?: { netAmt: number; buyAmt: number; sellAmt: number; buySeats: Seat[]; sellSeats: Seat[]; reason: string }
}

/** 纯函数,可单测:turnover-top-N ∩ inflow-top-N,按 netInflow 降序取前 topK。不修改传入的 Map。 */
export function buildResonanceRows(
  turnover: Map<string, TurnoverRankEntry>,
  inflowRank: Map<string, number>,
  topK = 10,
  surveyByCode?: Map<string, number>,
): Omit<FundResonanceBoardRow, 'lhb'>[] {
  const rows: Omit<FundResonanceBoardRow, 'lhb'>[] = []
  for (const [code, t] of turnover) {
    const inRank = inflowRank.get(code)
    if (inRank == null) continue // 未进净流入前N → 不算"共振"
    rows.push({
      code, name: t.name, price: t.price, changePct: t.changePct,
      netInflow: t.netInflow, netInflowPct: t.netInflowPct,
      turnoverRank: t.rank, inflowRank: inRank,
      surveyOrgs: surveyByCode?.get(code),
    })
  }
  return rows.sort((a, b) => b.netInflow - a.netInflow).slice(0, topK)
}

/** 调研数量列数据:近 SURVEY_LOOKBACK 交易日 code→distinct 机构家数。窗口与 FundResCard 的
 *  surveyOrgs 同口径(FUNDRES.SURVEY_LOOKBACK);fetchRecentOrgSurvey 内置 30min 缓存,与机构调研榜共享。 */
async function resolveSurveyOrgs(): Promise<Map<string, number> | undefined> {
  const fromDate = await surveyWindowStart(FUNDRES.SURVEY_LOOKBACK) // 指数日线交易日历(勿用 fetchTradingDates,只有4~8天)
  if (!fromDate) return undefined
  const agg = await fetchRecentOrgSurvey(fromDate)
  const m = new Map<string, number>()
  for (const [code, a] of agg) m.set(code, a.orgs)
  return m
}

async function fetchFresh(): Promise<FundResonanceBoardRow[]> {
  if (!isFundFlowEnabled()) return [] // 整个"共振"概念依赖净流入数据,门控关闭时直接空
  const [turnover, inflowRank, surveyByCode] = await Promise.all([
    fetchTurnoverRankTop(FUND_RESONANCE_BOARD.TOPN),
    fetchInflowRankTop(FUND_RESONANCE_BOARD.TOPN),
    resolveSurveyOrgs().catch(() => undefined), // 调研列 best-effort,失败整列 '—'
  ])
  const base = buildResonanceRows(turnover, inflowRank, FUND_RESONANCE_BOARD.TOP_K, surveyByCode)
  if (base.length === 0) return base
  let lhbByCode = new Map<string, { netAmt: number; buyAmt: number; sellAmt: number; buySeats: Seat[]; sellSeats: Seat[]; reason: string }>()
  try {
    const dt = await fetchDragonTiger()
    lhbByCode = new Map(
      [...dt.buy, ...dt.sell].map((s) => [
        s.code,
        { netAmt: s.netAmt, buyAmt: s.buyAmt, sellAmt: s.sellAmt, buySeats: s.buySeats, sellSeats: s.sellSeats, reason: s.reason },
      ]),
    )
  } catch {
    /* 叠加best-effort,查不到不报错 */
  }
  return base.map((r) => {
    const lhb = lhbByCode.get(r.code)
    return lhb ? { ...r, lhb } : r
  })
}

const boardCache = createCache<FundResonanceBoardRow[]>({
  name: 'FundResonanceBoard',
  ttl: sessionTtl(5 * 60_000, 30 * 60_000),
  fetcher: fetchFresh,
})

export function fetchFundResonanceBoard(): Promise<FundResonanceBoardRow[]> {
  return boardCache.get()
}

export function clearFundResonanceBoardCache(): void {
  boardCache.clear()
}
