// 机构调研历史/实时因子层 —— 把「近 N 日被机构密集调研」做成可注入选股 + 可历史回测的事件因子。
// 来源:东财 RPT_ORG_SURVEYNEW(每行一条「个股×接待机构」记录,RECEIVE_START_DATE=调研日)。
//   按 SECURITY_CODE 过滤可取单股全史(回测用);按日期过滤可取全市场近期(实盘 live 用)。
// 「机构家数」= 同窗口内 distinct 接待对象(剔除媒体/券商研报口径的明显非调研机构)。
// 纯聚合(countOrgsInRange / isInstitution)无网络,可单测。关联 [[screener-feature]]。
import { EM_HEADERS } from '../lib/emHeaders'
import { fetchIndexKline } from './ashare'
import { SCREENER } from '../config/screener'

const SURVEY_RPT = 'RPT_ORG_SURVEYNEW'
const PAGE_SIZE = 500
const MAX_PAGES = 12 // 单股/单次取数翻页上限(单股 ~600 条/数年 → 2 页足;全市场近一周 → 数页)

/** 一条调研记录:调研日(YYYY-MM-DD) + 接待机构名 + 披露日(公告挂网日,回测防前视用)。 */
export interface SurveyEvent {
  date: string
  org: string
  /** NOTICE_DATE:该记录对市场可见的日期。调研≠当天可知——实测披露滞后 1 天占 85%+,长尾可达 30 天+。 */
  noticeDate?: string
}

/** code → 调研事件(按日期升序)。 */
export type SurveyByCode = Map<string, SurveyEvent[]>

/** 某股近窗口的调研聚合(实盘展示/加分用)。 */
export interface OrgSurveyAgg {
  orgs: number // 窗口内 distinct 机构家数
  surveyDays: number // 窗口内有调研的不同交易日数
  latestDate: string // 最近一次调研日
}

/** 近 N 个交易日窗口的起始日(含最新交易日)——用大盘指数日线当交易日历。
 *  ⚠ 别再用 moneyflow.fetchTradingDates 算这个窗:它从龙虎榜明细取 distinct 日期(pageSize=800,
 *  每天几十上百行)只覆盖 ~4-8 个交易日,SURVEY_LOOKBACK=20 会被静默 clamp 成 4~6 天——
 *  2026-07-04 的「调研窗 5→20 复裁」在 live 侧因此从未真正生效(2026-07-06 修复)。
 *  失败回退日历天近似(N×1.5,吃掉周末;节假日误差可接受,best-effort 语义)。 */
export async function surveyWindowStart(lookback: number): Promise<string> {
  try {
    const bars = await fetchIndexKline(SCREENER.MARKET_INDEX_SECID, lookback + 5)
    const dates = bars.map((b) => b.date).filter(Boolean)
    if (dates.length) return dates[Math.max(0, dates.length - lookback)]
  } catch {
    /* 走日历天回退 */
  }
  return new Date(Date.now() - Math.round(lookback * 1.5) * 86_400_000).toISOString().slice(0, 10)
}

// 接待对象里混入媒体/通讯社,非真正"机构调研",计家数时剔除(图里语义=买方/卖方机构)。
const MEDIA_BLOCKLIST = ['报', '电视', '广播', '通讯社', '日报', '时报', '财经网', '网', '杂志', '传媒']

/** 是否计为"机构"(剔除明显媒体)。空字符串不计。 */
export function isInstitution(org: string): boolean {
  const s = org.trim()
  if (!s) return false
  return !MEDIA_BLOCKLIST.some((b) => s.includes(b))
}

/** 窗口 [startDate, endDate](含端点,YYYY-MM-DD)内 distinct 机构家数(剔除媒体)。events 无需有序。
 *  knownBy(回测防前视):只计披露日 ≤ knownBy 的记录——调研发生了但公告还没挂网的,信号日实盘查不到,
 *  回测也不许看。缺 noticeDate 的记录退回按调研日判断(与 live 语义一致)。live 路径不传则不过滤。 */
export function countOrgsInRange(events: SurveyEvent[], startDate: string, endDate: string, knownBy?: string): number {
  const set = new Set<string>()
  for (const e of events) {
    if (e.date < startDate || e.date > endDate) continue
    if (knownBy !== undefined && (e.noticeDate ?? e.date) > knownBy) continue
    if (isInstitution(e.org)) set.add(e.org)
  }
  return set.size
}

/** 把扁平调研事件聚合成 OrgSurveyAgg(窗口已在取数侧用日期过滤好)。 */
export function aggregateSurvey(events: SurveyEvent[]): OrgSurveyAgg {
  const orgs = new Set<string>()
  const days = new Set<string>()
  let latest = ''
  for (const e of events) {
    if (isInstitution(e.org)) orgs.add(e.org)
    days.add(e.date)
    if (e.date > latest) latest = e.date
  }
  return { orgs: orgs.size, surveyDays: days.size, latestDate: latest }
}

const norm = (d: unknown): string => String(d ?? '').slice(0, 10)

/** 取一页调研记录(filter 已 URL-encode 前的原串,内部负责编码)。 */
async function fetchSurveyPage(filter: string, pageNumber: number): Promise<{ rows: SurveyEvent[]; pages: number }> {
  const url =
    `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${SURVEY_RPT}` +
    `&columns=SECURITY_CODE,RECEIVE_START_DATE,NOTICE_DATE,RECEIVE_OBJECT&source=WEB&client=WEB` +
    `&sortColumns=RECEIVE_START_DATE&sortTypes=-1&pageSize=${PAGE_SIZE}&pageNumber=${pageNumber}` +
    `&filter=${encodeURIComponent(filter)}`
  const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`OrgSurvey HTTP ${res.status}`)
  const json = (await res.json()) as any
  const data: any[] = json?.result?.data ?? []
  const pages = Number(json?.result?.pages) || 1
  const rows: SurveyEvent[] = data.map((d) => ({
    date: norm(d.RECEIVE_START_DATE),
    org: String(d.RECEIVE_OBJECT ?? ''),
    ...(d.NOTICE_DATE ? { noticeDate: norm(d.NOTICE_DATE) } : {}),
  }))
  return { rows, pages }
}

/** 翻页取全部(到 pages 或 MAX_PAGES 上限);任一页失败则返回已取到的,优雅降级。 */
async function fetchAllPages(filter: string): Promise<SurveyEvent[]> {
  const out: SurveyEvent[] = []
  let page = 1
  while (page <= MAX_PAGES) {
    let result: { rows: SurveyEvent[]; pages: number }
    try {
      result = await fetchSurveyPage(filter, page)
    } catch (err) {
      console.warn(`[OrgSurvey] 第 ${page} 页取数失败,用已取 ${out.length} 条继续:`, err instanceof Error ? err.message : err)
      break
    }
    out.push(...result.rows)
    if (result.rows.length === 0 || page >= result.pages) break
    page++
  }
  return out
}

/** 单股调研全史(fromDate 给定则只取 ≥ 该日,降低翻页量)。回测用。 */
export async function fetchOrgSurveyHistory(code: string, fromDate?: string): Promise<SurveyEvent[]> {
  const filter = fromDate
    ? `(SECURITY_CODE="${code}")(RECEIVE_START_DATE>='${fromDate}')`
    : `(SECURITY_CODE="${code}")`
  return fetchAllPages(filter)
}

// 全市场近期调研按 fromDate 缓存(实盘 live 用;同日多次扫描复用)。
interface RecentEntry {
  data: Map<string, OrgSurveyAgg>
  expires: number
}
const recentCache = new Map<string, RecentEntry>()
const RECENT_TTL = 30 * 60_000

/** 全市场 ≥ fromDate 的调研,按 code 聚合成 OrgSurveyAgg。实盘 live 加分/选池用(env 门控)。 */
export async function fetchRecentOrgSurvey(fromDate: string): Promise<Map<string, OrgSurveyAgg>> {
  const hit = recentCache.get(fromDate)
  if (hit && hit.expires > Date.now()) return hit.data
  const filter = `(RECEIVE_START_DATE>='${fromDate}')`
  const url = (page: number) =>
    `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${SURVEY_RPT}` +
    `&columns=SECURITY_CODE,RECEIVE_START_DATE,RECEIVE_OBJECT&source=WEB&client=WEB` +
    `&sortColumns=RECEIVE_START_DATE&sortTypes=-1&pageSize=${PAGE_SIZE}&pageNumber=${page}&filter=${encodeURIComponent(filter)}`
  // 边取边按 code 累积事件,最后聚合。
  // 翻页上限单列(≠单股史的 MAX_PAGES):每行=个股×接待机构,全市场 20 交易日窗常见数万行,
  // 12 页(6000行)会把窗口静默截断回几天(降序取数→丢的全是窗口前段)。40 页仍截断时打日志。
  const RECENT_MAX_PAGES = 40
  const byCode = new Map<string, SurveyEvent[]>()
  let page = 1
  while (page <= RECENT_MAX_PAGES) {
    let json: any
    try {
      const res = await fetch(url(page), { headers: EM_HEADERS, signal: AbortSignal.timeout(12000) })
      if (!res.ok) break
      json = await res.json()
    } catch (err) {
      console.warn('[OrgSurvey] 近期调研取数失败(用已取继续):', err instanceof Error ? err.message : err)
      break
    }
    const data: any[] = json?.result?.data ?? []
    if (data.length === 0) break
    for (const d of data) {
      const code = String(d.SECURITY_CODE ?? '')
      if (!code) continue
      const ev = { date: norm(d.RECEIVE_START_DATE), org: String(d.RECEIVE_OBJECT ?? '') }
      const arr = byCode.get(code)
      if (arr) arr.push(ev)
      else byCode.set(code, [ev])
    }
    const totalPages = Number(json?.result?.pages) || 1
    if (page >= totalPages) break
    if (page === RECENT_MAX_PAGES) {
      console.warn(`[OrgSurvey] 近期调研翻页达上限 ${RECENT_MAX_PAGES}/${totalPages} 页,窗口前段被截断(fromDate=${fromDate})`)
      break
    }
    page++
  }

  const out = new Map<string, OrgSurveyAgg>()
  for (const [code, events] of byCode) out.set(code, aggregateSurvey(events))
  // 空结果不缓存:第 1 页就取数失败时 out 为空,缓存会让"机构调研"因子
  // 静默失效 30 分钟(近几日全市场调研真实为空的情况不存在)。
  if (out.size > 0) recentCache.set(fromDate, { data: out, expires: Date.now() + RECENT_TTL })
  return out
}

export function clearOrgSurveyCache(): void {
  recentCache.clear()
}
