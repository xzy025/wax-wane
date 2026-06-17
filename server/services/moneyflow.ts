// 资金流跟踪：当日 / 3日 / 5日 三榜，全部「直接取数」——不再本地按日累计快照。
//   · 龙虎榜净买入：东财 datacenter RPT_DAILYBILLBOARD_DETAILSNEW 一次取最近多日（pageSize 大），
//     按响应里最近 1/3/5 个交易日在内存聚合 → 当日/3日/5日榜（上榜天数仍可真实统计）。
//   · 个股主力资金流：东财 push2 clist/get 换 fid 直接取窗口排名——今日 fid=f62、3日 f267、5日 f164
//     （与 akshare stock_individual_fund_flow_rank(indicator=...) 同源）。窗口榜只有净额合计，无「出现天数」。
// 好处：首次打开即全量、真实全市场窗口排名、零磁盘持久化、无冷启动。
import { EM_HEADERS } from '../lib/emHeaders'
import { createCache, sessionTtl } from '../lib/cache'

const TOP_N = 50 // 每榜保留前 N 只

// ── 数据结构 ─────────────────────────────────────────────

/** 龙虎榜一行（按个股聚合当日所有上榜记录后）。金额单位：元。 */
export interface LhbRow {
  code: string
  name: string
  close: number
  changePct: number
  turnover: number // 换手率 %
  netAmt: number // 龙虎榜净买入额（买-卖，元）
  buyAmt: number
  sellAmt: number
  reason: string // 上榜原因（多条用「;」连接）
  seat: string // 席位/机构说明
}

/** 个股主力资金流一行（今日榜）。金额单位：元。 */
export interface FundFlowRow {
  code: string
  name: string
  price: number
  changePct: number
  mainNet: number // 主力净流入额（元）
  mainNetPct: number // 主力净占比 %
  superNet: number // 超大单净额（元）
  bigNet: number // 大单净额（元）
}

/** 某个交易日的龙虎榜（已按个股聚合）。 */
export interface LhbDay {
  date: string // YYYY-MM-DD
  rows: LhbRow[]
}

/** 多日累计榜的一行。 */
export interface RankEntry {
  code: string
  name: string
  totalNet: number // 窗口内净额累计（元）
  days: number // 窗口内上榜天数（龙虎榜有效；主力资金流窗口为直接取数，置 0）
  latestChangePct: number // 龙虎榜=最近一日涨跌幅；资金流窗口=窗口区间涨跌幅
}

export interface MoneyFlowResult {
  tradeDate: string
  lhb: { today: LhbRow[]; d3: RankEntry[]; d5: RankEntry[] }
  fundFlow: { today: FundFlowRow[]; d3: RankEntry[]; d5: RankEntry[] }
  lastUpdated: string
}

// ── 纯函数（便于单测）─────────────────────────────────────

/** 把龙虎榜原始多条记录（同股可多次上榜）按个股聚合：金额累加、原因去重连接。 */
export function dedupeLhbByCode(
  rows: Array<{
    code: string
    name: string
    close: number
    changePct: number
    turnover: number
    netAmt: number
    buyAmt: number
    sellAmt: number
    reason: string
    seat: string
  }>,
): LhbRow[] {
  const byCode = new Map<string, LhbRow>()
  for (const r of rows) {
    const cur = byCode.get(r.code)
    if (!cur) {
      byCode.set(r.code, { ...r, reason: r.reason || '', seat: r.seat || '' })
    } else {
      cur.netAmt += r.netAmt
      cur.buyAmt += r.buyAmt
      cur.sellAmt += r.sellAmt
      if (r.reason && !cur.reason.includes(r.reason)) cur.reason = [cur.reason, r.reason].filter(Boolean).join('; ')
      if (r.seat && !cur.seat.includes(r.seat)) cur.seat = [cur.seat, r.seat].filter(Boolean).join('; ')
    }
  }
  return [...byCode.values()].sort((a, b) => b.netAmt - a.netAmt)
}

/** 东财龙虎榜原始多日记录 → 按交易日分组（降序，最近在前），每日内按个股聚合。 */
export function groupLhbByDate(data: any[]): LhbDay[] {
  const byDate = new Map<string, Parameters<typeof dedupeLhbByCode>[0]>()
  for (const d of data) {
    const date = String(d.TRADE_DATE).slice(0, 10)
    if (!date) continue
    const row = {
      code: d.SECURITY_CODE,
      name: d.SECURITY_NAME_ABBR,
      close: Number(d.CLOSE_PRICE) || 0,
      changePct: Number(d.CHANGE_RATE) || 0,
      turnover: Number(d.TURNOVERRATE) || 0,
      netAmt: Number(d.BILLBOARD_NET_AMT) || 0,
      buyAmt: Number(d.BILLBOARD_BUY_AMT) || 0,
      sellAmt: Number(d.BILLBOARD_SELL_AMT) || 0,
      reason: d.EXPLANATION ?? '',
      seat: d.EXPLAIN ?? '',
    }
    const arr = byDate.get(date)
    if (arr) arr.push(row)
    else byDate.set(date, [row])
  }
  return [...byDate.keys()]
    .sort((a, b) => (a < b ? 1 : -1)) // 降序
    .map((date) => ({ date, rows: dedupeLhbByCode(byDate.get(date)!) }))
}

/** 多日龙虎榜 → 累计净买入榜（按个股累加 netAmt，记上榜天数）。days 降序传入，最近在前。 */
export function aggregateLhb(days: LhbDay[]): RankEntry[] {
  return aggregate(
    days.map((d) => ({ date: d.date, rows: d.rows.map((r) => ({ code: r.code, name: r.name, net: r.netAmt, changePct: r.changePct })) })),
  )
}

/** 通用累加：snaps 已按日期降序传入（最近的在前），latestChangePct 取最近一日。 */
function aggregate(
  snaps: Array<{ date: string; rows: Array<{ code: string; name: string; net: number; changePct: number }> }>,
): RankEntry[] {
  const byCode = new Map<string, RankEntry>()
  for (const snap of snaps) {
    for (const r of snap.rows) {
      const cur = byCode.get(r.code)
      if (!cur) {
        // snaps 降序 → 首次见到即最近一日，记 latestChangePct。
        byCode.set(r.code, { code: r.code, name: r.name, totalNet: r.net, days: 1, latestChangePct: r.changePct })
      } else {
        cur.totalNet += r.net
        cur.days += 1
      }
    }
  }
  return [...byCode.values()].sort((a, b) => b.totalNet - a.totalNet)
}

/** 东财资金流窗口榜 diff → RankEntry[]（直接取数，days 置 0；按净额降序截 TOP_N）。 */
export function parseFundFlowWindow(diff: any[], netKey: string, chgKey: string): RankEntry[] {
  return diff
    .map((d) => ({
      code: String(d.f12 ?? ''),
      name: String(d.f14 ?? ''),
      totalNet: Number(d[netKey]) || 0,
      days: 0,
      latestChangePct: Number(d[chgKey]) || 0,
    }))
    .filter((r) => r.code)
    .sort((a, b) => b.totalNet - a.totalNet)
    .slice(0, TOP_N)
}

// ── 上游抓取 ─────────────────────────────────────────────

// 全 A 股主板/创业板/科创板/北交所市场过滤（与 akshare 资金流排行一致）。
const FUND_FS = 'm:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2'

/** 资金流窗口字段映射（东财 clist fid + 净额/涨跌幅字段，3日/5日各不同）。 */
const FUND_WINDOWS = {
  d3: { fid: 'f267', netKey: 'f267', chgKey: 'f127' }, // 3日主力净额 / 3日涨跌幅
  d5: { fid: 'f164', netKey: 'f164', chgKey: 'f109' }, // 5日主力净额 / 5日涨跌幅
} as const

/** 东财龙虎榜：一次取最近多日（pageSize 大），按交易日分组返回（降序）。 */
async function fetchLhbDays(): Promise<LhbDay[]> {
  try {
    const url =
      'http://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=TRADE_DATE,BILLBOARD_NET_AMT&sortTypes=-1,-1&pageSize=1000&pageNumber=1&reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,CLOSE_PRICE,CHANGE_RATE,TURNOVERRATE,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,BILLBOARD_NET_AMT,EXPLANATION,EXPLAIN&source=WEB&client=WEB'
    const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const json = (await res.json()) as any
    const data: any[] = json.result?.data ?? []
    if (!data.length) return []
    return groupLhbByDate(data)
  } catch (err) {
    console.warn('[MoneyFlow] LHB fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

/** 东财今日个股主力资金流排行（fid=f62 主力净流入，截前 TOP_N）。 */
async function fetchFundFlow(): Promise<FundFlowRow[]> {
  try {
    const url = `https://push2.eastmoney.com/api/qt/clist/get?fid=f62&po=1&pz=${TOP_N}&pn=1&np=1&fltt=2&invt=2&fs=${FUND_FS}&fields=f12,f14,f2,f3,f62,f184,f66,f72`
    const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const json = (await res.json()) as any
    const diff: any[] = json.data?.diff ?? []
    return diff.map((d) => ({
      code: d.f12,
      name: d.f14,
      price: Number(d.f2) || 0,
      changePct: Number(d.f3) || 0,
      mainNet: Number(d.f62) || 0,
      mainNetPct: Number(d.f184) || 0,
      superNet: Number(d.f66) || 0,
      bigNet: Number(d.f72) || 0,
    }))
  } catch (err) {
    console.warn('[MoneyFlow] fund-flow fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

/** 东财 N日个股主力资金流窗口排行（直接取数，返回累计榜）。 */
async function fetchFundFlowWindow(win: { fid: string; netKey: string; chgKey: string }): Promise<RankEntry[]> {
  try {
    const fields = `f12,f14,f2,${win.chgKey},${win.netKey}`
    const url = `https://push2.eastmoney.com/api/qt/clist/get?fid=${win.fid}&po=1&pz=${TOP_N}&pn=1&np=1&fltt=2&invt=2&fs=${FUND_FS}&fields=${fields}`
    const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const json = (await res.json()) as any
    const diff: any[] = json.data?.diff ?? []
    return parseFundFlowWindow(diff, win.netKey, win.chgKey)
  } catch (err) {
    console.warn('[MoneyFlow] fund-flow window fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

// ── 主流程 ───────────────────────────────────────────────

async function buildMoneyFlowFresh(): Promise<MoneyFlowResult> {
  const [lhbDays, fundToday, fund3, fund5] = await Promise.all([
    fetchLhbDays(),
    fetchFundFlow(),
    fetchFundFlowWindow(FUND_WINDOWS.d3),
    fetchFundFlowWindow(FUND_WINDOWS.d5),
  ])

  // 交易日以龙虎榜最近日期为准；龙虎榜不可达时退回今天（上海时区）。
  const date = lhbDays[0]?.date ?? shanghaiDateStr()
  const lhbToday = (lhbDays[0]?.rows ?? []).slice(0, TOP_N)

  return {
    tradeDate: date,
    lhb: {
      today: lhbToday,
      d3: aggregateLhb(lhbDays.slice(0, 3)).slice(0, TOP_N),
      d5: aggregateLhb(lhbDays.slice(0, 5)).slice(0, TOP_N),
    },
    fundFlow: { today: fundToday, d3: fund3, d5: fund5 },
    lastUpdated: new Date().toISOString(),
  }
}

/** 上海时区的当天 YYYY-MM-DD（UTC+8 固定偏移）。 */
function shanghaiDateStr(): string {
  const sh = new Date(Date.now() + 8 * 3600_000)
  return sh.toISOString().slice(0, 10)
}

const moneyFlowCache = createCache<MoneyFlowResult>({
  name: 'MoneyFlow',
  ttl: sessionTtl(60_000, 30 * 60_000),
  fetcher: buildMoneyFlowFresh,
})

/** GET /api/moneyflow — 缓存读取（直接取数，无快照依赖）。 */
export function fetchMoneyFlow(): Promise<MoneyFlowResult> {
  return moneyFlowCache.get()
}

export function clearMoneyFlowCache(): void {
  moneyFlowCache.clear()
}
