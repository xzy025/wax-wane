// 回测宇宙构建 + K线取数/缓存(从 backtestScreener.ts 抽出,供 backtest 与 optimize 两个 CLI 共用)。
// 行为与原 backtestScreener 内联版完全一致:clist 全市场 → ST/退/流动性/市值过滤 → 按代码分层抽样 →
// 取前复权日线 → 落 docs/screener/.bars-<SAMPLE>-<KLINE>.json(确定性抽样故可缓存,重跑免再打 EM)。
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { EM_HEADERS } from '../lib/emHeaders'
import { fetchStockKline } from '../services/ashare'
import { SCREENER } from '../config/screener'
import type { Bar } from '../services/screenerRules'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', '..', 'docs', 'screener')

// ENV(与 backtestScreener 同口径):同 SAMPLE+KLINE 的缓存可跨 CLI 复用。
const SAMPLE = Number(process.env.SAMPLE) || 300 // 抽样只数
const KLINE = Number(process.env.KLINE) || 700 // 每票取多少根日线
const HOLD = Number(process.env.HOLD) || 20 // 仅用于「足够根数」过滤(取最大持有作下界)
const CONCURRENCY = Number(process.env.CONCURRENCY) || 12
const USE_CACHE = process.env.CACHE !== '0' // CACHE=0 强制重取

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

// ── Universe: clist 取数 + 廉价过滤(不含动量)+ 分层抽样 ────────────────
const CLIST_FIELDS = 'f2,f6,f12,f14,f20'
const CLIST_PZ = 100
const CLIST_HOSTS = ['push2delay.eastmoney.com', 'push2.eastmoney.com', '82.push2.eastmoney.com']

async function fetchClistPage(pn: number, attempt = 0): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  for (let i = 0; i < CLIST_HOSTS.length; i++) {
    const host = CLIST_HOSTS[(pn + i) % CLIST_HOSTS.length]
    const url =
      `https://${host}/api/qt/clist/get?pn=${pn}&pz=${CLIST_PZ}&po=1&np=1&fltt=2&invt=2&fid=f3` +
      `&fs=${encodeURIComponent(SCREENER.CLIST_FS)}&fields=${CLIST_FIELDS}`
    try {
      const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`clist HTTP ${res.status}`)
      const json = (await res.json()) as any
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

interface UnivStock {
  code: string
  name: string
}

async function buildUniverse(): Promise<UnivStock[]> {
  const first = await fetchClistPage(1)
  const total = first.total || first.rows.length
  const pages = Math.min(Math.ceil(total / CLIST_PZ), 60)
  const diff: Record<string, unknown>[] = [...first.rows]
  for (let pn = 2; pn <= pages; pn++) {
    await new Promise((r) => setTimeout(r, 120))
    try {
      const page = await fetchClistPage(pn)
      if (page.rows.length === 0) break
      diff.push(...page.rows)
    } catch {
      console.warn(`[Backtest] clist 第 ${pn} 页失败,使用已取 ${diff.length} 只继续`)
      break
    }
  }

  const eligible: UnivStock[] = []
  for (const d of diff) {
    const code = String(d.f12 ?? '')
    const name = String(d.f14 ?? '')
    const price = num(d.f2)
    const amount = num(d.f6)
    const mcap = num(d.f20)
    if (!code || price <= 0) continue
    if (/ST|退/i.test(name)) continue
    if (amount < SCREENER.LIQUIDITY_MIN) continue // 当下流动性(近似:活跃票才有历史可测)
    if (mcap < SCREENER.MCAP_MIN) continue
    eligible.push({ code, name })
  }
  // 按代码排序后等距分层抽样,跨 600/000/300/688 各段均匀覆盖,避免偏向某板块。
  eligible.sort((a, b) => a.code.localeCompare(b.code))
  if (eligible.length <= SAMPLE) return eligible
  const step = eligible.length / SAMPLE
  const sampled: UnivStock[] = []
  for (let i = 0; i < SAMPLE; i++) sampled.push(eligible[Math.floor(i * step)])
  return sampled
}

// ── 取 K 线(并发受限)────────────────────────────────────────────────
export interface StockBars {
  code: string
  name: string
  bars: Bar[]
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let idx = 0
  const worker = async () => {
    while (idx < items.length) {
      const cur = idx++
      out[cur] = await fn(items[cur], cur)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function loadBars(univ: UnivStock[]): Promise<StockBars[]> {
  let done = 0
  const res = await mapLimit(univ, CONCURRENCY, async (s) => {
    try {
      const { klines } = await fetchStockKline(s.code, 101, KLINE)
      done++
      if (done % 50 === 0) console.log(`[Backtest] 取K线 ${done}/${univ.length}`)
      if (!klines || klines.length < SCREENER.MA_LONG + SCREENER.MA_LONG_RISE_LOOKBACK + 1 + HOLD + 2) return null
      return { code: s.code, name: s.name, bars: klines as Bar[] }
    } catch {
      done++
      return null
    }
  })
  return res.filter((x): x is StockBars => x != null)
}

// 抽样宇宙是确定性的(按代码分层),故同 SAMPLE+KLINE 的 K 线可缓存到盘上,
// 重跑(调参/换指数)免再打 EM,也避免触发限流。CACHE=0 强制重取。
const BARS_CACHE = join(OUT_DIR, `.bars-${SAMPLE}-${KLINE}.json`)

export async function loadBarsCached(): Promise<StockBars[]> {
  if (USE_CACHE && existsSync(BARS_CACHE)) {
    try {
      const data = JSON.parse(readFileSync(BARS_CACHE, 'utf8')) as StockBars[]
      if (Array.isArray(data) && data.length) {
        console.log(`[Backtest] 复用缓存 K 线 ${data.length} 只 (${BARS_CACHE};CACHE=0 可强制重取)`)
        return data
      }
    } catch {
      /* 缓存损坏,重取 */
    }
  }
  console.log('[Backtest] 构建宇宙(clist 全市场 → 过滤 → 抽样)...')
  const univ = await buildUniverse()
  console.log(`[Backtest] 抽样 ${univ.length} 只,开始取 K 线...`)
  const data = await loadBars(univ)
  // 仅在取数较完整时落缓存,避免把"被限流的残缺结果"写进缓存毒化后续重跑。
  if (data.length >= univ.length * 0.6) {
    try {
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(BARS_CACHE, JSON.stringify(data))
    } catch {
      /* 缓存写失败非致命 */
    }
  } else {
    console.warn(`[Backtest] 有效样本仅 ${data.length}/${univ.length}(疑似限流),不落缓存`)
  }
  return data
}
