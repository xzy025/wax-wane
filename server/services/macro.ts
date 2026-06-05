// Macroeconomic data fetching from Twelve Data + ExchangeRate-API

import { createCache } from '../lib/cache'

const TWELVEDATA_BASE = 'https://api.twelvedata.com'
const EXCHANGERATE_BASE = 'https://open.er-api.com/v6/latest/USD'

export interface MacroIndicator {
  id: string
  value: number
  previousClose: number
  unit: string
}

// Twelve Data symbol -> our internal id + unit
const TWELVEDATA_MAP: Record<string, { id: string; unit: string }> = {
  TNX: { id: 'us10y', unit: '%' },
  FVX: { id: 'us5y', unit: '%' },
  'XAU/USD': { id: 'gold', unit: 'USD/oz' },
  DXY: { id: 'dxy', unit: '' },
  CL: { id: 'crude', unit: 'USD/桶' },
  VIX: { id: 'vix', unit: '' },
}

const PREVIOUS_CLOSE: Record<string, number> = {
  us10y: 4.35,
  us5y: 3.99,
  gold: 3268,
  dxy: 104.2,
  usdcny: 7.238,
  crude: 77.8,
  vix: 19.2,
}

// ── Mock data (fallback) ──────────────────────────────────

function getMockData(): MacroIndicator[] {
  const jitter = () => (Math.random() - 0.5) * 0.04
  return [
    { id: 'us10y', value: 4.38 + jitter(), previousClose: PREVIOUS_CLOSE.us10y, unit: '%' },
    { id: 'us5y', value: 4.02 + jitter(), previousClose: PREVIOUS_CLOSE.us5y, unit: '%' },
    { id: 'gold', value: 3285 + jitter() * 100, previousClose: PREVIOUS_CLOSE.gold, unit: 'USD/oz' },
    { id: 'dxy', value: 104.5 + jitter() * 5, previousClose: PREVIOUS_CLOSE.dxy, unit: '' },
    { id: 'usdcny', value: 7.245 + jitter() * 0.2, previousClose: PREVIOUS_CLOSE.usdcny, unit: '' },
    { id: 'crude', value: 78.5 + jitter() * 5, previousClose: PREVIOUS_CLOSE.crude, unit: 'USD/桶' },
    { id: 'vix', value: 18.5 + jitter() * 3, previousClose: PREVIOUS_CLOSE.vix, unit: '' },
  ]
}

// ── API fetchers ─────────────────────────────────────────

interface TwelveDataQuote {
  readonly symbol: string
  readonly close: string
  readonly previous_close: string
}

interface TwelveDataResponse {
  readonly data?: readonly TwelveDataQuote[]
}

async function fetchTwelveData(apiKey: string): Promise<MacroIndicator[]> {
  const symbols = Object.keys(TWELVEDATA_MAP).join(',')
  const url = `${TWELVEDATA_BASE}/quotes?symbol=${symbols}&apikey=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Twelve Data: ${res.status}`)
  const json: TwelveDataResponse = await res.json()

  const results: MacroIndicator[] = []
  const items = json.data ?? []
  for (const item of items) {
    const meta = TWELVEDATA_MAP[item.symbol]
    if (!meta) continue
    const value = parseFloat(item.close)
    const prev = parseFloat(item.previous_close)
    if (!isNaN(value)) {
      results.push({
        id: meta.id,
        value,
        previousClose: isNaN(prev) ? (PREVIOUS_CLOSE[meta.id] ?? value) : prev,
        unit: meta.unit,
      })
    }
  }
  return results
}

interface ExchangeRateResponse {
  readonly rates?: { readonly CNY?: number }
}

async function fetchUSDCNY(): Promise<MacroIndicator | null> {
  const res = await fetch(EXCHANGERATE_BASE)
  if (!res.ok) return null
  const json: ExchangeRateResponse = await res.json()
  const cny = json.rates?.CNY
  if (cny && typeof cny === 'number') {
    return { id: 'usdcny', value: cny, previousClose: PREVIOUS_CLOSE.usdcny, unit: '' }
  }
  return null
}

async function fetchAllData(apiKey: string): Promise<MacroIndicator[]> {
  const [tdResult, cnyResult] = await Promise.allSettled([
    apiKey ? fetchTwelveData(apiKey) : Promise.resolve([]),
    fetchUSDCNY(),
  ])

  const results: MacroIndicator[] = []
  const foundIds = new Set<string>()

  if (tdResult.status === 'fulfilled') {
    for (const item of tdResult.value) {
      results.push(item)
      foundIds.add(item.id)
    }
  }

  if (cnyResult.status === 'fulfilled' && cnyResult.value) {
    results.push(cnyResult.value)
    foundIds.add('usdcny')
  }

  for (const item of getMockData()) {
    if (!foundIds.has(item.id)) {
      results.push(item)
    }
  }

  return results
}

// ── Cache (30s) ──────────────────────────────────────────

// Twelve Data's free tier is tightly rate-limited (≈8 calls/min, 800/day),
// so cache for 5 minutes regardless of session.
const macroCache = createCache<MacroIndicator[]>({
  name: 'Macro',
  ttl: 5 * 60_000,
  fetcher: () => fetchAllData(process.env.TWELVE_DATA_API_KEY ?? ''),
})

export function clearMacroCache() {
  macroCache.clear()
}

export async function fetchMacroData(): Promise<MacroIndicator[]> {
  return macroCache.get()
}
