// 新高战法选股器服务:全市场 clist 廉价初筛 → 入围者 K 线精筛(纯规则) →
// RS 百分位 + 评分 + 分组 → 缓存 + 按日落盘 docs/screener/YYYY-MM-DD.json。
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createCache, sessionTtl } from '../lib/cache'
import { EM_HEADERS } from '../lib/emHeaders'
import { fetchStockKline, fetchIndexKline } from './ashare'
import { fetchSentiment } from './kaipanla'
import { SCREENER as C, type ScreenerConfig } from '../config/screener'
import { classify, finalScore, marketRegime, targetRMultFor, type Bar, type Candidate, type MarketRegime } from './screenerRules'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENER_DIR = join(__dirname, '..', '..', 'docs', 'screener')

export interface ScreenerCandidate extends Candidate {
  code: string
  name: string
  score: number
}

export interface ScreenerRegime {
  phase: 'attack' | 'caution' | 'retreat'
  temperature: number
  limitUp: number
  limitDown: number
  breakRate: number
  note: string
  /** 大盘趋势(指数代理):动态目标位的依据。 */
  marketTrend: MarketRegime
  /** 本次扫描据大盘趋势选定的目标位 R 倍数(动态关闭时=固定标量)。 */
  targetRMult: number
}

export interface ScreenerResult {
  asof: string // YYYY-MM-DD
  regime: ScreenerRegime
  breakout: ScreenerCandidate[]
  trigger: ScreenerCandidate[]
  scanned: number // 初筛后入围(取K线)只数
  universe: number // clist 全市场只数
  truncated: boolean // 是否触及 MAX_KLINE 上限
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

interface Pre {
  code: string
  name: string
  price: number
  amount: number // 成交额(元)
  mom60: number
  vr: number // 量比
}

const CLIST_FIELDS = 'f2,f3,f6,f8,f10,f12,f14,f20,f24,f25'
const CLIST_PZ = 100 // EM 每页上限 100,须翻页
// 多镜像主机轮换:分散负载 + 规避单主机反爬限流(push2delay 通常最宽松)。
const CLIST_HOSTS = ['push2delay.eastmoney.com', 'push2.eastmoney.com', '82.push2.eastmoney.com']

/** 取 clist 第 pn 页;镜像主机轮换 + 失败重试一次(东财限流容错)。 */
async function fetchClistPage(pn: number, attempt = 0): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  // 起始主机按页号轮换,失败再依次试其余主机。
  for (let i = 0; i < CLIST_HOSTS.length; i++) {
    const host = CLIST_HOSTS[(pn + i) % CLIST_HOSTS.length]
    const url =
      `https://${host}/api/qt/clist/get?pn=${pn}&pz=${CLIST_PZ}&po=1&np=1&fltt=2&invt=2&fid=f3` +
      `&fs=${encodeURIComponent(C.CLIST_FS)}&fields=${CLIST_FIELDS}`
    try {
      const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`clist HTTP ${res.status}`)
      const json = await res.json()
      return { rows: (json?.data?.diff ?? []) as Record<string, unknown>[], total: Number(json?.data?.total) || 0 }
    } catch {
      /* 试下一个镜像 */
    }
  }
  if (attempt < 1) {
    await new Promise((r) => setTimeout(r, 800))
    return fetchClistPage(pn, attempt + 1)
  }
  throw new Error('clist 全部镜像均失败')
}

/** Stage 1: 全市场 clist 翻页取数 + 廉价初筛。 */
async function prefilter(): Promise<{ rows: Pre[]; universe: number }> {
  const first = await fetchClistPage(1)
  const total = first.total || first.rows.length
  const pages = Math.min(Math.ceil(total / CLIST_PZ), 60) // 安全上限 6000 只
  const diff: Record<string, unknown>[] = [...first.rows]
  // 顺序翻页 + 小延迟,避免并发突发触发东财 clist 反爬限流;某页失败则用已取到的优雅降级。
  for (let pn = 2; pn <= pages; pn++) {
    await new Promise((r) => setTimeout(r, 120))
    try {
      const page = await fetchClistPage(pn)
      if (page.rows.length === 0) break
      diff.push(...page.rows)
    } catch {
      console.warn(`[Screener] clist 第 ${pn} 页失败,使用已取 ${diff.length} 只继续`)
      break
    }
  }
  const universe = diff.length

  const rows: Pre[] = []
  for (const d of diff) {
    const code = String(d.f12 ?? '')
    const name = String(d.f14 ?? '')
    const price = num(d.f2)
    const amount = num(d.f6)
    const mcap = num(d.f20)
    const mom60 = num(d.f24)
    const vr = num(d.f10)
    if (!code || price <= 0) continue
    if (/ST|退/i.test(name)) continue // 剔除 ST/*ST/退市整理
    if (amount < C.LIQUIDITY_MIN) continue // 低流动
    if (mcap < C.MCAP_MIN) continue // 小市值
    if (mom60 < C.MOM60_MIN) continue // 弱势
    rows.push({ code, name, price, amount, mom60, vr })
  }
  // 按 60 日动量排序(不掺量比——量比高会埋没"缩量待发"的扳机候选)。
  rows.sort((a, b) => b.mom60 - a.mom60)
  return { rows, universe }
}

/** Stage 2: 对一只票取 K 线并跑纯规则判定。cfg 可注入(动态目标位 R 倍数)。 */
async function confirm(p: Pre, cfg: ScreenerConfig): Promise<(ScreenerCandidate & { liqAmount: number }) | null> {
  try {
    const { klines } = await fetchStockKline(p.code, 101, cfg.KLINE_COUNT)
    if (!klines || klines.length < cfg.MA_LONG + cfg.MA_LONG_RISE_LOOKBACK + 1) return null
    const cand = classify(klines as Bar[], cfg)
    if (!cand) return null
    return { ...cand, code: p.code, name: p.name, score: 0, liqAmount: p.amount }
  } catch {
    return null
  }
}

/** 取大盘趋势(指数代理)→ 动态目标位 R 倍数。失败兜底中性/固定标量。 */
async function resolveMarketTarget(): Promise<{ marketTrend: MarketRegime; targetRMult: number }> {
  try {
    const idx = await fetchIndexKline(C.MARKET_INDEX_SECID, C.MARKET_MA_SLOW + 10)
    const marketTrend = marketRegime(idx.map((b) => b.close))
    return { marketTrend, targetRMult: targetRMultFor(marketTrend) }
  } catch {
    return { marketTrend: 'neutral', targetRMult: targetRMultFor('neutral') }
  }
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

function buildRegime(s: {
  temperature?: number
  limitUp?: number
  limitDown?: number
  breakRate?: number
}): ScreenerRegime {
  const temperature = num(s.temperature)
  const limitUp = num(s.limitUp)
  const limitDown = num(s.limitDown)
  const breakRate = num(s.breakRate)
  let phase: ScreenerRegime['phase']
  let note: string
  if (temperature >= 60 && breakRate < 30) {
    phase = 'attack'
    note = '情绪偏暖、破板率可控,题材友好——可正常打突破'
  } else if (temperature <= 40 || breakRate >= 40) {
    phase = 'retreat'
    note = '情绪退潮/破板率高——降仓,突破假信号多,谨慎或观望'
  } else {
    phase = 'caution'
    note = '情绪中性——小仓优选龙头突破,严格止损'
  }
  // marketTrend/targetRMult 先给安全默认,由 fetchScreenerFresh 取指数后回填。
  return { phase, temperature, limitUp, limitDown, breakRate, note, marketTrend: 'neutral', targetRMult: C.TARGET_R_MULT }
}

function todayStr(): string {
  // 用 Shanghai 日期作为存档键
  const now = new Date()
  const sh = new Date(now.getTime() + now.getTimezoneOffset() * 60_000 + 8 * 3_600_000)
  return `${sh.getFullYear()}-${String(sh.getMonth() + 1).padStart(2, '0')}-${String(sh.getDate()).padStart(2, '0')}`
}

async function fetchScreenerFresh(): Promise<ScreenerResult> {
  const asof = todayStr()

  // Regime(尽力而为,失败给中性)
  let regime: ScreenerRegime
  try {
    regime = buildRegime((await fetchSentiment()) as Record<string, number>)
  } catch {
    regime = {
      phase: 'caution', temperature: 0, limitUp: 0, limitDown: 0, breakRate: 0,
      note: '情绪数据暂不可用', marketTrend: 'neutral', targetRMult: C.TARGET_R_MULT,
    }
  }

  // 大盘趋势 → 动态目标位 R(逆向:弱市新高=龙头给更远目标)。回填 regime + 注入扫描 cfg。
  const { marketTrend, targetRMult } = await resolveMarketTarget()
  regime.marketTrend = marketTrend
  regime.targetRMult = targetRMult
  const scanCfg: ScreenerConfig = { ...C, TARGET_R_MULT: targetRMult }

  const { rows, universe } = await prefilter()
  const truncated = rows.length > C.MAX_KLINE
  const survivors = rows.slice(0, C.MAX_KLINE)
  if (truncated) {
    console.log(`[Screener] 初筛 ${rows.length} 只 > 上限 ${C.MAX_KLINE},截断取K线(其余未扫描)`)
  }
  console.log(
    `[Screener] 全市场 ${universe} → 初筛入围 ${rows.length} → 取K线 ${survivors.length};大盘 ${marketTrend} → 目标 ${targetRMult}R`,
  )

  const enriched = (await mapLimit(survivors, C.CONCURRENCY, (p) => confirm(p, scanCfg))).filter(
    (x): x is ScreenerCandidate & { liqAmount: number } => x != null,
  )

  // RS 百分位(在入围集内)+ 流动性归一 → 评分
  const rs = enriched.map((c) => c.rsRaw).sort((a, b) => a - b)
  const rsRank = (v: number) => (rs.length <= 1 ? 1 : rs.filter((x) => x <= v).length / rs.length)
  for (const c of enriched) {
    const liq01 = clamp01(Math.log10(Math.max(c.liqAmount, 1) / C.LIQUIDITY_MIN) / 2)
    c.score = finalScore(c, rsRank(c.rsRaw), liq01)
  }

  const strip = ({ liqAmount: _liq, ...rest }: ScreenerCandidate & { liqAmount: number }) => rest
  const breakout = enriched
    .filter((c) => c.group === 'breakout')
    .sort((a, b) => b.score - a.score)
    .map(strip)
  const trigger = enriched
    .filter((c) => c.group === 'trigger')
    .sort((a, b) => b.score - a.score)
    .map(strip)

  const result: ScreenerResult = { asof, regime, breakout, trigger, scanned: survivors.length, universe, truncated }

  // 按日落盘(无DB也可回看);失败不影响返回
  try {
    mkdirSync(SCREENER_DIR, { recursive: true })
    writeFileSync(join(SCREENER_DIR, `${asof}.json`), JSON.stringify(result, null, 2))
  } catch (err) {
    console.warn('[Screener] 存档失败(非致命):', err)
  }

  return result
}

const screenerCache = createCache<ScreenerResult>({
  name: 'Screener',
  ttl: sessionTtl(120_000, 30 * 60_000),
  fetcher: fetchScreenerFresh,
})

export function fetchScreener(): Promise<ScreenerResult> {
  return screenerCache.get()
}

export function clearScreenerCache(): void {
  screenerCache.clear()
}
