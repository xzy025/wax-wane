// 机构调研榜(纯排行·非战法·非买点·未回测)——独立于 FUNDRES 战法对机构调研因子的内部用法。
// 近 N 个交易日全市场机构调研聚合(fetchRecentOrgSurvey),按机构家数降序取前 MAX,叠加名称/现价展示。
import { createCache, sessionTtl } from '../lib/cache'
import { fetchRecentOrgSurvey, type OrgSurveyAgg } from './orgSurvey'
import { fetchTradingDates } from './moneyflow'
import { fetchQuotesByCodes, type IndexQuote } from './emQuotes'
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
  const dates = await fetchTradingDates() // 降序(最近在前)
  const idx = Math.min(ORG_SURVEY_BOARD.LOOKBACK_TRADING_DAYS - 1, dates.length - 1)
  const fromDate = idx >= 0 ? dates[idx] : ''
  if (!fromDate) return []
  const agg = await fetchRecentOrgSurvey(fromDate)
  if (agg.size === 0) return []
  const codes = [...agg.keys()]
  const quotes = new Map<string, IndexQuote>()
  for (let i = 0; i < codes.length; i += QUOTE_CHUNK) {
    const chunk = codes.slice(i, i + QUOTE_CHUNK)
    for (const q of await fetchQuotesByCodes(chunk)) quotes.set(q.code, q)
  }
  return rankOrgSurveyRows(agg, quotes, ORG_SURVEY_BOARD.MAX)
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
