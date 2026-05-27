// A-share market data fetching from East Money APIs (Sina fallback for limit pools)

const EM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://quote.eastmoney.com/',
}

const SINA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://finance.sina.com.cn/',
}

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

export interface NewHighStock {
  code: string
  name: string
  price: number
  changePct: number
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
  newHighCount: number
  newHighStocks: NewHighStock[]
}

// ── Cache (30s throttle) ───────────────────────────────────

let cachedData: AShareData | null = null
let cacheTimestamp = 0
const CACHE_TTL = 30_000

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
  const fields = 'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18,f104,f105,f106'
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001,0.399006&fields=${fields}`
  const res = await fetch(url, { headers: EM_HEADERS })
  if (!res.ok) throw new Error(`East Money indices: ${res.status}`)
  const json = await res.json()

  const diff = (json?.data?.diff ?? []) as EMIndexItem[]
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
    // Breadth data: accumulate from both Shanghai and Shenzhen
    if (code === '000001' || code === '399001') {
      advance += toNum(item.f104)
      decline += toNum(item.f105)
      flat += toNum(item.f106)
    }
  }

  return { indices, advance, decline, flat }
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

// ── New high count (趋势新高) ──────────────────────────

async function fetchNewHighStocks(): Promise<{ count: number; stocks: NewHighStock[] }> {
  // Fetch all A-shares and find stocks where current price === 52-week high
  const fields = 'f2,f3,f12,f14,f15'
  const fs = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=6000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(fs)}&fields=${fields}`
  const res = await fetch(url, { headers: EM_HEADERS })
  if (!res.ok) return { count: 0, stocks: [] }
  const json = await res.json()
  const diff = (json?.data?.diff ?? []) as EMNewHighItem[]
  const matched = diff.filter((s) => s.f2 != null && s.f15 != null && s.f2 === s.f15)
  const stocks: NewHighStock[] = matched.map((s) => ({
    code: toStr(s.f12),
    name: toStr(s.f14),
    price: toNum(s.f2),
    changePct: toNum(s.f3),
  }))
  return { count: stocks.length, stocks }
}

// ── Main export ────────────────────────────────────────────

export async function fetchAShareData(): Promise<AShareData> {
  const now = Date.now()
  if (cachedData && now - cacheTimestamp < CACHE_TTL) {
    return cachedData
  }

  // Fetch indices+breadth from East Money (reliable), limit pools with EM primary + Sina fallback
  const [breadthResult, limitUpResult, limitDownResult, promoResult, newHighResult] = await Promise.allSettled([
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
    fetchNewHighStocks(),
  ])

  const breadth = breadthResult.status === 'fulfilled' ? breadthResult.value : { indices: [], advance: 0, decline: 0, flat: 0 }
  const limitUp = limitUpResult.status === 'fulfilled' ? limitUpResult.value : { count: 0, stocks: [] }
  const limitDown = limitDownResult.status === 'fulfilled' ? limitDownResult.value : { count: 0, stocks: [] }
  const promo = promoResult.status === 'fulfilled' ? promoResult.value : { rate: 0, promoted: 0, total: 0 }
  const newHigh = newHighResult.status === 'fulfilled' ? newHighResult.value : { count: 0, stocks: [] }

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
    newHighCount: newHigh.count,
    newHighStocks: newHigh.stocks,
  }

  cachedData = data
  cacheTimestamp = now
  return data
}
