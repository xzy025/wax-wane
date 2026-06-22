// A-share market data fetching from East Money APIs (Sina fallback for limit pools)

import { EM_HEADERS, SINA_HEADERS } from '../lib/emHeaders'
import { createCache, sessionTtl } from '../lib/cache'

// ── Types ──────────────────────────────────────────────────

export interface IndexQuote {
  code: string
  name: string
  price: number
  changePct: number
  changeAmt: number
  volume: number
  turnover: number
  high: number
  low: number
  open: number
  prevClose: number
}

export interface LimitStock {
  code: string
  name: string
  price: number
  changePct: number
  turnoverRate: number
  amount: number
  firstTime: string
  lastTime: string
  openCount: number
  consecutiveDays: number
  industry: string
}

export interface HighStock {
  code: string
  name: string
  price: number
  changePct: number
  refHigh: number      // 参考高点价格（前期高点 或 52周高点）
  gapPct: number       // 距该参考高点的百分比；<=0 表示已突破
}

export interface VolumeRecord {
  date: string
  volume: number
  turnover: number
}

export interface AShareData {
  indices: IndexQuote[]
  limitUpCount: number
  limitDownCount: number
  limitUpStocks: LimitStock[]
  limitDownStocks: LimitStock[]
  advance: number
  decline: number
  flat: number
  promotionRate: number
  promotedCount: number
  promotionTotal: number
  volumeHistory: VolumeRecord[]
  /** 沪深两市当日总成交额 (元) = 上证综指 + 深证成指 turnover. 0 if unavailable. */
  totalTurnover: number
}

// ── Cache (market-aware) ───────────────────────────────────
// 60s during the trading session, 30min after close/weekends. A single
// /api/ashare call fans out to ~10 upstream requests, so a long off-hours TTL
// is what keeps this review app under the free-API rate limits.

const ashareCache = createCache<AShareData>({
  name: 'AShare',
  ttl: sessionTtl(60_000, 30 * 60_000),
  fetcher: fetchAShareDataFresh,
})

export function clearAShareCache() {
  ashareCache.clear()
}

// Highs analysis is expensive (per-stock kline scan) so it has its own cache and
// endpoint (/api/highs), keeping /api/ashare fast. fetchHighsAnalysis is defined
// further down (function declarations are hoisted).
const highsCache = createCache<HighsAnalysis>({
  name: 'Highs',
  ttl: sessionTtl(120_000, 30 * 60_000),
  fetcher: fetchHighsAnalysis,
})

export function fetchHighs(): Promise<HighsAnalysis> {
  return highsCache.get()
}

export function clearHighsCache() {
  highsCache.clear()
}

// ── Typed API response shapes ─────────────────────────────

/** East Money index/breadth API response item with field code mapping. */
interface EMIndexItem {
  readonly f2: number   // price
  readonly f3: number   // changePct
  readonly f4: number   // changeAmt
  readonly f5: number   // volume
  readonly f6: number   // turnover
  readonly f12: string  // code
  readonly f14: string  // name
  readonly f15: number  // high
  readonly f16: number  // low
  readonly f17: number  // open
  readonly f18: number  // prevClose
  readonly f104?: number // advance count
  readonly f105?: number // decline count
  readonly f106?: number // flat count
}

/** East Money limit pool API response item. */
interface EMLimitPoolItem {
  readonly c: string   // code
  readonly n: string   // name
  readonly p: number   // price
  readonly zdp: number // changePct
  readonly hs: number  // turnoverRate
  readonly amount: number
  readonly fbt: string // firstTime
  readonly lbt: string // lastTime
  readonly zbc: number // openCount
  readonly lbc: number // consecutiveDays
  readonly hybk: string // industry
}

/** East Money new-high API response item. */
interface EMNewHighItem {
  readonly f2: number   // price
  readonly f3: number   // changePct
  readonly f12: string  // code
  readonly f14: string  // name
  readonly f15: number  // high (52-week)
}

/** Safely coerce an unknown value to a number, returning 0 for non-numeric values. */
function toNum(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

/** Safely coerce an unknown value to a string, returning '' for non-string values. */
function toStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

// ── Fetchers ───────────────────────────────────────────────

async function fetchIndicesAndBreadth(): Promise<{ indices: IndexQuote[]; advance: number; decline: number; flat: number }> {
  // Try EastMoney first
  try {
    const fields = 'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18,f104,f105,f106'
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001,0.399006&fields=${fields}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, { headers: EM_HEADERS, signal: controller.signal })
    clearTimeout(timeout)

    if (res.ok) {
      const json = await res.json()
      const diff = (json?.data?.diff ?? []) as EMIndexItem[]
      if (diff.length > 0) {
        const indices: IndexQuote[] = []
        let advance = 0
        let decline = 0
        let flat = 0

        for (const item of diff) {
          const code = toStr(item.f12)
          if (['000001', '399001', '399006'].includes(code)) {
            indices.push({
              code,
              name: toStr(item.f14),
              price: toNum(item.f2),
              changePct: toNum(item.f3),
              changeAmt: toNum(item.f4),
              volume: toNum(item.f5),
              turnover: toNum(item.f6),
              high: toNum(item.f15),
              low: toNum(item.f16),
              open: toNum(item.f17),
              prevClose: toNum(item.f18),
            })
          }
          if (code === '000001' || code === '399001') {
            advance += toNum(item.f104)
            decline += toNum(item.f105)
            flat += toNum(item.f106)
          }
        }

        if (indices.length > 0) return { indices, advance, decline, flat }
      }
    }
  } catch {
    // Fall through to Sina
  }

  // Fallback: Sina API
  try {
    const sinaUrl = 'https://hq.sinajs.cn/list=sh000001,sz399001,sz399006'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(sinaUrl, {
      headers: { ...SINA_HEADERS, Referer: 'https://finance.sina.com.cn/' },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (res.ok) {
      const text = await res.text()
      const lines = text.split('\n').filter(l => l.trim())
      const indices: IndexQuote[] = []

      const sinaMapping: Record<string, { code: string; name: string }> = {
        sh000001: { code: '000001', name: '上证指数' },
        sz399001: { code: '399001', name: '深证成指' },
        sz399006: { code: '399006', name: '创业板指' },
      }

      for (const line of lines) {
        const match = line.match(/hq_str_(\w+)="([^"]+)"/)
        if (!match) continue
        const symbol = match[1]
        const meta = sinaMapping[symbol]
        if (!meta) continue

        const parts = match[2].split(',')
        if (parts.length < 32) continue

        const open = parseFloat(parts[1]) || 0
        const prevClose = parseFloat(parts[2]) || 0
        const price = parseFloat(parts[3]) || 0
        const high = parseFloat(parts[4]) || 0
        const low = parseFloat(parts[5]) || 0
        const volume = parseFloat(parts[8]) || 0
        const turnover = parseFloat(parts[9]) || 0

        indices.push({
          code: meta.code,
          name: meta.name,
          price,
          changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
          changeAmt: price - prevClose,
          volume,
          turnover,
          high,
          low,
          open,
          prevClose,
        })
      }

      if (indices.length > 0) return { indices, advance: 0, decline: 0, flat: 0 }
    }
  } catch {
    // Both failed
  }

  return { indices: [], advance: 0, decline: 0, flat: 0 }
}

async function fetchLimitPool(type: 'up' | 'down'): Promise<{ count: number; stocks: LimitStock[] }> {
  const endpoint = type === 'up' ? 'getTopicZTPool' : 'getTopicDTPool'
  const today = new Date()
  const date = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  const url = `https://push2ex.eastmoney.com/${endpoint}?ut=7eea3edcaed734bea9cb3fce871cbecd&dpt=wz.ztzt&date=${date}&_=${Date.now()}`
  const res = await fetch(url, { headers: EM_HEADERS })
  if (!res.ok) throw new Error(`East Money ${endpoint}: ${res.status}`)
  const json = await res.json()

  const pool = (json?.data?.pool ?? []) as EMLimitPoolItem[]
  const count = toNum(json?.data?.tc) || pool.length
  const stocks: LimitStock[] = pool.map((item) => ({
    code: toStr(item.c),
    name: toStr(item.n),
    price: toNum(item.p),
    changePct: toNum(item.zdp),
    turnoverRate: toNum(item.hs),
    amount: toNum(item.amount),
    firstTime: toStr(item.fbt),
    lastTime: toStr(item.lbt),
    openCount: toNum(item.zbc),
    consecutiveDays: toNum(item.lbc),
    industry: toStr(item.hybk),
  }))

  return { count, stocks }
}

// ── Sina fallback for limit-up/limit-down ───────────────────

interface SinaStock {
  code: string
  name: string
  trade: string
  changepercent: number
  volume: number
  amount: number
  mktcap: number
  turnoverratio: number
}

function isLimitUp(changePct: number, code: string): boolean {
  // ChiNext (300xxx, 301xxx) and STAR (688xxx) have 20% limit
  // Main board (others) has 10% limit
  // New stocks (N prefix) have no limit on first day
  if (code.startsWith('300') || code.startsWith('301') || code.startsWith('688')) {
    return changePct >= 19.9
  }
  return changePct >= 9.9
}

function isLimitDown(changePct: number, code: string): boolean {
  if (code.startsWith('300') || code.startsWith('301') || code.startsWith('688')) {
    return changePct <= -19.9
  }
  return changePct <= -9.9
}

async function fetchSinaLimitPool(direction: 'up' | 'down'): Promise<{ count: number; stocks: LimitStock[] }> {
  const asc = direction === 'up' ? 0 : 1
  const limitFn = direction === 'up' ? isLimitUp : isLimitDown
  const PAGE_SIZE = 100
  const MAX_PAGES = 30

  let totalCount = 0
  const stocks: LimitStock[] = []

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=${PAGE_SIZE}&sort=changepercent&asc=${asc}&node=hs_a&symbol=&_s_r_a=srt`
    const res = await fetch(url, { headers: SINA_HEADERS })
    if (!res.ok) throw new Error(`Sina limit pool: ${res.status}`)

    const data: SinaStock[] = await res.json()
    if (!Array.isArray(data) || data.length === 0) break

    let hitLimit = false
    for (const item of data) {
      if (item.changepercent === 0) continue
      // Skip new stocks (N prefix) - they have no price limit
      if (item.name.startsWith('N')) continue

      if (limitFn(item.changepercent, item.code)) {
        hitLimit = true
        totalCount++
        if (stocks.length < 50) {
          stocks.push({
            code: item.code,
            name: item.name,
            price: parseFloat(item.trade),
            changePct: item.changepercent,
            turnoverRate: item.turnoverratio,
            amount: item.amount,
            firstTime: '',
            lastTime: '',
            openCount: 0,
            consecutiveDays: 0,
            industry: '',
          })
        }
      }
    }

    // If this page has no limit stocks, no need to check further
    if (!hitLimit) break
    // If we got fewer than PAGE_SIZE results, we've reached the end
    if (data.length < PAGE_SIZE) break
  }

  return { count: totalCount, stocks }
}

// ── Date helper ─────────────────────────────────────────

function formatDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function getRecentTradingDay(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  // Skip weekends
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1)
  }
  return formatDate(d)
}

// ── Promotion rate (连板晋级率) ─────────────────────────

async function fetchPromotionRate(): Promise<{ rate: number; promoted: number; total: number }> {
  // Fetch today's and yesterday's limit-up pools to calculate promotion rate
  const todayStr = getRecentTradingDay(0)
  const yesterdayStr = getRecentTradingDay(1)

  const [todayRes, yesterdayRes] = await Promise.allSettled([
    fetchLimitPoolRaw(todayStr),
    fetchLimitPoolRaw(yesterdayStr),
  ])

  const todayPool = todayRes.status === 'fulfilled' ? todayRes.value : []
  const yesterdayTotal = yesterdayRes.status === 'fulfilled' ? yesterdayRes.value.length : 0

  if (yesterdayTotal === 0) return { rate: 0, promoted: 0, total: 0 }

  // Promoted = stocks that were limit-up yesterday AND still limit-up today (lbc >= 2)
  const promoted = todayPool.filter((s) => s.consecutiveDays >= 2).length
  const rate = Math.round((promoted / yesterdayTotal) * 100)

  return { rate, promoted, total: yesterdayTotal }
}

async function fetchLimitPoolRaw(date: string): Promise<LimitStock[]> {
  const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cb3fce871cbecd&dpt=wz.ztzt&date=${date}&_=${Date.now()}`
  const res = await fetch(url, { headers: EM_HEADERS })
  if (!res.ok) return []
  const json = await res.json()
  const pool = (json?.data?.pool ?? []) as EMLimitPoolItem[]
  return pool.map((item) => ({
    code: toStr(item.c),
    name: toStr(item.n),
    price: toNum(item.p),
    changePct: toNum(item.zdp),
    turnoverRate: toNum(item.hs),
    amount: toNum(item.amount),
    firstTime: toStr(item.fbt),
    lastTime: toStr(item.lbt),
    openCount: toNum(item.zbc),
    consecutiveDays: toNum(item.lbc),
    industry: toStr(item.hybk),
  }))
}

// ── Highs analysis: prior swing high (前期高点) + 52-week high (52周高点) ──
//
// EM's realtime list APIs only expose the *intraday* high (f15), never the
// 52-week / historical high. So we take a bounded candidate set (today's top
// gainers) and pull each one's daily kline to derive real reference highs.
// All math lives in the pure helpers below so it can be unit-tested.

const HIGHS_CANDIDATES = 80 // top-N by today's change to enrich with kline
const HIGHS_KLINE_LMT = 520 // ~2 trading years of daily bars
const HIGHS_KLINE_TIMEOUT = 3500 // per-kline abort (ms)
const HIGHS_WINDOW_52W = 250 // ~52 trading weeks
const HIGHS_PIVOT_W = 10 // swing-high pivot half-window
const HIGHS_NEAR_PCT = 5 // list stocks within this % below the reference
const HIGHS_LIST_MAX = 50
const HIGHS_CONCURRENCY = 15

const round2 = (n: number) => Math.round(n * 100) / 100

/** 52-week high = max high over the most recent ~250 bars (次高点). */
export function max52w(highs: number[]): number {
  if (highs.length === 0) return 0
  return Math.max(...highs.slice(-HIGHS_WINDOW_52W))
}

/**
 * Prior swing high (前期高点 / 最高点): the nearest swing-high pivot that sits
 * ABOVE the 52-week high — i.e. the next major resistance from an earlier peak.
 * A swing high is a local max within ±w bars. If no older peak exceeds the
 * 52-week high (the stock is at/near its multi-year top), falls back to the
 * 52-week high, so prevHigh >= high52w always holds.
 */
export function detectPrevSwingHigh(highs: number[], _price: number): number {
  const n = highs.length
  if (n === 0) return 0
  const w = HIGHS_PIVOT_W
  const h52 = max52w(highs)
  const pivots: number[] = []
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - w)
    const hi = Math.min(n - 1, i + w)
    let isMax = true
    for (let j = lo; j <= hi; j++) {
      if (highs[j] > highs[i]) { isMax = false; break }
    }
    if (isMax) pivots.push(highs[i])
  }
  const above = pivots.filter((p) => p > h52 * 1.0001)
  if (above.length > 0) return Math.min(...above) // nearest peak above the 52-week high
  return h52
}

/** Gap from price up to a reference high, in %. <=0 means price broke above it. */
export function gapPct(ref: number, price: number): number {
  if (ref <= 0) return 0
  return round2(((ref - price) / ref) * 100)
}

/** Run an async fn over items with a bounded concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const cur = idx++
      results[cur] = await fn(items[cur])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Fetch a stock's daily highs (front-adjusted, oldest→newest) from EM kline. */
async function fetchKlineHighs(secid: string, lmt: number = HIGHS_KLINE_LMT): Promise<number[]> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=${lmt}`
  try {
    const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(HIGHS_KLINE_TIMEOUT) })
    if (!res.ok) return []
    const json = await res.json()
    const klines = json?.data?.klines as string[] | undefined
    if (!Array.isArray(klines)) return []
    // kline line: date,open,close,high,low,volume,turnover → high = index 3
    return klines.map((line) => parseFloat(line.split(',')[3]) || 0).filter((h) => h > 0)
  } catch {
    return []
  }
}

/** EM secid prefix: Shanghai (6xxxxx) = 1, everything else (SZ/BJ) = 0. */
function toSecid(code: string): string {
  return `${code.startsWith('6') ? '1' : '0'}.${code}`
}

export interface HighsAnalysis {
  prevHigh: { count: number; stocks: HighStock[] }
  high52w: { count: number; stocks: HighStock[] }
}

async function fetchHighsAnalysis(): Promise<HighsAnalysis> {
  const empty: HighsAnalysis = { prevHigh: { count: 0, stocks: [] }, high52w: { count: 0, stocks: [] } }

  // 1. Candidate universe: today's top gainers (clist already sorted by f3 desc).
  const fields = 'f2,f3,f12,f14'
  const fs = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=6000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(fs)}&fields=${fields}`
  let candidates: { code: string; name: string; price: number; changePct: number }[]
  try {
    const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return empty
    const json = await res.json()
    const diff = (json?.data?.diff ?? []) as EMNewHighItem[]
    candidates = diff
      .map((s) => ({ code: toStr(s.f12), name: toStr(s.f14), price: toNum(s.f2), changePct: toNum(s.f3) }))
      .filter((s) => s.price > 0 && s.code)
      .slice(0, HIGHS_CANDIDATES)
  } catch {
    return empty
  }
  if (candidates.length === 0) return empty

  // 2. Enrich each candidate with its real reference highs via kline.
  const enriched = await mapLimit(candidates, HIGHS_CONCURRENCY, async (s) => {
    const highs = await fetchKlineHighs(toSecid(s.code))
    if (highs.length === 0) return null
    return { ...s, h52: max52w(highs), prev: detectPrevSwingHigh(highs, s.price) }
  })
  const ok = enriched.filter((x): x is NonNullable<typeof x> => x != null)
  if (ok.length === 0) return empty

  // 3. Build the two reference views (list = within HIGHS_NEAR_PCT incl. broken).
  const build = (refOf: (s: (typeof ok)[number]) => number): { count: number; stocks: HighStock[] } => {
    const stocks: HighStock[] = ok
      .map((s) => {
        const ref = refOf(s)
        return { code: s.code, name: s.name, price: s.price, changePct: s.changePct, refHigh: round2(ref), gapPct: gapPct(ref, s.price) }
      })
      .filter((x) => x.refHigh > 0 && x.gapPct <= HIGHS_NEAR_PCT)
      .sort((a, b) => a.gapPct - b.gapPct)
    const count = stocks.filter((x) => x.gapPct <= 0).length
    return { count, stocks: stocks.slice(0, HIGHS_LIST_MAX) }
  }

  return { prevHigh: build((s) => s.prev), high52w: build((s) => s.h52) }
}

// ── Index intraday trends (分时数据) ───────────────────────

export interface TrendPoint {
  time: string
  price: number
  volume: number
  avgPrice: number
}

const INDEX_SECIDS: Record<string, string> = {
  '000001': '1.000001', // 上证指数
  '399001': '0.399001', // 深证成指
  '399006': '0.399006', // 创业板指
  '000016': '1.000016', // 上证50
  '000300': '1.000300', // 沪深300
  '000905': '1.000905', // 中证500
  '000985': '1.000985', // 中证全指
}

export async function fetchIndexTrends(code: string): Promise<{ name: string; trends: TrendPoint[] }> {
  const secid = INDEX_SECIDS[code] ?? (code.startsWith('6') ? `1.${code}` : `0.${code}`)
  const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58`
  const res = await fetch(url, { headers: EM_HEADERS })
  if (!res.ok) throw new Error(`East Money trends: ${res.status}`)
  const json = await res.json()

  const name = toStr(json?.data?.name)
  const preClose = toNum(json?.data?.preClose)
  const trendsRaw = json?.data?.trends as string[] | undefined

  const trends: TrendPoint[] = []
  if (trendsRaw) {
    for (const line of trendsRaw) {
      const parts = line.split(',')
      if (parts.length >= 6) {
        trends.push({
          time: parts[0],
          price: parseFloat(parts[1]) || preClose,
          volume: parseFloat(parts[5]) || 0,
          avgPrice: parseFloat(parts[2]) || preClose,
        })
      }
    }
  }

  return { name, trends }
}

// ── Individual stock quote ───────────────────────────────

export interface StockQuote {
  code: string
  name: string
  price: number
  changePct: number
  changeAmt: number
  volume: number
  turnover: number
  high: number
  low: number
  open: number
  prevClose: number
  marketCap: number
  pe: number
}

export async function fetchStockQuote(stockCode: string): Promise<StockQuote | null> {
  // Try Sina API first (more reliable)
  try {
    const symbol = stockCode.startsWith('6') ? `sh${stockCode}` : `sz${stockCode}`
    const url = `https://hq.sinajs.cn/list=${symbol}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, {
      headers: { ...SINA_HEADERS, Referer: 'https://finance.sina.com.cn/' },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (res.ok) {
      const text = await res.text()
      // Parse Sina format: var hq_str_sz300750="宁德时代,437.000,..."
      const match = text.match(/="([^"]+)"/)
      if (match) {
        const parts = match[1].split(',')
        if (parts.length >= 32) {
          return {
            code: stockCode,
            name: parts[0],
            price: parseFloat(parts[3]) || 0,
            changePct: parseFloat(parts[3]) && parseFloat(parts[2])
              ? ((parseFloat(parts[3]) - parseFloat(parts[2])) / parseFloat(parts[2])) * 100
              : 0,
            changeAmt: parseFloat(parts[3]) && parseFloat(parts[2])
              ? parseFloat(parts[3]) - parseFloat(parts[2])
              : 0,
            volume: parseFloat(parts[8]) || 0,
            turnover: parseFloat(parts[9]) || 0,
            high: parseFloat(parts[4]) || 0,
            low: parseFloat(parts[5]) || 0,
            open: parseFloat(parts[1]) || 0,
            prevClose: parseFloat(parts[2]) || 0,
            marketCap: 0, // Sina doesn't provide market cap in this endpoint
            pe: 0,
          }
        }
      }
    }
  } catch {
    // Fall through to EastMoney
  }

  // Fallback: EastMoney
  try {
    const prefix = stockCode.startsWith('6') ? '1' : '0'
    const secid = `${prefix}.${stockCode}`
    const fields = 'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18,f20,f9'
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secid}&fields=${fields}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, { headers: EM_HEADERS, signal: controller.signal })
    clearTimeout(timeout)

    if (res.ok) {
      const json = await res.json()
      const items = json?.data?.diff as EMIndexItem[] | undefined
      if (items && items.length > 0) {
        const d = items[0]
        return {
          code: toStr(d.f12),
          name: toStr(d.f14),
          price: toNum(d.f2),
          changePct: toNum(d.f3),
          changeAmt: toNum(d.f4),
          volume: toNum(d.f5),
          turnover: toNum(d.f6),
          high: toNum(d.f15),
          low: toNum(d.f16),
          open: toNum(d.f17),
          prevClose: toNum(d.f18),
          marketCap: toNum(d.f20),
          pe: toNum(d.f9),
        }
      }
    }
  } catch {
    // Both failed
  }

  return null
}

// ── Stock K-line history ──────────────────────────────────

export interface KlineBar {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  turnover: number
  amplitude: number
  changePct: number
}

export async function fetchStockKline(
  stockCode: string,
  period: number = 101, // 101=daily, 102=weekly, 103=monthly
  count: number = 30,
): Promise<{ name: string; klines: KlineBar[] }> {
  const prefix = stockCode.startsWith('6') ? '1' : '0'
  const secid = `${prefix}.${stockCode}`

  // Try EastMoney first
  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${period}&fqt=1&end=20500101&lmt=${count}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, { headers: EM_HEADERS, signal: controller.signal })
    clearTimeout(timeout)

    if (res.ok) {
      const json = await res.json()
      const name = toStr(json?.data?.name)
      const klinesRaw = json?.data?.klines as string[] | undefined
      const klines: KlineBar[] = []

      if (klinesRaw && klinesRaw.length > 0) {
        for (const line of klinesRaw) {
          const parts = line.split(',')
          if (parts.length >= 7) {
            klines.push({
              date: parts[0],
              open: parseFloat(parts[1]) || 0,
              close: parseFloat(parts[2]) || 0,
              high: parseFloat(parts[3]) || 0,
              low: parseFloat(parts[4]) || 0,
              volume: parseFloat(parts[5]) || 0,
              turnover: parseFloat(parts[6]) || 0,
              amplitude: parseFloat(parts[7]) || 0,
              changePct: parseFloat(parts[8]) || 0,
            })
          }
        }
        return { name, klines }
      }
    }
  } catch {
    // Fall through to Sina
  }

  // Fallback: Sina API
  const scale = period === 102 ? 1680 : period === 103 ? 7200 : 240
  const symbol = stockCode.startsWith('6') ? `sh${stockCode}` : `sz${stockCode}`
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=${scale}&ma=no&datalen=${count}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  const res = await fetch(url, { headers: SINA_HEADERS, signal: controller.signal })
  clearTimeout(timeout)

  if (!res.ok) throw new Error(`Sina kline failed: ${res.status}`)
  const data = await res.json() as Array<{ day: string; open: string; high: string; low: string; close: string; volume: string }>

  const klines: KlineBar[] = []
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const item = data[i]
      const open = parseFloat(item.open) || 0
      const close = parseFloat(item.close) || 0
      const high = parseFloat(item.high) || 0
      const low = parseFloat(item.low) || 0
      const prevClose = i > 0 ? parseFloat(data[i - 1].close) || close : open
      klines.push({
        date: item.day,
        open,
        close,
        high,
        low,
        volume: parseFloat(item.volume) || 0,
        turnover: 0, // Sina doesn't provide turnover
        amplitude: prevClose ? ((high - low) / prevClose) * 100 : 0,
        changePct: prevClose ? ((close - prevClose) / prevClose) * 100 : 0,
      })
    }
  }

  return { name: '', klines }
}

// ── Stock fundamentals ────────────────────────────────────

export interface StockFundamentals {
  code: string
  name: string
  // Valuation
  pe: number // 市盈率
  pb: number // 市净率
  ps: number // 市销率
  // Profitability
  roe: number // 净资产收益率
  grossMargin: number // 毛利率
  netMargin: number // 净利率
  // Growth
  revenueGrowth: number // 营收增长率
  profitGrowth: number // 净利润增长率
  // Scale
  marketCap: number // 总市值
  circulatingMarketCap: number // 流通市值
  totalShares: number // 总股本
  circulatingShares: number // 流通股本
  // Per share
  eps: number // 每股收益
  bvps: number // 每股净资产
  // Industry
  industry: string // 所属行业
  region: string // 所属地区
  // Other
  turnoverRate: number // 换手率
  volumeRatio: number // 量比
  amplitude: number // 振幅
  debtRatio: number // 资产负债率
}

export async function fetchStockFundamentals(stockCode: string): Promise<StockFundamentals | null> {
  // Try Sina API for basic quote data
  let name = ''
  let price = 0
  let open = 0
  let prevClose = 0
  let high = 0
  let low = 0
  let volume = 0
  let turnover = 0

  try {
    const symbol = stockCode.startsWith('6') ? `sh${stockCode}` : `sz${stockCode}`
    const url = `https://hq.sinajs.cn/list=${symbol}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, {
      headers: { ...SINA_HEADERS, Referer: 'https://finance.sina.com.cn/' },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (res.ok) {
      const text = await res.text()
      const match = text.match(/="([^"]+)"/)
      if (match) {
        const parts = match[1].split(',')
        if (parts.length >= 32) {
          name = parts[0]
          open = parseFloat(parts[1]) || 0
          prevClose = parseFloat(parts[2]) || 0
          price = parseFloat(parts[3]) || 0
          high = parseFloat(parts[4]) || 0
          low = parseFloat(parts[5]) || 0
          volume = parseFloat(parts[8]) || 0
          turnover = parseFloat(parts[9]) || 0
        }
      }
    }
  } catch {
    // Continue
  }

  // EastMoney single-stock snapshot. fltt=2 returns clean decimals.
  // f55 EPS, f50 量比, f84/f85 总/流通股本, f92 BVPS, f116/f117 总/流通市值,
  // f127 行业, f128 地区, f162 PE(动), f164 PE(TTM), f167 PB, f168 换手率,
  // f173 ROE(最新期), f184 营收同比, f185 净利同比, f186 毛利率, f187 净利率,
  // f188 资产负债率
  let em: Record<string, unknown> = {}
  try {
    const prefix = stockCode.startsWith('6') ? '1' : '0'
    const secid = `${prefix}.${stockCode}`
    const fields =
      'f50,f55,f58,f84,f85,f92,f116,f117,f127,f128,f162,f164,f167,f168,f173,f184,f185,f186,f187,f188'
    const url = `https://push2.eastmoney.com/api/qt/stock/get?fltt=2&secid=${secid}&fields=${fields}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, { headers: EM_HEADERS, signal: controller.signal })
    clearTimeout(timeout)

    if (res.ok) {
      const json = await res.json()
      if (json?.data && typeof json.data === 'object') {
        em = json.data as Record<string, unknown>
        // Prefer EM's UTF-8 name: the Sina quote is GBK and decodes to mojibake.
        if (toStr(em.f58)) name = toStr(em.f58)
      }
    }
  } catch {
    // Continue with defaults
  }

  if (!name && !price) return null

  const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0
  const amplitude = prevClose ? ((high - low) / prevClose) * 100 : 0
  const pe = toNum(em.f164) || toNum(em.f162)
  const pb = toNum(em.f167)

  return {
    code: stockCode,
    name,
    pe,
    pb,
    ps: 0, // No direct EM field; left for a future source
    roe: toNum(em.f173),
    grossMargin: toNum(em.f186),
    netMargin: toNum(em.f187),
    revenueGrowth: toNum(em.f184),
    profitGrowth: toNum(em.f185),
    marketCap: toNum(em.f116),
    circulatingMarketCap: toNum(em.f117),
    totalShares: toNum(em.f84),
    circulatingShares: toNum(em.f85),
    eps: toNum(em.f55) || (pe ? price / pe : 0),
    bvps: toNum(em.f92) || (pb ? price / pb : 0),
    industry: toStr(em.f127) || '未知',
    region: toStr(em.f128).replace(/板块$/, '') || '未知',
    turnoverRate: toNum(em.f168),
    volumeRatio: toNum(em.f50),
    amplitude,
    debtRatio: toNum(em.f188),
  }
}

// ── Volume history (past 7 trading days) ──────────────────

// Full-market daily turnover = Shanghai Composite (1.000001, covers all SH incl.
// STAR board) + Shenzhen Component (0.399001, covers all SZ incl. ChiNext). These
// two indices' turnover fields equal the whole-exchange totals, so summing them
// gives the standard 沪深两市成交额 with no double counting. (北证 excluded by design.)
const VOLUME_MARKETS_EM = ['1.000001', '0.399001'] as const
const VOLUME_MARKETS_SINA = ['sh000001', 'sz399001'] as const

/** Fetch one index's 7-day kline from East Money → date → {volume, turnover}. */
async function fetchEMKline(secid: string): Promise<Map<string, { volume: number; turnover: number }>> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&end=20500101&lmt=7`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(url, { headers: EM_HEADERS, signal: controller.signal })
    if (!res.ok) throw new Error(`EM kline ${secid}: ${res.status}`)
    const json = await res.json()
    const klines = json?.data?.klines as string[] | undefined
    if (!klines || klines.length === 0) throw new Error(`EM kline ${secid}: empty`)
    const map = new Map<string, { volume: number; turnover: number }>()
    for (const line of klines) {
      const parts = line.split(',')
      map.set(parts[0] ?? '', {
        volume: parseFloat(parts[5]) || 0,
        turnover: parseFloat(parts[6]) || 0,
      })
    }
    return map
  } finally {
    clearTimeout(timeout)
  }
}

// 指数日线历史的镜像主机(EM 限流时轮换;空 klines 视为失败再换)。
const INDEX_KLINE_HOSTS = ['push2his.eastmoney.com', 'push2delay.eastmoney.com', '1.push2his.eastmoney.com']

/**
 * 取一个指数的日线收盘序列(须传完整 secid 如 '1.000300'；指数前缀与个股不同，
 * 不能用 fetchStockKline 的 startsWith('6') 规则)。镜像主机轮换 + 重试一次。按日期升序返回。
 */
export async function fetchIndexKline(secid: string, count: number): Promise<{ date: string; close: number }[]> {
  // 1) 东财镜像轮换(EM 历史接口偶发返回空 klines)。
  for (const host of INDEX_KLINE_HOSTS) {
    const url = `https://${host}/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&end=20500101&lmt=${count}`
    try {
      const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`EM index kline ${secid}: ${res.status}`)
      const json = await res.json()
      const klines = json?.data?.klines as string[] | undefined
      if (!klines || klines.length === 0) throw new Error(`EM index kline ${secid}: empty`)
      return klines.map((line) => {
        const parts = line.split(',')
        return { date: parts[0] ?? '', close: parseFloat(parts[2]) || 0 }
      })
    } catch {
      /* 试下一个镜像 */
    }
  }
  // 2) Sina 兜底(与 fetchStockKline 同源;secid '1.xxx'→shxxx、'0.xxx'→szxxx)。
  try {
    const [m, code] = secid.split('.')
    const sym = (m === '1' ? 'sh' : 'sz') + code
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=${count}`
    const res = await fetch(url, { headers: SINA_HEADERS, signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const data = (await res.json()) as Array<{ day: string; close: string }>
      if (Array.isArray(data) && data.length) {
        return data.map((d) => ({ date: d.day, close: parseFloat(d.close) || 0 }))
      }
    }
  } catch {
    /* 落到下方抛错 */
  }
  throw new Error(`index kline ${secid}: 东财镜像 + Sina 均失败/为空`)
}

/** Fetch one index's 7-day kline from Sina (no turnover → estimate via avg price). */
async function fetchSinaKline(symbol: string): Promise<Map<string, { volume: number; turnover: number }>> {
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=7`
  const res = await fetch(url, { headers: SINA_HEADERS })
  if (!res.ok) throw new Error(`Sina ${symbol}: ${res.status}`)
  const data = await res.json() as Array<{ day: string; open: string; close: string; volume: string }>
  if (!Array.isArray(data) || data.length === 0) throw new Error(`Sina ${symbol}: empty`)
  const map = new Map<string, { volume: number; turnover: number }>()
  for (const item of data) {
    const volume = parseFloat(item.volume) || 0
    const avgPrice = ((parseFloat(item.open) || 0) + (parseFloat(item.close) || 0)) / 2
    map.set(item.day, { volume, turnover: volume * avgPrice })
  }
  return map
}

/** Merge per-market kline maps, summing volume+turnover per date (full date key). */
function mergeKlineMaps(maps: Map<string, { volume: number; turnover: number }>[]): VolumeRecord[] {
  const dates = new Set<string>()
  for (const m of maps) for (const d of m.keys()) dates.add(d)
  return [...dates]
    .sort()
    .map((fullDate) => {
      let volume = 0
      let turnover = 0
      for (const m of maps) {
        const v = m.get(fullDate)
        if (v) {
          volume += v.volume
          turnover += v.turnover
        }
      }
      const dateParts = fullDate.split('-')
      return { date: `${dateParts[1]}-${dateParts[2]}`, volume, turnover }
    })
}

async function fetchVolumeHistory(): Promise<VolumeRecord[]> {
  // Try East Money kline API first (sum SH + SZ for the two-market total).
  try {
    const maps = await Promise.all(VOLUME_MARKETS_EM.map((s) => fetchEMKline(s)))
    const merged = mergeKlineMaps(maps)
    if (merged.length > 0) {
      console.log('[Volume] East Money kline: merged', merged.length, 'days across', maps.length, 'markets')
      return merged
    }
  } catch (err) {
    console.log('[Volume] East Money kline failed:', err instanceof Error ? err.message : err)
  }

  // Fallback: Sina API (no turnover field, estimated from volume × avg price).
  try {
    console.log('[Volume] Trying Sina fallback...')
    const maps = await Promise.all(VOLUME_MARKETS_SINA.map((s) => fetchSinaKline(s)))
    const merged = mergeKlineMaps(maps)
    console.log('[Volume] Sina fallback: merged', merged.length, 'days across', maps.length, 'markets')
    return merged
  } catch (err) {
    console.log('[Volume] Sina fallback failed:', err instanceof Error ? err.message : err)
    return []
  }
}

// ── Main export ────────────────────────────────────────────

export async function fetchAShareData(): Promise<AShareData> {
  return ashareCache.get()
}

async function fetchAShareDataFresh(): Promise<AShareData> {
  // Fetch indices+breadth from East Money (reliable), limit pools with EM primary + Sina fallback
  // NOTE: highs analysis (per-stock kline scan) is intentionally NOT here — it is
  // slow and lives behind its own /api/highs endpoint so it can never delay or
  // time out the core market data below.
  const [breadthResult, limitUpResult, limitDownResult, promoResult, volumeResult] = await Promise.allSettled([
    fetchIndicesAndBreadth(),
    fetchLimitPool('up').then((r) => {
      if (r.count === 0) throw new Error('EM limit-up empty')
      return r
    }).catch(() => fetchSinaLimitPool('up')),
    fetchLimitPool('down').then((r) => {
      if (r.count === 0) throw new Error('EM limit-down empty')
      return r
    }).catch(() => fetchSinaLimitPool('down')),
    fetchPromotionRate(),
    fetchVolumeHistory(),
  ])

  const breadth = breadthResult.status === 'fulfilled' ? breadthResult.value : { indices: [], advance: 0, decline: 0, flat: 0 }
  const limitUp = limitUpResult.status === 'fulfilled' ? limitUpResult.value : { count: 0, stocks: [] }
  const limitDown = limitDownResult.status === 'fulfilled' ? limitDownResult.value : { count: 0, stocks: [] }
  const promo = promoResult.status === 'fulfilled' ? promoResult.value : { rate: 0, promoted: 0, total: 0 }
  const volumeHistory = volumeResult.status === 'fulfilled' ? volumeResult.value : []

  const data: AShareData = {
    indices: breadth.indices,
    limitUpCount: limitUp.count,
    limitDownCount: limitDown.count,
    limitUpStocks: limitUp.stocks,
    limitDownStocks: limitDown.stocks,
    advance: breadth.advance,
    decline: breadth.decline,
    flat: breadth.flat,
    promotionRate: promo.rate,
    promotedCount: promo.promoted,
    promotionTotal: promo.total,
    volumeHistory,
    // Two-market total = Shanghai Composite (000001) + Shenzhen Component (399001).
    // ChiNext (399006) is a subset of Shenzhen, so it is excluded to avoid double counting.
    totalTurnover: breadth.indices
      .filter((i) => i.code === '000001' || i.code === '399001')
      .reduce((sum, i) => sum + (i.turnover || 0), 0),
  }

  return data
}
