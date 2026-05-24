import { useState, useCallback, useRef } from 'react'

const CACHE_KEY = 'ashare-data-cache'

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

export interface AShareData {
  indices: IndexQuote[]
  limitUpCount: number
  limitDownCount: number
  advance: number
  decline: number
  flat: number
}

export interface AShareResult {
  data: AShareData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

interface CacheEntry {
  data: AShareData
  timestamp: number
}

// ── Profitability score ────────────────────────────────────

export function calcProfitabilityScore(limitUp: number, limitDown: number, advance: number, decline: number): number {
  const limitRatio = limitUp / Math.max(limitDown, 1)
  const adRatio = advance / Math.max(decline, 1)
  const cappedLimit = Math.min(limitRatio, 5)
  const cappedAD = Math.min(adRatio, 5)
  const limitBonus = Math.min(limitUp, 100) / 100
  return Math.round((cappedLimit / 5) * 40 + (cappedAD / 5) * 40 + limitBonus * 20)
}

// ── Cache helpers ──────────────────────────────────────────

function readCache(): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as CacheEntry
  } catch {
    return null
  }
}

function writeCache(data: AShareData) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }))
  } catch {
    // quota exceeded, ignore
  }
}

// ── Mock data ──────────────────────────────────────────────

function getMockData(): AShareData {
  return {
    indices: [
      { code: '000001', name: '上证指数', price: 3350.59, changePct: -0.31, changeAmt: -10.58, volume: 2938192, turnover: 358628340000, high: 3365.2, low: 3340.1, open: 3355.0, prevClose: 3361.17 },
      { code: '399001', name: '深证成指', price: 11121.95, changePct: -0.39, changeAmt: -43.44, volume: 4291266, turnover: 502516180000, high: 11200.0, low: 11080.0, open: 11180.0, prevClose: 11165.39 },
      { code: '399006', name: '创业板指', price: 2175.66, changePct: 0.12, changeAmt: 2.61, volume: 1823456, turnover: 210000000000, high: 2185.0, low: 2165.0, open: 2170.0, prevClose: 2173.05 },
    ],
    limitUpCount: 65,
    limitDownCount: 12,
    advance: 2800,
    decline: 2100,
    flat: 300,
  }
}

// ── Hook ───────────────────────────────────────────────────

export function useAShareData(): AShareResult {
  const cached = readCache()
  const [data, setData] = useState<AShareData | null>(cached?.data ?? null)
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
      const res = await fetch('/api/ashare')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result = await res.json()

      // If API returns empty indices, use mock
      if (!result.indices || result.indices.length === 0) {
        const mock = getMockData()
        setData(mock)
        writeCache(mock)
      } else {
        setData(result)
        writeCache(result)
      }
      setLastUpdated(new Date())
      setError(null)
    } catch {
      // On error, use mock data if no cached data
      if (!data) {
        const mock = getMockData()
        setData(mock)
      }
      setError('Failed to fetch A-share data')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [data])

  return { data, loading, error, lastUpdated, refresh }
}
