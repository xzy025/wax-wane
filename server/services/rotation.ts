// 板块轮动服务:东财 行业/概念 板块宇宙 → 板块日线(=指数)→ 长/短窗涨幅 → 2×2 象限 + 宽度概览。
// 板块即指数(secid 90.BKxxxx),复用 fetchIndexKline 取日线;所有窗口从同一段 closes 现算。
import { EM_HEADERS } from '../lib/emHeaders'
import { createCache, sessionTtl, type Cache } from '../lib/cache'
import { todayShanghai } from '../lib/time'
import { fetchIndexKline, fetchStockKline } from './ashare'
import { toSecids } from './emQuotes'
import { resolveStock } from './stockSearch'
import { SCREENER } from '../config/screener'
import { CONCEPT_BLOCKLIST } from './moneyflow'
import { changeOverWindow, classifyQuadrant, type Quadrant } from './rotationRules'
import { classify, finalScore, type Bar, type Candidate } from './screenerRules'

export type RotationCategory = 'industry' | 'concept'

export interface RotationBoard {
  code: string // BKxxxx
  name: string
  todayChg: number
  longChg: number
  shortChg: number
  quadrant: Quadrant
}
export interface RotationSummary {
  total: number
  hs: number
  ls: number
  hw: number
  lw: number
  shortUpPct: number // 短窗上涨板块占比
}
export interface RotationResult {
  asof: string
  category: RotationCategory
  longWin: number
  shortWin: number
  boards: RotationBoard[]
  summary: RotationSummary
}

export const ROTATION = {
  KLINE_BARS: 130, // 覆盖 120 日窗口
  CONCURRENCY: 10,
  // 东财 行业/概念 板块各 ~500 个(偏细分);按成交额截 top-N,聚焦真有资金轮动的活跃板块,
  // 同时把板块日线取数量控在可控范围(EM kline 偶发限流,少打更稳)。
  BOARD_CAP: 120,
  DRILL_CAP: 60, // 下钻逐股扫描的成分股上限(按成交额取前 N)
  LONG_WINS: [5, 10, 20, 60, 120],
  SHORT_WINS: [3, 5, 10],
  DEFAULT_LONG: 60,
  DEFAULT_SHORT: 5,
} as const

const FS: Record<RotationCategory, string> = { industry: 'm:90+t:2', concept: 'm:90+t:3' }
const CLIST_HOSTS = ['push2delay.eastmoney.com', 'push2.eastmoney.com', '82.push2.eastmoney.com']

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

export function clampLong(n: number): number {
  return (ROTATION.LONG_WINS as readonly number[]).includes(n) ? n : ROTATION.DEFAULT_LONG
}
export function clampShort(n: number): number {
  return (ROTATION.SHORT_WINS as readonly number[]).includes(n) ? n : ROTATION.DEFAULT_SHORT
}

export interface BoardMeta {
  code: string
  name: string
  todayChg: number
  amount: number
}

/** clist 翻页取一个分类的板块宇宙(镜像主机轮换容错)。 */
async function fetchClistPage(category: RotationCategory, pn: number): Promise<Record<string, unknown>[]> {
  for (let i = 0; i < CLIST_HOSTS.length; i++) {
    const host = CLIST_HOSTS[(pn + i) % CLIST_HOSTS.length]
    const url =
      `https://${host}/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3` +
      `&fs=${encodeURIComponent(FS[category])}&fields=f12,f13,f14,f3,f6`
    try {
      const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`clist HTTP ${res.status}`)
      const json = (await res.json()) as any
      return (json?.data?.diff ?? []) as Record<string, unknown>[]
    } catch {
      /* 试下一个镜像 */
    }
  }
  return []
}

// 导出:reboundReview(反攻日复盘卡)按名字定位券商板块用;rotation 内部逻辑不变。
export async function fetchBoardUniverse(category: RotationCategory): Promise<BoardMeta[]> {
  const out: BoardMeta[] = []
  for (let pn = 1; pn <= 6; pn++) {
    const rows = await fetchClistPage(category, pn)
    if (rows.length === 0) break
    for (const d of rows) {
      const code = String(d.f12 ?? '')
      const name = String(d.f14 ?? '')
      if (!code || !name) continue
      // 剔除 资金属性/风格/盘口/财报 类"伪板块"(融资融券/深股通/MSCI/昨日…),只留真实行业/概念。
      if (CONCEPT_BLOCKLIST.some((b) => name.includes(b))) continue
      out.push({ code, name, todayChg: num(d.f3), amount: num(d.f6) })
    }
    if (rows.length < 100) break
    await new Promise((rs) => setTimeout(rs, 120))
  }
  return out
}

// 板块日线 closes 长缓存(历史不可变;手动刷新时清空以纳入当日最新)。
const closesCache = new Map<string, { closes: number[]; expires: number }>()
const CLOSES_TTL = 24 * 3600_000

async function getBoardCloses(secid: string): Promise<number[]> {
  const hit = closesCache.get(secid)
  if (hit && hit.expires > Date.now()) return hit.closes
  const bars = await fetchIndexKline(secid, ROTATION.KLINE_BARS)
  const closes = bars.map((b) => b.close)
  // 空序列=上游失败(限流/镜像全挂),缓存它会把故障固化 24h——只缓存有效数据。
  if (closes.length > 0) closesCache.set(secid, { closes, expires: Date.now() + CLOSES_TTL })
  return closes
}

/** 有界并发。 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const cur = i++
      out[cur] = await fn(items[cur])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function fetchRotationFresh(
  category: RotationCategory,
  longWin: number,
  shortWin: number,
): Promise<RotationResult> {
  let universe = await fetchBoardUniverse(category)
  if (universe.length > ROTATION.BOARD_CAP) {
    universe = [...universe].sort((a, b) => b.amount - a.amount).slice(0, ROTATION.BOARD_CAP)
  }

  const rows = (
    await mapLimit(universe, ROTATION.CONCURRENCY, async (b): Promise<RotationBoard | null> => {
      try {
        const closes = await getBoardCloses(`90.${b.code}`)
        const longChg = changeOverWindow(closes, longWin)
        const shortChg = changeOverWindow(closes, shortWin)
        if (Number.isNaN(longChg) || Number.isNaN(shortChg)) return null
        return {
          code: b.code,
          name: b.name,
          todayChg: r2(b.todayChg),
          longChg: r2(longChg),
          shortChg: r2(shortChg),
          quadrant: classifyQuadrant(longChg, shortChg),
        }
      } catch {
        return null
      }
    })
  ).filter((x): x is RotationBoard => x != null)

  rows.sort((a, b) => b.shortChg - a.shortChg) // 短窗强→弱;前端按象限分组保序

  const cnt = (q: Quadrant) => rows.filter((b) => b.quadrant === q).length
  const shortUp = rows.filter((b) => b.shortChg >= 0).length
  const summary: RotationSummary = {
    total: rows.length,
    hs: cnt('hs'),
    ls: cnt('ls'),
    hw: cnt('hw'),
    lw: cnt('lw'),
    shortUpPct: rows.length ? r2((shortUp / rows.length) * 100) : 0,
  }

  console.log(`[Rotation] ${category} 板块 ${universe.length}→有效 ${rows.length};长${longWin}/短${shortWin}日`)
  return { asof: todayShanghai(), category, longWin, shortWin, boards: rows, summary }
}

// 结果按 分类|长窗|短窗 分别缓存(共享 closesCache,切窗口免重取日线)。
const resultCaches = new Map<string, Cache<RotationResult>>()
function cacheFor(category: RotationCategory, longWin: number, shortWin: number): Cache<RotationResult> {
  const key = `${category}|${longWin}|${shortWin}`
  let c = resultCaches.get(key)
  if (!c) {
    c = createCache<RotationResult>({
      name: `Rotation:${key}`,
      ttl: sessionTtl(120_000, 30 * 60_000),
      fetcher: () => fetchRotationFresh(category, longWin, shortWin),
    })
    resultCaches.set(key, c)
  }
  return c
}

export function fetchRotation(category: RotationCategory, longWin: number, shortWin: number): Promise<RotationResult> {
  return cacheFor(category, clampLong(longWin), clampShort(shortWin)).get()
}

export function clearRotationCache(): void {
  for (const c of resultCaches.values()) c.clear()
  for (const c of drillCaches.values()) c.clear()
  closesCache.clear()
}

/** 搜个股 → 解析 + 取其所属板块名(供前端过滤命中的板块)。 */
export async function fetchStockBoards(query: string): Promise<{ code: string; name: string; boards: string[] }> {
  const m = await resolveStock(query)
  if (!m) return { code: '', name: '', boards: [] }
  const secid = toSecids(m.code)[0]
  if (!secid) return { code: m.code, name: m.name, boards: [] }
  try {
    const url =
      `https://push2.eastmoney.com/api/qt/slist/get?spt=3&fltt=2&invt=2&fid=f3&po=1&pn=1&pz=100` +
      `&secid=${secid}&fields=f12,f14`
    const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(6000) })
    if (!res.ok) return { code: m.code, name: m.name, boards: [] }
    const json = (await res.json()) as { data?: { diff?: unknown } }
    const diff = json.data?.diff
    const arr: Record<string, unknown>[] = diff ? (Array.isArray(diff) ? diff : Object.values(diff)) : []
    const boards = arr.map((d) => String(d.f14 ?? '')).filter(Boolean)
    return { code: m.code, name: m.name, boards }
  } catch {
    return { code: m.code, name: m.name, boards: [] }
  }
}

// ── 个股 → 所属行业板块(供选股「板块强弱」加分 / 回测 as-of 强弱)──────────
// ⚠ slist 仅返回「当前」所属板块,无历史。回测里以「今日行业归属」近似过去归属(行业成员稳定),
// 引入轻度前视偏差,按相对比较对待(同回测既有的幸存者偏差)。

/** slist 取个股所属板块 {bk, name}(含 BK 代码 f12 + 名称 f14)。 */
async function fetchStockBoardList(code: string): Promise<{ bk: string; name: string }[]> {
  const secid = toSecids(code)[0]
  if (!secid) return []
  try {
    const url =
      `https://push2.eastmoney.com/api/qt/slist/get?spt=3&fltt=2&invt=2&fid=f3&po=1&pn=1&pz=100` +
      `&secid=${secid}&fields=f12,f14`
    const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(6000) })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: { diff?: unknown } }
    const diff = json.data?.diff
    const arr: Record<string, unknown>[] = diff ? (Array.isArray(diff) ? diff : Object.values(diff)) : []
    return arr.map((d) => ({ bk: String(d.f12 ?? ''), name: String(d.f14 ?? '') })).filter((b) => b.bk && b.name)
  } catch {
    return []
  }
}

// 行业板块代码集合(t:2)缓存:从个股所属板块里挑「行业」板(成员稳定,优于概念)。
let industrySetCache: { set: Set<string>; expires: number } | null = null
async function getIndustryBoardSet(): Promise<Set<string>> {
  if (industrySetCache && industrySetCache.expires > Date.now()) return industrySetCache.set
  const universe = await fetchBoardUniverse('industry')
  const set = new Set(universe.map((b) => b.code))
  industrySetCache = { set, expires: Date.now() + 24 * 3600_000 }
  return set
}

/** 个股 → 主行业板块 {bk, name}(优先 slist 命中的行业板;无则退第一个非伪板块)。bk='' = 无法解析。 */
export async function resolveStockIndustryBoard(code: string): Promise<{ bk: string; name: string }> {
  const boards = await fetchStockBoardList(code)
  if (boards.length === 0) return { bk: '', name: '' }
  const filtered = boards.filter((b) => !CONCEPT_BLOCKLIST.some((x) => b.name.includes(x)))
  const pool = filtered.length ? filtered : boards
  try {
    const industrySet = await getIndustryBoardSet()
    const hit = pool.find((b) => industrySet.has(b.bk))
    if (hit) return { bk: hit.bk, name: hit.name }
  } catch {
    /* 行业宇宙取数失败 → 退回第一个板 */
  }
  return { bk: pool[0].bk, name: pool[0].name }
}

// ── 板块内强势股下钻(复用选股器新高战法 classify)─────────────────────
export interface BoardStock extends Candidate {
  code: string
  name: string
  score: number
}
export interface BoardStocksResult {
  code: string
  name: string
  scanned: number
  breakout: BoardStock[]
  trigger: BoardStock[]
  /** 成分股当日涨跌幅榜(按 changePct 降序,前 TOP_MOVERS_N);不跑 K线/classify,
   *  蓝筹反转板块(如保险)不符合新高战法趋势模板,靠这个才能看清"具体是谁在涨"。 */
  topMovers: { code: string; name: string; changePct: number }[]
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const TOP_MOVERS_N = 10

/** 成分股当日涨跌幅榜(按 changePct 降序取前 n);纯函数,不跑 K线/classify——
 *  蓝筹反转板块(如保险)成分股基本不符合新高战法趋势模板,靠这个才能看清"具体是谁在涨"。 */
export function rankTopMovers<T extends { changePct: number }>(members: T[], n: number): T[] {
  return [...members].sort((a, b) => b.changePct - a.changePct).slice(0, n)
}

/** 板块成分股(报价调用 fs=b:BKxxxx,不受 kline 限流);按成交额降序。changePct=当日涨跌幅%(f3)。
 *  导出:reboundReview 取券商板块领涨成分用。 */
export async function fetchBoardConstituents(
  bkCode: string,
): Promise<{ code: string; name: string; amount: number; changePct: number }[]> {
  for (let i = 0; i < CLIST_HOSTS.length; i++) {
    const host = CLIST_HOSTS[i]
    const url =
      `https://${host}/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f6` +
      `&fs=${encodeURIComponent(`b:${bkCode}`)}&fields=f12,f14,f6,f3`
    try {
      const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`clist b: HTTP ${res.status}`)
      const json = (await res.json()) as any
      const diff = (json?.data?.diff ?? []) as Record<string, unknown>[]
      if (diff.length) {
        return diff
          .map((d) => ({ code: String(d.f12 ?? ''), name: String(d.f14 ?? ''), amount: num(d.f6), changePct: num(d.f3) }))
          .filter((x) => x.code)
      }
    } catch {
      /* 试下一个镜像 */
    }
  }
  return []
}

async function fetchBoardStocksFresh(bkCode: string): Promise<BoardStocksResult> {
  const allMembers = await fetchBoardConstituents(bkCode)
  const topMovers = rankTopMovers(allMembers, TOP_MOVERS_N).map(({ code, name, changePct }) => ({ code, name, changePct }))
  const members = allMembers.slice(0, ROTATION.DRILL_CAP)
  const enriched = (
    await mapLimit(members, ROTATION.CONCURRENCY, async (m): Promise<(BoardStock & { liqAmount: number }) | null> => {
      try {
        const { klines } = await fetchStockKline(m.code, 101, SCREENER.KLINE_COUNT)
        if (!klines || klines.length < SCREENER.MA_LONG + SCREENER.MA_LONG_RISE_LOOKBACK + 1) return null
        const cand = classify(klines as Bar[])
        if (!cand) return null
        return { ...cand, code: m.code, name: m.name, score: 0, liqAmount: m.amount }
      } catch {
        return null
      }
    })
  ).filter((x): x is BoardStock & { liqAmount: number } => x != null)

  // RS 百分位(板块内)+ 流动性归一 → 评分(与选股器一致)
  const rs = enriched.map((c) => c.rsRaw).sort((a, b) => a - b)
  const rsRank = (v: number) => (rs.length <= 1 ? 1 : rs.filter((x) => x <= v).length / rs.length)
  for (const c of enriched) {
    const liq01 = clamp01(Math.log10(Math.max(c.liqAmount, 1) / SCREENER.LIQUIDITY_MIN) / 2)
    c.score = finalScore(c, rsRank(c.rsRaw), liq01)
  }
  const strip = ({ liqAmount: _liq, ...rest }: BoardStock & { liqAmount: number }) => rest
  const breakout = enriched.filter((c) => c.group === 'breakout').sort((a, b) => b.score - a.score).map(strip)
  const trigger = enriched.filter((c) => c.group === 'trigger').sort((a, b) => b.score - a.score).map(strip)
  console.log(`[Rotation] 下钻 ${bkCode}:成分 ${members.length} → 突破 ${breakout.length}/扳机 ${trigger.length}`)
  return { code: bkCode, name: bkCode, scanned: members.length, breakout, trigger, topMovers }
}

const drillCaches = new Map<string, Cache<BoardStocksResult>>()
export function fetchBoardStocks(bkCode: string): Promise<BoardStocksResult> {
  let c = drillCaches.get(bkCode)
  if (!c) {
    c = createCache<BoardStocksResult>({
      name: `Rotation:drill:${bkCode}`,
      ttl: sessionTtl(120_000, 30 * 60_000),
      fetcher: () => fetchBoardStocksFresh(bkCode),
    })
    drillCaches.set(bkCode, c)
  }
  return c.get()
}
