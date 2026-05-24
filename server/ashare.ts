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

export interface AShareData {
  indices: IndexQuote[]
  limitUpCount: number
  limitDownCount: number
  limitUpStocks: LimitStock[]
  limitDownStocks: LimitStock[]
  advance: number
  decline: number
  flat: number
}

// ── Cache (30s throttle) ───────────────────────────────────

let cachedData: AShareData | null = null
let cacheTimestamp = 0
const CACHE_TTL = 30_000

// ── Fetchers ───────────────────────────────────────────────

async function fetchIndicesAndBreadth(): Promise<{ indices: IndexQuote[]; advance: number; decline: number; flat: number }> {
  const fields = 'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18,f104,f105,f106'
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001,0.399006&fields=${fields}`
  const res = await fetch(url, { headers: EM_HEADERS })
  if (!res.ok) throw new Error(`East Money indices: ${res.status}`)
  const json = await res.json()

  const diff: Record<string, unknown>[] = json?.data?.diff ?? []
  const indices: IndexQuote[] = []
  let advance = 0
  let decline = 0
  let flat = 0

  for (const item of diff) {
    const code = item.f12 as string
    if (['000001', '399001', '399006'].includes(code)) {
      indices.push({
        code,
        name: item.f14 as string,
        price: item.f2 as number,
        changePct: item.f3 as number,
        changeAmt: item.f4 as number,
        volume: item.f5 as number,
        turnover: item.f6 as number,
        high: item.f15 as number,
        low: item.f16 as number,
        open: item.f17 as number,
        prevClose: item.f18 as number,
      })
    }
    // Breadth data is on the first item (Shanghai index)
    if (code === '000001') {
      advance = (item.f104 as number) ?? 0
      decline = (item.f105 as number) ?? 0
      flat = (item.f106 as number) ?? 0
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

  const pool: Record<string, unknown>[] = json?.data?.pool ?? []
  const count = (json?.data?.tc as number) ?? pool.length
  const stocks: LimitStock[] = pool.map((item) => ({
    code: item.c as string,
    name: item.n as string,
    price: item.p as number,
    changePct: item.zdp as number,
    turnoverRate: item.hs as number,
    amount: item.amount as number,
    firstTime: item.fbt as string,
    lastTime: item.lbt as string,
    openCount: item.zbc as number,
    consecutiveDays: item.lbc as number,
    industry: item.hybk as string,
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

// ── Main export ────────────────────────────────────────────

export async function fetchAShareData(): Promise<AShareData> {
  const now = Date.now()
  if (cachedData && now - cacheTimestamp < CACHE_TTL) {
    return cachedData
  }

  // Fetch indices+breadth from East Money (reliable), limit pools with EM primary + Sina fallback
  const [breadthResult, limitUpResult, limitDownResult] = await Promise.allSettled([
    fetchIndicesAndBreadth(),
    fetchLimitPool('up').then((r) => {
      if (r.count === 0) throw new Error('EM limit-up empty')
      return r
    }).catch(() => fetchSinaLimitPool('up')),
    fetchLimitPool('down').then((r) => {
      if (r.count === 0) throw new Error('EM limit-down empty')
      return r
    }).catch(() => fetchSinaLimitPool('down')),
  ])

  const breadth = breadthResult.status === 'fulfilled' ? breadthResult.value : { indices: [], advance: 0, decline: 0, flat: 0 }
  const limitUp = limitUpResult.status === 'fulfilled' ? limitUpResult.value : { count: 0, stocks: [] }
  const limitDown = limitDownResult.status === 'fulfilled' ? limitDownResult.value : { count: 0, stocks: [] }

  const data: AShareData = {
    indices: breadth.indices,
    limitUpCount: limitUp.count,
    limitDownCount: limitDown.count,
    limitUpStocks: limitUp.stocks,
    limitDownStocks: limitDown.stocks,
    advance: breadth.advance,
    decline: breadth.decline,
    flat: breadth.flat,
  }

  cachedData = data
  cacheTimestamp = now
  return data
}
