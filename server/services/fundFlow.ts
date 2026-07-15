// 主力净流入 / 成交量排名(实盘 live)。来源:东财资金流 clist(fid=f62 主力净流入排名)+ ulist 批量取个股。
// ⚠ 主力净流入(f62)东财不给免费历史 → 本因子**无法回测**(数据墙,同连板VWAP/连板分歧),仅作实盘展示/加成。
//   图里「净买入=主动性买入(买1/买2 档主动成交)」= f62 主力净流入;「净流入排名∩成交量排名 top200」= 资金共振。
//   主力净流入「值」按候选代码用 ulist 批量取(每只都有);「净流入排名/资金共振」取 f62 榜 top200;
//   成交量(成交额)排名由选股 prefilter 全市场 f6 免费算(见 screener.ts),不在本模块。
//   env 门控:FUNDRES_FUNDFLOW=0 关闭主力净流入取数(成交量排名不受影响,仍展示)。
import { EM_HEADERS } from '../lib/emHeaders'
import { emFetch } from '../lib/emFetch'
import { SCREENER } from '../config/screener'
import { toSecids } from './emQuotes'

// 资金流走 push2delay(实测对本机最宽松,fid=f62/ulist 须带 ut token)。多镜像轮换容错。
const FF_HOSTS = ['push2delay.eastmoney.com', 'push2.eastmoney.com', '82.push2.eastmoney.com']
const FF_UT = 'b2884a393a59ad64002292a3e90d46a5'
const FF_PZ = 100 // EM 每页上限
const ULIST_CHUNK = 100 // ulist 单次 secids 上限(保守)

/** 资金流信息(实盘加成,无回测背书)。netInflow 单位:元。 */
export interface FundFlowInfo {
  netInflow?: number // 主力净流入额(f62,元;买1/买2 档主动成交净额) —— ulist 取;门控关/失败时缺
  netInflowPct?: number // 主力净流入占比(f184,%)
  turnoverRank?: number // 成交量(成交额)排名 —— 由 screener prefilter 全市场算后写入
  inflowRank?: number // 主力净流入排名(仅 top-N 内,否则缺)
  resonance: boolean // 净流入∩成交量 双 top200(图里「资金共振」)
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

/** env 门控:默认开;FUNDRES_FUNDFLOW=0 关闭(主力净流入为未回测的实盘探索因子)。 */
export function isFundFlowEnabled(): boolean {
  return process.env.FUNDRES_FUNDFLOW !== '0'
}

/** 取一页资金流排名(按 fid 降序)。镜像轮换 + 重试一次。fields 默认净流入排名用的三字段,
 *  成交额排名(fetchTurnoverRankTop)传更全的字段以一次取够展示用的名称/现价/涨幅。 */
async function fetchRankPage(
  fid: string,
  pn: number,
  attempt = 0,
  fields = 'f12,f62,f184',
): Promise<Record<string, unknown>[]> {
  for (let i = 0; i < FF_HOSTS.length; i++) {
    const host = FF_HOSTS[(pn + i) % FF_HOSTS.length]
    const url =
      `https://${host}/api/qt/clist/get?pn=${pn}&pz=${FF_PZ}&po=1&np=1&fltt=2&invt=2&ut=${FF_UT}&fid=${fid}` +
      `&fs=${encodeURIComponent(SCREENER.CLIST_FS)}&fields=${fields}`
    try {
      const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 8000 })
      if (!res.ok) throw new Error(`fundflow HTTP ${res.status}`)
      const json = (await res.json()) as any
      return (json?.data?.diff ?? []) as Record<string, unknown>[]
    } catch {
      /* 试下一个镜像 */
    }
  }
  if (attempt < 1) {
    await new Promise((r) => setTimeout(r, 600))
    return fetchRankPage(fid, pn, attempt + 1, fields)
  }
  throw new Error('fundflow 全部镜像均失败')
}

// 主力净流入排名 top-N 按 topN 短缓存(盘中滚动,5 分钟)。
interface RankEntry {
  data: Map<string, number>
  expires: number
}
const rankCache = new Map<string, RankEntry>()
const TTL = 5 * 60_000

/** 主力净流入排名 top-N:code → 排名(1-based)。供资金共振判定 + 净流入排名展示。失败/门控关 → 空 Map。 */
export async function fetchInflowRankTop(topN = 200): Promise<Map<string, number>> {
  if (!isFundFlowEnabled()) return new Map()
  const key = String(topN)
  const hit = rankCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.data
  const out = new Map<string, number>()
  try {
    const pages = Math.ceil(topN / FF_PZ)
    for (let pn = 1; pn <= pages; pn++) {
      const rows = await fetchRankPage('f62', pn)
      if (rows.length === 0) break
      for (const row of rows) {
        const code = String(row.f12 ?? '')
        if (!code) continue
        out.set(code, out.size + 1)
        if (out.size >= topN) break
      }
      if (out.size >= topN) break
      if (pn < pages) await new Promise((r) => setTimeout(r, 120))
    }
  } catch (err) {
    console.warn('[FundFlow] 主力净流入排名取数失败(忽略):', err instanceof Error ? err.message : err)
    return out
  }
  rankCache.set(key, { data: out, expires: Date.now() + TTL })
  return out
}

/** 按候选代码批量取主力净流入「值」(f62/f184)。ulist 一次多只,分块。失败/门控关 → 空 Map。 */
export async function fetchFundFlowForCodes(codes: string[]): Promise<Map<string, { netInflow: number; netInflowPct: number }>> {
  const out = new Map<string, { netInflow: number; netInflowPct: number }>()
  if (!isFundFlowEnabled() || codes.length === 0) return out
  const secidByCode = new Map<string, string>()
  for (const c of codes) {
    const sid = toSecids(c)[0]
    if (sid) secidByCode.set(c, sid)
  }
  const secids = [...secidByCode.values()]
  for (let i = 0; i < secids.length; i += ULIST_CHUNK) {
    const chunk = secids.slice(i, i + ULIST_CHUNK)
    let ok = false
    for (let h = 0; h < FF_HOSTS.length && !ok; h++) {
      const url =
        `https://${FF_HOSTS[h]}/api/qt/ulist.np/get?secids=${chunk.join(',')}` +
        `&fields=f12,f62,f184&fltt=2&invt=2&ut=${FF_UT}`
      try {
        const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 8000 })
        if (!res.ok) throw new Error(`ulist HTTP ${res.status}`)
        const json = (await res.json()) as any
        const diff = (json?.data?.diff ?? []) as Record<string, unknown>[]
        for (const d of diff) {
          const code = String(d.f12 ?? '')
          if (!code) continue
          out.set(code, { netInflow: num(d.f62), netInflowPct: num(d.f184) })
        }
        ok = true
      } catch {
        /* 试下一个镜像 */
      }
    }
    if (!ok) console.warn('[FundFlow] ulist 分块取数失败(忽略该块)')
  }
  return out
}

export interface TurnoverRankEntry {
  rank: number // 成交额排名,1-based
  name: string
  price: number
  changePct: number
  amount: number // 成交额(元,f6)
  netInflow: number // 主力净流入额(元,f62)
  netInflowPct: number // 主力净流入占比(%,f184)
}

const turnoverCache = new Map<string, { data: Map<string, TurnoverRankEntry>; expires: number }>()

/** 成交额排名 top-N(含名称/现价/涨幅/主力净流入),一次 clist 调用(fid=f6 降序,多字段)取完,
 *  免走 prefilter 全市场翻页。资金共振榜专用;不影响 fetchInflowRankTop/enrichFundFlow。 */
export async function fetchTurnoverRankTop(topN = 200): Promise<Map<string, TurnoverRankEntry>> {
  const key = String(topN)
  const hit = turnoverCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.data
  const out = new Map<string, TurnoverRankEntry>()
  try {
    const pages = Math.ceil(topN / FF_PZ)
    for (let pn = 1; pn <= pages; pn++) {
      const rows = await fetchRankPage('f6', pn, 0, 'f12,f14,f2,f3,f6,f62,f184')
      if (rows.length === 0) break
      for (const row of rows) {
        const code = String(row.f12 ?? '')
        if (!code) continue
        out.set(code, {
          rank: out.size + 1,
          name: String(row.f14 ?? ''),
          price: num(row.f2),
          changePct: num(row.f3),
          amount: num(row.f6),
          netInflow: num(row.f62),
          netInflowPct: num(row.f184),
        })
        if (out.size >= topN) break
      }
      if (out.size >= topN) break
      if (pn < pages) await new Promise((r) => setTimeout(r, 120))
    }
  } catch (err) {
    console.warn('[FundFlow] 成交额排名取数失败(忽略):', err instanceof Error ? err.message : err)
    return out
  }
  turnoverCache.set(key, { data: out, expires: Date.now() + TTL })
  return out
}

// 板块级主力净流入(节奏表「资金回流」注记用),5 分钟缓存(整表一份,key 固定)。
const boardInflowCache = { data: new Map<string, number>(), expires: 0 }

/** 板块主力净流入(f62,元):ulist secids=90.BKxxxx 分块批量。失败/门控关 → 空 Map。
 *  同 f62 个股口径:东财无免费历史 → 仅实时注记,不可回测(数据墙,见文件头注释)。 */
export async function fetchBoardInflow(bkCodes: string[]): Promise<Map<string, number>> {
  if (!isFundFlowEnabled() || bkCodes.length === 0) return new Map()
  if (boardInflowCache.expires > Date.now()) return boardInflowCache.data
  const out = new Map<string, number>()
  const secids = bkCodes.map((c) => `90.${c}`)
  for (let i = 0; i < secids.length; i += ULIST_CHUNK) {
    const chunk = secids.slice(i, i + ULIST_CHUNK)
    let ok = false
    for (let h = 0; h < FF_HOSTS.length && !ok; h++) {
      const url =
        `https://${FF_HOSTS[h]}/api/qt/ulist.np/get?secids=${chunk.join(',')}` +
        `&fields=f12,f62&fltt=2&invt=2&ut=${FF_UT}`
      try {
        const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 8000 })
        if (!res.ok) throw new Error(`ulist HTTP ${res.status}`)
        const json = (await res.json()) as any
        const diff = (json?.data?.diff ?? []) as Record<string, unknown>[]
        for (const d of diff) {
          const code = String(d.f12 ?? '')
          if (code) out.set(code, num(d.f62))
        }
        ok = true
      } catch {
        /* 试下一个镜像 */
      }
    }
    if (!ok) console.warn('[FundFlow] 板块净流入分块取数失败(忽略该块)')
  }
  if (out.size > 0) {
    boardInflowCache.data = out
    boardInflowCache.expires = Date.now() + TTL
  }
  return out
}

export function clearFundFlowCache(): void {
  rankCache.clear()
  turnoverCache.clear()
  boardInflowCache.data = new Map()
  boardInflowCache.expires = 0
}
