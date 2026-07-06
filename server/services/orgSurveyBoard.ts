// 机构调研榜(纯排行·非战法·非买点·未回测)——独立于 FUNDRES 战法对机构调研因子的内部用法。
// 近 N 个交易日全市场机构调研聚合(fetchRecentOrgSurvey),按机构家数降序取前 MAX,叠加名称/现价展示。
import { createCache, sessionTtl } from '../lib/cache'
import { fetchRecentOrgSurvey, surveyWindowStart, type OrgSurveyAgg } from './orgSurvey'
import { fetchQuotesByCodes, type IndexQuote } from './emQuotes'
import { fetchFundFlowForCodes } from './fundFlow'
import { ORG_SURVEY_BOARD } from '../config/screener'

const QUOTE_CHUNK = 100 // fetchQuotesByCodes 无内置分块,仿 fundFlow.ts 的 ULIST_CHUNK 自行分块

export interface OrgSurveyBoardRow {
  code: string
  name: string
  price: number
  changePct: number
  orgs: number
  surveyDays: number
  latestDate: string
  netInflow?: number // 当日主力净流入(元,best-effort;FUNDRES_FUNDFLOW=0 或取数失败 → 前端显示 —)
}

/** 纯函数,可单测:按 orgs 降序(并列按 latestDate 新到旧)取前 max;quotes 查不到名称的 code 丢弃
 *  (不渲染空白行,好过展示一个没有名字的代码)。 */
export function rankOrgSurveyRows(
  agg: Map<string, OrgSurveyAgg>,
  quotes: Map<string, IndexQuote>,
  max = 40,
): OrgSurveyBoardRow[] {
  const rows: OrgSurveyBoardRow[] = []
  for (const [code, a] of agg) {
    const q = quotes.get(code)
    if (!q || !q.name) continue
    rows.push({ code, name: q.name, price: q.price, changePct: q.changePct, orgs: a.orgs, surveyDays: a.surveyDays, latestDate: a.latestDate })
  }
  return rows.sort((a, b) => b.orgs - a.orgs || (a.latestDate < b.latestDate ? 1 : a.latestDate > b.latestDate ? -1 : 0)).slice(0, max)
}

async function fetchFresh(): Promise<OrgSurveyBoardRow[]> {
  // 2026-07-06 修复:改用指数日线交易日历(surveyWindowStart)——旧 fetchTradingDates 只覆盖
  // 4~8 个交易日,「近20交易日」实际被 clamp 成 4~6 天,榜单窗口远窄于标称。
  const fromDate = await surveyWindowStart(ORG_SURVEY_BOARD.LOOKBACK_TRADING_DAYS)
  if (!fromDate) return []
  const agg = await fetchRecentOrgSurvey(fromDate)
  if (agg.size === 0) return []
  const codes = [...agg.keys()]
  const quotes = new Map<string, IndexQuote>()
  for (let i = 0; i < codes.length; i += QUOTE_CHUNK) {
    const chunk = codes.slice(i, i + QUOTE_CHUNK)
    for (const q of await fetchQuotesByCodes(chunk)) quotes.set(q.code, q)
  }
  const rows = rankOrgSurveyRows(agg, quotes, ORG_SURVEY_BOARD.MAX)
  // 净流入列(best-effort 叠加,同 lhb overlay 风格):排名不依赖净流入,只对入榜 ≤MAX 只取数;
  // FUNDRES_FUNDFLOW=0 时 fetchFundFlowForCodes 返回空 Map → 整列缺省,前端显示 '—'。
  try {
    const ff = await fetchFundFlowForCodes(rows.map((r) => r.code))
    return rows.map((r) => {
      const f = ff.get(r.code)
      return f?.netInflow != null ? { ...r, netInflow: f.netInflow } : r
    })
  } catch {
    return rows
  }
}

const boardCache = createCache<OrgSurveyBoardRow[]>({
  name: 'OrgSurveyBoard',
  ttl: sessionTtl(5 * 60_000, 30 * 60_000),
  fetcher: fetchFresh,
})

export function fetchOrgSurveyBoard(): Promise<OrgSurveyBoardRow[]> {
  return boardCache.get()
}

export function clearOrgSurveyBoardCache(): void {
  boardCache.clear()
}
