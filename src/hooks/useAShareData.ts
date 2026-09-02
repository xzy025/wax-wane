import { useState, useCallback, useRef, useEffect } from 'react'
import { getLastTradingDay, getDay, saveDay } from '../utils/marketHistory'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

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

export interface VolumeRecord {
  date: string
  volume: number
  turnover: number
}

export type MarketDataStatus = 'full' | 'degraded' | 'stale' | 'unavailable'

export interface DataComponentQuality {
  component: string
  source: string
  status: MarketDataStatus
  providerAt: string | null
  receivedAt: string | null
  asOf: string | null
  stale: boolean
  warnings: string[]
  missingReasons: string[]
  derived?: boolean
}

export interface AShareData {
  indices: IndexQuote[]
  limitUpCount: number | null
  limitDownCount: number | null
  advance: number | null
  decline: number | null
  flat: number | null
  promotionRate: number | null
  promotedCount: number | null
  promotionTotal: number | null
  volumeHistory: VolumeRecord[] | null
  /** 沪深两市当日总成交额 (元) = 上证综指 + 深证成指; null if unknown. */
  totalTurnover: number | null
  quality?: {
    indices: DataComponentQuality
    breadth: DataComponentQuality
    limitUp: DataComponentQuality
    limitDown: DataComponentQuality
    promotion: DataComponentQuality
    volume: DataComponentQuality
  }
}

export interface AShareResult {
  data: AShareData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  status: MarketDataStatus
  refresh: () => void
}

// ── Profitability score ────────────────────────────────────

export function calcProfitabilityScore(
  limitUp: number | null,
  limitDown: number | null,
  advance: number | null,
  decline: number | null,
): number | null {
  if (limitUp == null || limitDown == null || advance == null || decline == null) return null
  const limitRatio = limitUp / Math.max(limitDown, 1)
  const adRatio = advance / Math.max(decline, 1)
  const cappedLimit = Math.min(limitRatio, 5)
  const cappedAD = Math.min(adRatio, 5)
  const limitBonus = Math.min(limitUp, 100) / 100
  return Math.round((cappedLimit / 5) * 40 + (cappedAD / 5) * 40 + limitBonus * 20)
}

function isUsable(data: AShareData): boolean {
  return Array.isArray(data.indices) && data.indices.length > 0
}

function responseStatus(data: AShareData): MarketDataStatus {
  if (!isUsable(data)) return 'unavailable'
  const components = data.quality ? Object.values(data.quality) : []
  if (components.some((component) => component.status === 'unavailable' || component.status === 'degraded')) {
    return 'degraded'
  }
  return 'full'
}

// ── Hook ───────────────────────────────────────────────────

export function useAShareData(date: string = getLastTradingDay()): AShareResult {
  const isLatest = date === getLastTradingDay()

  // Initialize from cache (works for both today and past dates)
  const cachedEntry = getDay(date)
  const cachedData = cachedEntry?.ashare as AShareData | undefined
  const [data, setData] = useState<AShareData | null>(cachedData ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(
    !cachedData && !isLatest ? 'No data for this date' : null,
  )
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    cachedData && cachedEntry ? new Date(cachedEntry.timestamp) : null,
  )
  const [status, setStatus] = useState<MarketDataStatus>(
    cachedData ? (isLatest ? 'stale' : responseStatus(cachedData)) : 'unavailable',
  )
  const fetching = useRef(false)
  const latestData = useRef<AShareData | null>(cachedData ?? null)
  const setCurrentData = useCallback((next: AShareData | null) => {
    latestData.current = next
    setData(next)
  }, [])

  // When date changes, load from cache or fetch
  useEffect(() => {
    let cancelled = false

    const entry = getDay(date)
    const cached = entry?.ashare as AShareData | undefined

    // If cached data exists, use it (for both today and past dates)
    if (cached) {
      setCurrentData(cached)
      setLastUpdated(entry ? new Date(entry.timestamp) : null)
      setError(null)
      setStatus(isLatest ? 'stale' : responseStatus(cached))
      setLoading(false)
      return
    }

    // Past date without cache: no data
    if (!isLatest) {
      setCurrentData(null)
      setLastUpdated(null)
      setError('No archived A-share data for this date')
      setStatus('unavailable')
      setLoading(false)
      return
    }

    // Today without cache: fetch fresh data
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetchWithTimeout('/api/ashare')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const result: AShareData = await res.json()
        if (cancelled) return

        if (!isUsable(result)) throw new Error('A-share response did not include index quotes')
        setCurrentData(result)
        saveDay(date, { ashare: result })
        setLastUpdated(new Date())
        setStatus(responseStatus(result))
        setError(null)
      } catch {
        if (cancelled) return
        // Retain only an actual previous observation; never synthesize quotes.
        setCurrentData(latestData.current)
        setError('Failed to fetch A-share data')
        setStatus(latestData.current ? 'stale' : 'unavailable')
      } finally {
        if (!cancelled) {
          setLoading(false)
          fetching.current = false
        }
      }
    })()

    return () => {
      cancelled = true
      fetching.current = false
    }
  }, [date, isLatest, setCurrentData])

  const refresh = useCallback(async () => {
    if (!isLatest || fetching.current) return
    fetching.current = true
    setLoading(true)
    setError(null)
    try {
      // Clear only the A-share server cache first
      try { await fetch('/api/refresh?market=ashare', { method: 'POST' }) } catch { /* ignore */ }
      const res = await fetchWithTimeout('/api/ashare')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result: AShareData = await res.json()

      if (!isUsable(result)) throw new Error('A-share response did not include index quotes')
      setCurrentData(result)
      saveDay(date, { ashare: result })
      setLastUpdated(new Date())
      setStatus(responseStatus(result))
      setError(null)
    } catch {
      // Keep last-good data visible as stale; do not create a placeholder.
      setCurrentData(latestData.current)
      setError('Failed to fetch A-share data')
      setStatus(latestData.current ? 'stale' : 'unavailable')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isLatest, setCurrentData])

  return { data, loading, error, lastUpdated, status, refresh }
}
