// 限售解禁日历(a-stock-data 移植计划③)——东财 RPT_LIFT_STAGE,datacenter 纯 JSON GET 零签名。
// ⚠ 必须用新列名 FREE_SHARES_TYPE / ABLE_FREE_SHARES / FREE_RATIO(东财 2026 改列名,旧
//   LIMITED_STOCK_TYPE 族恒空)。实测量纲(2026-07-16 实抓):FREE_RATIO=解禁股占**流通股本**比
//   的小数(0.111=11.1%,比占总股本 TOTAL_RATIO 更贴真实抛压)——⚠可 >1:首发原股东解禁时
//   解禁股可达当前流通股本的数倍(实测 301499=300%,IPO 仅流通 25% 的正常结果,恰是最重抛压);
//   ABLE_FREE_SHARES=实际可流通解禁股数(万股);FREE_DATE 带 " 00:00:00" 需切 10 位。
// 取数姿势:按日期窗全市场一次拉(30 天窗实测仅 136 行=单页 500 就够),build code→批次,
//   给 screener enrich 批量挂「解禁」风险角标——纯展示,不进规则层不影响回测。
// 缓存:交易日窗 keyed(盘中 30min/盘后 12h);空结果不缓存(防空档毒化,仓库既有惯例)。
import { EM_HEADERS } from '../lib/emHeaders'
import { emFetch } from '../lib/emFetch'
import { sessionTtl } from '../lib/cache'
import { LIFTBAN } from '../config/screener'

/** 一批解禁:解禁日 + 限售股类型 + 占流通股本比(%) + 实际可流通股数(万股)。 */
export interface LiftBanEvent {
  date: string
  type: string
  ratioPct: number
  ableSharesWan: number
}

/** 挂在选股候选上的角标载荷(窗口内最近一批;瘦身,不带股数)。 */
export interface LiftBanBadge {
  date: string
  ratioPct: number
  type: string
}

export type LiftBanByCode = Map<string, LiftBanEvent[]>

const RPT = 'RPT_LIFT_STAGE'
const COLS = 'SECURITY_CODE,FREE_DATE,FREE_SHARES_TYPE,ABLE_FREE_SHARES,FREE_RATIO'
const PAGE_SIZE = 500

const norm = (d: unknown): string => String(d ?? '').slice(0, 10)

/** 行映射(纯函数,fixture 可测):脏行(缺 code/date)跳过;FREE_RATIO 小数→百分比(两位)。 */
export function mapLiftBanRows(data: unknown[]): Array<{ code: string; ev: LiftBanEvent }> {
  const out: Array<{ code: string; ev: LiftBanEvent }> = []
  for (const raw of data) {
    const d = raw as Record<string, unknown>
    const code = String(d.SECURITY_CODE ?? '')
    const date = norm(d.FREE_DATE)
    if (!/^\d{6}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    out.push({
      code,
      ev: {
        date,
        type: String(d.FREE_SHARES_TYPE ?? ''),
        ratioPct: Math.round((Number(d.FREE_RATIO) || 0) * 10000) / 100,
        ableSharesWan: Number(d.ABLE_FREE_SHARES) || 0,
      },
    })
  }
  return out
}

/** 窗口终点(fromDate + days 个日历日,UTC 安全)。 */
export function windowEnd(fromDate: string, days: number): string {
  return new Date(new Date(`${fromDate}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

/** 扁平行→code 分组,组内按解禁日升序(最近一批在前)。 */
export function groupLiftBans(rows: Array<{ code: string; ev: LiftBanEvent }>): LiftBanByCode {
  const out: LiftBanByCode = new Map()
  for (const { code, ev } of rows) {
    const arr = out.get(code)
    if (arr) arr.push(ev)
    else out.set(code, [ev])
  }
  for (const evs of out.values()) evs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return out
}

/** 候选角标:窗口内最近一批(多批只取最近的,那是最先到来的抛压)。 */
export function toLiftBanBadge(evs: LiftBanEvent[] | undefined): LiftBanBadge | null {
  const ev = evs?.[0]
  return ev ? { date: ev.date, ratioPct: ev.ratioPct, type: ev.type } : null
}

async function fetchPage(fromDate: string, toDate: string, pageNumber: number): Promise<{ rows: Array<{ code: string; ev: LiftBanEvent }>; pages: number }> {
  const filter = `(FREE_DATE>='${fromDate}')(FREE_DATE<='${toDate}')`
  const url =
    `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${RPT}` +
    `&columns=${COLS}&source=WEB&client=WEB` +
    `&sortColumns=FREE_DATE&sortTypes=1&pageSize=${PAGE_SIZE}&pageNumber=${pageNumber}` +
    `&filter=${encodeURIComponent(filter)}`
  const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 12000 })
  if (!res.ok) throw new Error(`LiftBan HTTP ${res.status}`)
  const json = (await res.json()) as { result?: { data?: unknown[]; pages?: number } }
  return { rows: mapLiftBanRows(json?.result?.data ?? []), pages: Number(json?.result?.pages) || 1 }
}

// 按 窗口起点×天数 keyed 缓存(解禁日历日内不变,盘中 30min 只为兜手动刷新;盘后 12h)。
const TTL = sessionTtl(30 * 60_000, 12 * 60 * 60_000)
const cache = new Map<string, { data: LiftBanByCode; expires: number }>()

/** 全市场未来窗口解禁表:code → 按日升序批次。首页失败 throw(调用方降级);后续页失败用已取部分。 */
export async function fetchUpcomingLiftBans(fromDate: string, days: number = LIFTBAN.FORWARD_DAYS): Promise<LiftBanByCode> {
  const key = `${fromDate}:${days}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.data
  const toDate = windowEnd(fromDate, days)
  const flat: Array<{ code: string; ev: LiftBanEvent }> = []
  let page = 1
  while (page <= LIFTBAN.MAX_PAGES) {
    let result: Awaited<ReturnType<typeof fetchPage>>
    try {
      result = await fetchPage(fromDate, toDate, page)
    } catch (err) {
      if (page === 1) throw err // 首页都拿不到=真失败,交调用方降级
      console.warn(`[LiftBan] 第 ${page} 页取数失败,用已取 ${flat.length} 行继续:`, err instanceof Error ? err.message : err)
      break
    }
    flat.push(...result.rows)
    if (result.rows.length === 0 || page >= result.pages) break
    page++
  }
  const data = groupLiftBans(flat)
  if (data.size > 0) {
    if (cache.size > 8) cache.clear() // 键=交易日×窗口,极少;防长跑进程无界增长
    cache.set(key, { data, expires: Date.now() + TTL() })
  }
  return data
}
