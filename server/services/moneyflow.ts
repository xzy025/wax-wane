// 龙虎榜（Dragon-Tiger Board）—— 仿 连板天梯 设计。支持 当日(window=1) / 3日 / 5日 三种周期。
//   当日全部数据 = 3 类东财请求：
//     1) 主报表 RPT_DAILYBILLBOARD_DETAILSNEW（按日期取，按个股聚合）→ 净买入/成交额/上榜原因
//     2) 营业部明细 RPT_BILLBOARD_DAILYDETAILS{BUY,SELL}（各一次取全市场当日 ~510 行）→ 主要买/卖营业部
//     3) 逐股 push2 slist/get（spt=3，个股所属板块）→ 概念标签（过滤掉风格/统计板，并发 8）
//   3日/5日：取「截至所选日期的最近 N 个交易日」各日主报表，按个股累计净额 + 上榜天数 + 营业部（跨窗口同营业部累加金额取 top N）。
//   结果组织为「主力在买什么(净流入) / 主力在卖什么(净流出)」两列卡片 + 4 个汇总 + 概念计数。
//   按 交易日×窗口 缓存：历史日期不可变长缓存，当日短缓存。概念另按 code 缓存（跨日期/窗口复用）。
import { EM_HEADERS } from '../lib/emHeaders'
import { emFetch } from '../lib/emFetch'
import { toSecids } from './emQuotes'
import { classifySeat } from '../config/hotMoneySeats'

const TOP_SEATS = 3 // 每只票主要买/卖营业部保留前 N
const MAX_CONCEPTS = 3 // 每只票概念标签保留前 N
const CONCEPT_CONCURRENCY = 8 // 逐股概念抓取并发上限

// ── 数据结构 ─────────────────────────────────────────────

/** 营业部一行：名称 + 当日买入或卖出金额（元）。 */
export interface Seat {
  name: string
  amount: number
}

/** 龙虎榜个股一行（已按个股聚合 + 营业部 + 概念）。金额单位：元。 */
export interface LhbStock {
  code: string
  name: string
  close: number
  changePct: number
  netAmt: number // 龙虎榜净买入额（买-卖）
  buyAmt: number
  sellAmt: number
  dealAmt: number // 龙虎榜成交额（买+卖）= 参考站「成交金额」
  days: number // 上榜天数（当日=1；窗口=窗口内上榜次数）
  reason: string // 上榜原因（多条用「;」连接）
  concepts: string[] // 概念标签（过滤后 ≤ MAX_CONCEPTS）
  buySeats: Seat[] // 主要买入营业部（按买入额降序 top N）
  sellSeats: Seat[] // 主要卖出营业部（按卖出额降序 top N）
}

export interface DragonTigerSummary {
  inflowCount: number // 净流入股票数
  outflowCount: number // 净流出股票数
  totalInflow: number // 总净流入额（元）
  totalOutflow: number // 总净流出额（元，正数）
}

export interface ConceptTally {
  name: string
  count: number
}

export interface DragonTigerResult {
  tradeDate: string // YYYY-MM-DD
  buy: LhbStock[] // 净流入（netAmt>0），按净额降序
  sell: LhbStock[] // 净流出（netAmt<0），按净额升序（最负在前）
  summary: DragonTigerSummary
  concepts: ConceptTally[] // 概念 → 出现次数，供筛选 chips（按次数降序）
  lastUpdated: string
}

/** 主报表聚合前的单行（个股可多次上榜，对应多条原因）。 */
interface RawLhbRow {
  code: string
  name: string
  close: number
  changePct: number
  buyAmt: number
  sellAmt: number
  netAmt: number
  reason: string
}

// ── 纯函数（便于单测）─────────────────────────────────────

/** 聚合后的个股核心字段（不含 days/concepts/seats，由各 build 路径补全）。 */
type LhbCore = Omit<LhbStock, 'days' | 'concepts' | 'buySeats' | 'sellSeats'>
/** 带 days 的聚合个股（窗口聚合产物）。 */
type LhbWithDays = Omit<LhbStock, 'concepts' | 'buySeats' | 'sellSeats'>

/** 把同股多条上榜记录按个股聚合：金额累加、原因去重连接、dealAmt=buy+sell。按净额降序。 */
export function dedupeLhbByCode(rows: RawLhbRow[]): LhbCore[] {
  const byCode = new Map<string, LhbCore>()
  for (const r of rows) {
    const cur = byCode.get(r.code)
    if (!cur) {
      byCode.set(r.code, {
        code: r.code,
        name: r.name,
        close: r.close,
        changePct: r.changePct,
        buyAmt: r.buyAmt,
        sellAmt: r.sellAmt,
        netAmt: r.netAmt,
        dealAmt: r.buyAmt + r.sellAmt,
        reason: r.reason || '',
      })
    } else {
      cur.buyAmt += r.buyAmt
      cur.sellAmt += r.sellAmt
      cur.netAmt += r.netAmt
      cur.dealAmt = cur.buyAmt + cur.sellAmt
      if (r.reason && !cur.reason.includes(r.reason)) cur.reason = [cur.reason, r.reason].filter(Boolean).join('; ')
    }
  }
  return [...byCode.values()].sort((a, b) => b.netAmt - a.netAmt)
}

/**
 * 多日龙虎榜累计（3日/5日榜）。`days` 按交易日降序传入（最近在前），每日已按个股聚合。
 * 按个股累加 net/buy/sell（dealAmt=Σ买+卖）、计上榜天数；close/changePct/reason 取最近一日。按净额降序。
 */
export function aggregateWindow(days: Array<{ date: string; rows: LhbCore[] }>): LhbWithDays[] {
  const byCode = new Map<string, LhbWithDays>()
  for (const day of days) {
    // days 降序 → 首次见到即最近一日，记 close/changePct/reason。
    for (const r of day.rows) {
      const cur = byCode.get(r.code)
      if (!cur) {
        byCode.set(r.code, {
          code: r.code,
          name: r.name,
          close: r.close,
          changePct: r.changePct,
          buyAmt: r.buyAmt,
          sellAmt: r.sellAmt,
          netAmt: r.netAmt,
          dealAmt: r.buyAmt + r.sellAmt,
          days: 1,
          reason: r.reason || '',
        })
      } else {
        cur.buyAmt += r.buyAmt
        cur.sellAmt += r.sellAmt
        cur.netAmt += r.netAmt
        cur.dealAmt = cur.buyAmt + cur.sellAmt
        cur.days += 1
        if (r.reason && !cur.reason.includes(r.reason)) cur.reason = [cur.reason, r.reason].filter(Boolean).join('; ')
      }
    }
  }
  return [...byCode.values()].sort((a, b) => b.netAmt - a.netAmt)
}

/** 营业部明细原始行 → Map<code, Seat[]>（同营业部累加金额，按金额降序取 top N）。 */
export function groupSeatsByCode(
  rows: Array<{ code: string; name: string; amount: number }>,
  topN = TOP_SEATS,
): Map<string, Seat[]> {
  const byCode = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (!r.code || !r.name) continue
    let seats = byCode.get(r.code)
    if (!seats) {
      seats = new Map()
      byCode.set(r.code, seats)
    }
    seats.set(r.name, (seats.get(r.name) ?? 0) + r.amount)
  }
  const out = new Map<string, Seat[]>()
  for (const [code, seats] of byCode) {
    out.set(
      code,
      [...seats.entries()]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, topN),
    )
  }
  return out
}

// 东财个股所属板块里混入大量 资金属性/风格/盘口统计/财报 板，非真正「概念」。命中任一子串即剔除。
// 板块轮动(rotation.ts)复用此表过滤"非真实行业/概念"的板块宇宙。
export const CONCEPT_BLOCKLIST = [
  // 资金/制度属性
  '融资融券',
  '转融券',
  '沪股通',
  '深股通',
  '标准普尔',
  'MSCI',
  '富时',
  '机构重仓',
  '基金重仓',
  '社保重仓',
  'QFII',
  '券商',
  '转债标的',
  '含H股',
  '含B股',
  'AB股',
  '注册制',
  '专精特新', // 政策资质而非行业概念（可按需移出）
  // 指数成分伪概念(HS300_/上证50_/深成500/中证500 等指数会员板块,非可交易题材;
  // 2026-07-10 节奏表实测 HS300_/深成500 混进活跃行后补)
  'HS300',
  '上证50',
  '上证180',
  '上证380',
  '深成500',
  '中证500',
  '深证100',
  '央视50',
  // 风格/规模/价位
  '题材股',
  '风格',
  '大盘',
  '中盘',
  '小盘',
  '成长',
  '价值',
  '次新股',
  '百元股',
  '高价股',
  '低价股',
  // 盘口/统计（多以「昨日…」「趋势…」开头，及涨跌停/振幅/换手类）
  '昨日',
  '趋势',
  '涨停',
  '跌停',
  '连板',
  '多板',
  '振幅',
  '换手',
  '一字',
  '盘中',
  '早盘',
  '尾盘',
  '活跃',
  '人气',
  '热股',
  '创新高',
  '历史新高',
  '近期新高',
  '百日新高',
  '破发',
  'ST',
  // 财报/事件
  '年报',
  '中报',
  '季报',
  '业绩',
  '预盈预增',
  '预亏',
  '调研',
  '送转',
  '增持',
  '回购',
  '解禁',
  '股权激励',
]

/** 个股所属板块名列表 → 概念标签（过滤通用/风格/盘口板，保留前 N）。slist 按当日表现排序，过滤后取前列。 */
export function pickConcepts(boardNames: string[], max = MAX_CONCEPTS): string[] {
  const out: string[] = []
  for (const raw of boardNames) {
    // 归一化：去尾「概念」便于与同名行业板去重（如「小金属概念」→「小金属」）。
    const name = raw.trim().replace(/概念$/, '')
    if (!name) continue
    if (name.endsWith('板块')) continue // 地域板（广东板块/上海板块…）非概念
    if (CONCEPT_BLOCKLIST.some((b) => name.includes(b))) continue
    if (out.includes(name)) continue
    out.push(name)
    if (out.length >= max) break
  }
  return out
}

/** 4 个汇总指标（按净额正负分流入/流出）。 */
export function computeSummary(stocks: Pick<LhbStock, 'netAmt'>[]): DragonTigerSummary {
  let inflowCount = 0
  let outflowCount = 0
  let totalInflow = 0
  let totalOutflow = 0
  for (const s of stocks) {
    if (s.netAmt > 0) {
      inflowCount += 1
      totalInflow += s.netAmt
    } else if (s.netAmt < 0) {
      outflowCount += 1
      totalOutflow += -s.netAmt
    }
  }
  return { inflowCount, outflowCount, totalInflow, totalOutflow }
}

/** 全部个股概念 → 出现次数榜（降序）。 */
export function tallyConcepts(stocks: Pick<LhbStock, 'concepts'>[]): ConceptTally[] {
  const counts = new Map<string, number>()
  for (const s of stocks) {
    for (const c of s.concepts) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

// ── 并发工具 ─────────────────────────────────────────────

/** 受限并发 map：最多 limit 个 fn 同时在飞，保序返回。 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// ── 上游抓取 ─────────────────────────────────────────────

/** 东财龙虎榜主报表：给定日期取当日全部；缺省取最近交易日（响应里 max TRADE_DATE）。 */
async function fetchMainReport(date?: string): Promise<{ tradeDate: string; rows: RawLhbRow[] }> {
  const cols =
    'SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,CLOSE_PRICE,CHANGE_RATE,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,BILLBOARD_NET_AMT,EXPLANATION'
  const filter = date ? `&filter=(TRADE_DATE='${date}')` : ''
  const url =
    `http://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=TRADE_DATE,BILLBOARD_NET_AMT&sortTypes=-1,-1&pageSize=1000&pageNumber=1` +
    `&reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=${cols}&source=WEB&client=WEB${filter}`
  const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 8000 })
  if (!res.ok) throw new Error(`EastMoney LHB HTTP ${res.status}`)
  const json = (await res.json()) as any
  const data: any[] = json.result?.data ?? []
  if (!data.length) return { tradeDate: date ?? shanghaiDateStr(), rows: [] }
  // 缺省时只保留最近交易日（响应已按日期降序，首行即最近日）。
  const tradeDate = String(data[0].TRADE_DATE).slice(0, 10)
  const dayData = date ? data : data.filter((d) => String(d.TRADE_DATE).slice(0, 10) === tradeDate)
  const rows: RawLhbRow[] = dayData.map((d) => ({
    code: d.SECURITY_CODE,
    name: d.SECURITY_NAME_ABBR,
    close: Number(d.CLOSE_PRICE) || 0,
    changePct: Number(d.CHANGE_RATE) || 0,
    buyAmt: Number(d.BILLBOARD_BUY_AMT) || 0,
    sellAmt: Number(d.BILLBOARD_SELL_AMT) || 0,
    netAmt: Number(d.BILLBOARD_NET_AMT) || 0,
    reason: d.EXPLANATION ?? '',
  }))
  return { tradeDate, rows }
}

/** 营业部明细原始行（买/卖）：一次取当日全市场。供单日分组 + 多日窗口累计复用。 */
async function fetchSeatRows(
  date: string,
  side: 'BUY' | 'SELL',
): Promise<Array<{ code: string; name: string; amount: number }>> {
  try {
    const reportName = side === 'BUY' ? 'RPT_BILLBOARD_DAILYDETAILSBUY' : 'RPT_BILLBOARD_DAILYDETAILSSELL'
    const amountCol = side === 'BUY' ? 'BUY' : 'SELL'
    const url =
      `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${reportName}` +
      `&columns=SECURITY_CODE,OPERATEDEPT_NAME,${amountCol}&source=WEB&client=WEB&pageNumber=1&pageSize=2000` +
      `&filter=(TRADE_DATE='${date}')`
    const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 8000 })
    if (!res.ok) return []
    const json = (await res.json()) as any
    const data: any[] = json.result?.data ?? []
    return data.map((d) => ({ code: d.SECURITY_CODE, name: d.OPERATEDEPT_NAME, amount: Number(d[amountCol]) || 0 }))
  } catch (err) {
    console.warn(`[DragonTiger] ${side} seat fetch failed:`, err instanceof Error ? err.message : err)
    return []
  }
}

/** 营业部明细（买入或卖出）：一次取当日全市场，按个股分组返回 top 营业部。 */
async function fetchSeats(date: string, side: 'BUY' | 'SELL'): Promise<Map<string, Seat[]>> {
  return groupSeatsByCode(await fetchSeatRows(date, side))
}

/** 单只个股的概念标签：push2 slist 取所属板块（data.diff 为对象非数组），过滤后取前 N。 */
async function fetchConcepts(code: string): Promise<string[]> {
  try {
    const secid = toSecids(code)[0]
    if (!secid) return []
    const url =
      `https://push2.eastmoney.com/api/qt/slist/get?spt=3&fltt=2&invt=2&fid=f3&po=1&pn=1&pz=100` +
      `&secid=${secid}&fields=f12,f14`
    const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 6000 })
    if (!res.ok) return []
    const json = (await res.json()) as any
    const diff = json.data?.diff
    const arr: any[] = diff ? (Array.isArray(diff) ? diff : Object.values(diff)) : []
    return pickConcepts(arr.map((d) => String(d.f14 ?? '')))
  } catch {
    return []
  }
}

// 概念按 code 缓存（成员相对稳定）：跨日期/窗口复用，避免重复 slist 抓取。
interface ConceptEntry {
  concepts: string[]
  expires: number
}
const conceptCache = new Map<string, ConceptEntry>()
const CONCEPT_TTL = 12 * 3600_000

async function fetchConceptsCached(code: string): Promise<string[]> {
  const hit = conceptCache.get(code)
  if (hit && hit.expires > Date.now()) return hit.concepts
  const concepts = await fetchConcepts(code)
  // 空结果不缓存(同 rotation closesCache 的守卫):fetchConcepts 把限流/网络错误
  // 吞成 [],缓存空会让该股 12 小时无概念;真无概念的股重取一次代价可忽略。
  if (concepts.length > 0) conceptCache.set(code, { concepts, expires: Date.now() + CONCEPT_TTL })
  return concepts
}

// 交易日历缓存（按 upto 键）：供 N 日窗口取数 + 前端日历屏蔽非交易日。
interface DatesEntry {
  dates: string[]
  expires: number
}
const datesCache = new Map<string, DatesEntry>()
const DATES_TTL = 30 * 60_000

/** 最近交易日（降序）。`upto` 给定则只取 ≤ upto 的；distinct TRADE_DATE 即真实交易日（周末/节假日自动缺席）。 */
export async function fetchTradingDates(upto?: string): Promise<string[]> {
  const key = upto ?? 'latest'
  const hit = datesCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.dates
  try {
    const filter = upto ? `&filter=(TRADE_DATE<='${upto}')` : ''
    const url =
      `http://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=TRADE_DATE&sortTypes=-1&pageSize=800&pageNumber=1` +
      `&reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=TRADE_DATE&source=WEB&client=WEB${filter}`
    const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 8000 })
    if (!res.ok) return []
    const json = (await res.json()) as any
    const data: any[] = json.result?.data ?? []
    const dates = [...new Set(data.map((d) => String(d.TRADE_DATE).slice(0, 10)))].sort((a, b) => (a < b ? 1 : -1))
    // 空日历=上游异常(龙虎榜交易日不可能为空),不缓存,下次调用重试。
    if (dates.length > 0) datesCache.set(key, { dates, expires: Date.now() + DATES_TTL })
    return dates
  } catch (err) {
    console.warn('[DragonTiger] trading-dates fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

// ── 历史因子取数(供选股加分 + 回测，按日抓取，零展示逻辑) ────────────────

/** 某交易日龙虎榜「按个股聚合的净买入」精简行(无营业部/概念)。回测/因子用。 */
export async function fetchBillboardRows(date: string): Promise<Array<{ code: string; name: string; netAmt: number }>> {
  const main = await fetchMainReport(date)
  return dedupeLhbByCode(main.rows).map((s) => ({ code: s.code, name: s.name, netAmt: s.netAmt }))
}

/** 某交易日各类席位(机构专用 / 游资)的按个股净买入(买-卖)。
 *  注意:不能复用 fetchSeats(它按金额截 top3,机构/游资席位可能被截掉)——这里在截断前
 *  直接对每行席位按 classifySeat 分类(沪深股通=北向不计),按 code 汇总 机构 + 游资 两类。 */
export interface SeatNet {
  instBuy: number
  instSell: number
  instNet: number
  hotBuy: number
  hotSell: number
  hotNet: number
}

export async function fetchSeatNetByDate(date: string): Promise<Map<string, SeatNet>> {
  const out = new Map<string, SeatNet>()
  const sides: Array<{ side: 'BUY' | 'SELL'; report: string; col: 'BUY' | 'SELL' }> = [
    { side: 'BUY', report: 'RPT_BILLBOARD_DAILYDETAILSBUY', col: 'BUY' },
    { side: 'SELL', report: 'RPT_BILLBOARD_DAILYDETAILSSELL', col: 'SELL' },
  ]
  for (const { side, report, col } of sides) {
    try {
      const url =
        `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${report}` +
        `&columns=SECURITY_CODE,OPERATEDEPT_NAME,${col}&source=WEB&client=WEB&pageNumber=1&pageSize=2000` +
        `&filter=(TRADE_DATE='${date}')`
      const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 8000 })
      if (!res.ok) continue
      const json = (await res.json()) as any
      const data: any[] = json.result?.data ?? []
      for (const d of data) {
        const cls = classifySeat(String(d.OPERATEDEPT_NAME ?? ''))
        if (cls !== 'inst' && cls !== 'hot') continue // 普通营业部/北向 不计
        const code = String(d.SECURITY_CODE ?? '')
        if (!code) continue
        const amt = Number(d[col]) || 0
        const cur = out.get(code) ?? { instBuy: 0, instSell: 0, instNet: 0, hotBuy: 0, hotSell: 0, hotNet: 0 }
        if (cls === 'inst') {
          if (side === 'BUY') cur.instBuy += amt
          else cur.instSell += amt
          cur.instNet = cur.instBuy - cur.instSell
        } else {
          if (side === 'BUY') cur.hotBuy += amt
          else cur.hotSell += amt
          cur.hotNet = cur.hotBuy - cur.hotSell
        }
        out.set(code, cur)
      }
    } catch {
      /* 单边失败不致命,另一边照常 */
    }
  }
  return out
}

/** 兼容旧接口:仅机构专用净买(内部走 fetchSeatNetByDate)。 */
export async function fetchInstitutionalNetByDate(
  date: string,
): Promise<Map<string, { instBuy: number; instSell: number; instNet: number }>> {
  const full = await fetchSeatNetByDate(date)
  const out = new Map<string, { instBuy: number; instSell: number; instNet: number }>()
  for (const [code, s] of full) out.set(code, { instBuy: s.instBuy, instSell: s.instSell, instNet: s.instNet })
  return out
}

// ── 主流程 ───────────────────────────────────────────────

const WINDOW_TOP_N = 50 // 3日/5日榜每侧展示/抓概念上限（汇总仍用全量）

/** 给一批个股补上概念标签（按 code 缓存，受限并发）。 */
async function attachConcepts<T extends { code: string }>(stocks: T[]): Promise<(T & { concepts: string[] })[]> {
  const lists = await mapLimit(stocks, CONCEPT_CONCURRENCY, (s) => fetchConceptsCached(s.code))
  return stocks.map((s, i) => ({ ...s, concepts: lists[i] ?? [] }))
}

/** 当日榜（window=1）：含主要买/卖营业部 + 概念。 */
async function buildSingleDay(date?: string): Promise<DragonTigerResult> {
  const main = await fetchMainReport(date)
  const tradeDate = main.tradeDate
  const aggregated = dedupeLhbByCode(main.rows)

  const [buySeats, sellSeats, withConcepts] = await Promise.all([
    fetchSeats(tradeDate, 'BUY'),
    fetchSeats(tradeDate, 'SELL'),
    attachConcepts(aggregated),
  ])

  const stocks: LhbStock[] = withConcepts.map((s) => ({
    ...s,
    days: 1,
    buySeats: buySeats.get(s.code) ?? [],
    sellSeats: sellSeats.get(s.code) ?? [],
  }))

  return assemble(tradeDate, stocks, stocks)
}

/** N 日窗口榜（window=3/5）：累计净额 + 上榜天数 + 概念 + 营业部（窗口累计）。 */
async function buildWindow(date: string | undefined, window: number): Promise<DragonTigerResult> {
  const dates = (await fetchTradingDates(date)).slice(0, window)
  if (dates.length === 0) return emptyResult(date ?? shanghaiDateStr())

  const perDay = await Promise.all(dates.map((d) => fetchMainReport(d)))
  const aggregated = aggregateWindow(perDay.map((p) => ({ date: p.tradeDate, rows: dedupeLhbByCode(p.rows) })))

  // 汇总用全量；展示/抓概念每侧截 top N（5 日 unique 可能数百只）。
  const buyAll = aggregated.filter((s) => s.netAmt > 0)
  const sellAll = aggregated.filter((s) => s.netAmt < 0).sort((a, b) => a.netAmt - b.netAmt)
  const display = [...buyAll.slice(0, WINDOW_TOP_N), ...sellAll.slice(0, WINDOW_TOP_N)]
  const displayCodes = new Set(display.map((s) => s.code))

  // 营业部窗口累计:逐日取全市场买/卖席位原始行 → 只留展示个股 → 跨窗口同营业部累加金额取 top N。
  const [buyRowsDays, sellRowsDays, withConcepts] = await Promise.all([
    Promise.all(dates.map((d) => fetchSeatRows(d, 'BUY'))),
    Promise.all(dates.map((d) => fetchSeatRows(d, 'SELL'))),
    attachConcepts(display),
  ])
  const buySeatMap = groupSeatsByCode(buyRowsDays.flat().filter((r) => displayCodes.has(r.code)))
  const sellSeatMap = groupSeatsByCode(sellRowsDays.flat().filter((r) => displayCodes.has(r.code)))

  const stocks: LhbStock[] = withConcepts.map((s) => ({
    ...s,
    buySeats: buySeatMap.get(s.code) ?? [],
    sellSeats: sellSeatMap.get(s.code) ?? [],
  }))
  return assemble(dates[0], stocks, aggregated)
}

/** 把个股拆 买/卖 两列、算汇总与概念 chips。`summaryFrom` 用全量聚合（不受展示截断影响）。 */
function assemble(
  tradeDate: string,
  display: LhbStock[],
  summaryFrom: Pick<LhbStock, 'netAmt'>[],
): DragonTigerResult {
  const buy = display.filter((s) => s.netAmt > 0).sort((a, b) => b.netAmt - a.netAmt)
  const sell = display.filter((s) => s.netAmt < 0).sort((a, b) => a.netAmt - b.netAmt)
  return {
    tradeDate,
    buy,
    sell,
    summary: computeSummary(summaryFrom),
    concepts: tallyConcepts(display),
    lastUpdated: new Date().toISOString(),
  }
}

function emptyResult(tradeDate: string): DragonTigerResult {
  return {
    tradeDate,
    buy: [],
    sell: [],
    summary: { inflowCount: 0, outflowCount: 0, totalInflow: 0, totalOutflow: 0 },
    concepts: [],
    lastUpdated: new Date().toISOString(),
  }
}

function buildDragonTiger(date: string | undefined, window: number): Promise<DragonTigerResult> {
  return window > 1 ? buildWindow(date, window) : buildSingleDay(date)
}

/** 上海时区当天 YYYY-MM-DD（UTC+8 固定偏移）。 */
function shanghaiDateStr(): string {
  const sh = new Date(Date.now() + 8 * 3600_000)
  return sh.toISOString().slice(0, 10)
}

// ── 按交易日缓存 ─────────────────────────────────────────
// 'latest'（缺省日期）短缓存（榜单当日仍可能滚动/补录）；显式历史日期不可变，长缓存。

interface CacheEntry {
  data: DragonTigerResult
  expires: number
}
const cache = new Map<string, CacheEntry>()
const LATEST_TTL = 5 * 60_000
const HISTORICAL_TTL = 24 * 3600_000

/** GET /api/moneyflow?date=&window= —— 按 日期×窗口 缓存读取。 */
export async function fetchDragonTiger(date?: string, window = 1): Promise<DragonTigerResult> {
  const win = window === 3 || window === 5 ? window : 1
  const key = `${date ?? 'latest'}:${win}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.data
  const data = await buildDragonTiger(date, win)
  // 当日（缺省或解析出的交易日==今日）短缓存，历史长缓存。
  // 空榜不缓存:buildWindow 在交易日历取数失败时返回 emptyResult,若按历史
  // 长缓存(24h)存下,这个日期×窗口的榜单会整天空白;交易日真实榜单不会为空。
  if (data.buy.length + data.sell.length > 0) {
    const ttl = !date || data.tradeDate === shanghaiDateStr() ? LATEST_TTL : HISTORICAL_TTL
    cache.set(key, { data, expires: Date.now() + ttl })
  }
  return data
}

export function clearMoneyFlowCache(): void {
  cache.clear()
  conceptCache.clear()
  datesCache.clear()
}
