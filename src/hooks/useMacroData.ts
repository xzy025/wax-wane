import { useState, useCallback, useRef } from 'react'

const CACHE_KEY = 'macro-data-cache'
const TWELVEDATA_BASE = 'https://api.twelvedata.com'
const EXCHANGERATE_BASE = 'https://open.er-api.com/v6/latest/USD'

export interface MacroIndicator {
  id: string
  value: number
  previousClose: number
  unit: string
}

export interface MacroDataResult {
  data: MacroIndicator[]
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

interface CacheEntry {
  data: MacroIndicator[]
  timestamp: number
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

// Previous close defaults (fallback when API doesn't provide)
const PREVIOUS_CLOSE: Record<string, number> = {
  us10y: 4.35,
  us5y: 3.99,
  gold: 3268,
  dxy: 104.2,
  usdcny: 7.238,
  crude: 77.8,
  vix: 19.2,
}

// ── Cache helpers ──────────────────────────────────────────────

function readCache(): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as CacheEntry
  } catch {
    return null
  }
}

function writeCache(data: MacroIndicator[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }))
  } catch {
    // quota exceeded, ignore
  }
}

function loadCache(): MacroIndicator[] {
  const entry = readCache()
  return entry?.data ?? []
}

// ── Mock data ──────────────────────────────────────────────────

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

// ── API fetchers ───────────────────────────────────────────────

// Batch fetch 6 indicators in ONE call via /quotes endpoint (returns close + previous_close)
async function fetchTwelveData(apiKey: string): Promise<MacroIndicator[]> {
  const symbols = Object.keys(TWELVEDATA_MAP).join(',')
  const url = `${TWELVEDATA_BASE}/quotes?symbol=${symbols}&apikey=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Twelve Data: ${res.status}`)
  const json = await res.json()

  const results: MacroIndicator[] = []
  // /quotes returns { data: [ { symbol, close, previous_close, ... }, ... ] }
  const items: Record<string, { close: string; previous_close: string }>[] = json.data ?? []
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

// Single call for USD/CNY (free, no key)
async function fetchUSDCNY(): Promise<MacroIndicator | null> {
  const res = await fetch(EXCHANGERATE_BASE)
  if (!res.ok) return null
  const json = await res.json()
  const cny = json?.rates?.CNY
  if (cny && typeof cny === 'number') {
    return { id: 'usdcny', value: cny, previousClose: PREVIOUS_CLOSE.usdcny, unit: '' }
  }
  return null
}

// ── Main orchestrator ──────────────────────────────────────────

async function fetchAllData(apiKey: string): Promise<MacroIndicator[]> {
  // Fire Twelve Data + ExchangeRate-API in parallel
  const [tdResult, cnyResult] = await Promise.allSettled([
    apiKey ? fetchTwelveData(apiKey) : Promise.resolve([]),
    fetchUSDCNY(),
  ])

  const results: MacroIndicator[] = []
  const foundIds = new Set<string>()

  // Collect Twelve Data results
  if (tdResult.status === 'fulfilled') {
    for (const item of tdResult.value) {
      results.push(item)
      foundIds.add(item.id)
    }
  }

  // Collect USD/CNY
  if (cnyResult.status === 'fulfilled' && cnyResult.value) {
    results.push(cnyResult.value)
    foundIds.add('usdcny')
  }

  // Fill missing with mock fallback
  for (const item of getMockData()) {
    if (!foundIds.has(item.id)) {
      results.push(item)
    }
  }

  return results
}

// ── Hook ───────────────────────────────────────────────────────

export function useMacroData(): MacroDataResult {
  const cached = readCache()
  const [data, setData] = useState<MacroIndicator[]>(cached?.data ?? [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    cached ? new Date(cached.timestamp) : null,
  )
  const fetching = useRef(false)

  const refresh = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    try {
      const apiKey = localStorage.getItem('macro-api-key') ?? ''
      const result = await fetchAllData(apiKey)
      setData(result)
      setLastUpdated(new Date())
      setError(null)
      writeCache(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [])

  return { data, loading, error, lastUpdated, refresh }
}
