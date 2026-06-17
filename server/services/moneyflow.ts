// 资金流跟踪：每日抓取 龙虎榜净买入 + 个股主力资金流向 → 按交易日落盘(server/data/lhb/<date>.json)
// → 读最近 3/5 个交易日快照累加，产出 当日 / 3日 / 5日 三榜。
//
// 为什么按日 JSON 落盘（而非 PG）：后端常跑在 limited mode（无 PostgreSQL），JSON 文件零依赖、
// 抗重启、易聚合。无 cron：懒触发——首次请求当日数据时若快照缺失就现抓并落盘。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { EM_HEADERS } from '../lib/emHeaders'
import { createCache, sessionTtl } from '../lib/cache'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data', 'lhb')

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

/** 个股主力资金流一行。金额单位：元。 */
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

/** 落盘的单日快照。 */
export interface DailySnapshot {
  date: string // YYYY-MM-DD（交易日，取自龙虎榜 TRADE_DATE）
  fetchedAt: string // ISO 时间戳
  lhb: LhbRow[]
  fundFlow: FundFlowRow[]
}

/** 多日累计榜的一行。 */
export interface RankEntry {
  code: string
  name: string
  totalNet: number // 窗口内净额累计（元）
  days: number // 窗口内出现/上榜天数
  latestChangePct: number // 最近一日涨跌幅
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

/** 多日快照 → 龙虎榜累计净买入榜（按个股累加 netAmt，记上榜天数）。 */
export function aggregateLhb(snaps: DailySnapshot[]): RankEntry[] {
  return aggregate(
    snaps.map((s) => ({ date: s.date, rows: s.lhb.map((r) => ({ code: r.code, name: r.name, net: r.netAmt, changePct: r.changePct })) })),
  )
}

/** 多日快照 → 主力资金净流入累计榜（按个股累加 mainNet，记出现天数）。 */
export function aggregateFundFlow(snaps: DailySnapshot[]): RankEntry[] {
  return aggregate(
    snaps.map((s) => ({ date: s.date, rows: s.fundFlow.map((r) => ({ code: r.code, name: r.name, net: r.mainNet, changePct: r.changePct })) })),
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

// ── 上游抓取 ─────────────────────────────────────────────

/** 东财龙虎榜（取最近交易日全量，按个股聚合，截前 TOP_N）。返回 { date, rows } 或 null。 */
async function fetchLhb(): Promise<{ date: string; rows: LhbRow[] } | null> {
  try {
    const url =
      'http://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=TRADE_DATE,BILLBOARD_NET_AMT&sortTypes=-1,-1&pageSize=500&pageNumber=1&reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,CLOSE_PRICE,CHANGE_RATE,TURNOVERRATE,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,BILLBOARD_NET_AMT,EXPLANATION,EXPLAIN&source=WEB&client=WEB'
    const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const json = (await res.json()) as any
    const data: any[] = json.result?.data ?? []
    if (!data.length) return null

    const maxDate = String(data[0].TRADE_DATE).slice(0, 10) // 取最新交易日，过滤掉跨日的旧记录
    const sameDay = data.filter((d) => String(d.TRADE_DATE).slice(0, 10) === maxDate)
    const rows = dedupeLhbByCode(
      sameDay.map((d) => ({
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
      })),
    ).slice(0, TOP_N)
    return { date: maxDate, rows }
  } catch (err) {
    console.warn('[MoneyFlow] LHB fetch failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** 东财个股主力资金流排行（fid=f62 主力净流入，截前 TOP_N）。 */
async function fetchFundFlow(): Promise<FundFlowRow[]> {
  try {
    const fs = 'm:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2'
    const url = `https://push2.eastmoney.com/api/qt/clist/get?fid=f62&po=1&pz=${TOP_N}&pn=1&np=1&fltt=2&invt=2&fs=${fs}&fields=f12,f14,f2,f3,f62,f184,f66,f72`
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

// ── 落盘 / 读取 ─────────────────────────────────────────

function snapshotPath(date: string): string {
  return join(DATA_DIR, `${date}.json`)
}

function writeSnapshot(snap: DailySnapshot): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(snapshotPath(snap.date), JSON.stringify(snap), 'utf8')
  } catch (err) {
    console.warn('[MoneyFlow] snapshot write failed:', err instanceof Error ? err.message : err)
  }
}

/** 读最近 n 个交易日快照（按日期降序，最近在前）。 */
function readRecentSnapshots(n: number): DailySnapshot[] {
  if (!existsSync(DATA_DIR)) return []
  const dates = readdirSync(DATA_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort((a, b) => (a < b ? 1 : -1)) // 降序
    .slice(0, n)
  const out: DailySnapshot[] = []
  for (const date of dates) {
    try {
      out.push(JSON.parse(readFileSync(snapshotPath(date), 'utf8')) as DailySnapshot)
    } catch {
      // 损坏文件跳过
    }
  }
  return out
}

// ── 主流程 ───────────────────────────────────────────────

async function buildMoneyFlowFresh(): Promise<MoneyFlowResult> {
  const [lhbResult, fundFlow] = await Promise.all([fetchLhb(), fetchFundFlow()])

  // 交易日以龙虎榜 TRADE_DATE 为准；龙虎榜不可达时退回今天（上海时区）。
  const date = lhbResult?.date ?? shanghaiDateStr()
  const lhbToday = lhbResult?.rows ?? []

  // 至少一侧有数据才落盘（覆盖当日文件）；两侧皆空就不写，避免污染累计榜。
  if (lhbToday.length || fundFlow.length) {
    writeSnapshot({ date, fetchedAt: new Date().toISOString(), lhb: lhbToday, fundFlow })
  }

  const recent5 = readRecentSnapshots(5)
  const recent3 = recent5.slice(0, 3)

  return {
    tradeDate: date,
    lhb: {
      today: lhbToday,
      d3: aggregateLhb(recent3),
      d5: aggregateLhb(recent5),
    },
    fundFlow: {
      today: fundFlow,
      d3: aggregateFundFlow(recent3),
      d5: aggregateFundFlow(recent5),
    },
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

/** GET /api/moneyflow — 缓存读取（缺当日快照时懒触发抓取+落盘）。 */
export function fetchMoneyFlow(): Promise<MoneyFlowResult> {
  return moneyFlowCache.get()
}

export function clearMoneyFlowCache(): void {
  moneyFlowCache.clear()
}

/** POST /api/moneyflow/ingest — 强制现抓+落盘（供外部计划任务保底调用）。 */
export async function ingestMoneyFlow(): Promise<{ date: string; lhb: number; fundFlow: number }> {
  moneyFlowCache.clear()
  const r = await moneyFlowCache.get()
  return { date: r.tradeDate, lhb: r.lhb.today.length, fundFlow: r.fundFlow.today.length }
}
