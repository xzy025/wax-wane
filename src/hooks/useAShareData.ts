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

export interface AShareData {
  indices: IndexQuote[]
  limitUpCount: number
  limitDownCount: number
  advance: number
  decline: number
  flat: number
  promotionRate: number
  promotedCount: number
  promotionTotal: number
  volumeHistory: VolumeRecord[]
  /** 沪深两市当日总成交额 (元) = 上证综指 + 深证成指. May be absent in cached older data. */
  totalTurnover?: number
}

export interface AShareResult {
  data: AShareData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

// ── Profitability score ────────────────────────────────────

export function calcProfitabilityScore(
  limitUp: number,
  limitDown: number,
  advance: number,
  decline: number,
): number {
  const limitRatio = limitUp / Math.max(limitDown, 1)
  const adRatio = advance / Math.max(decline, 1)
  const cappedLimit = Math.min(limitRatio, 5)
  const cappedAD = Math.min(adRatio, 5)
  const limitBonus = Math.min(limitUp, 100) / 100
  return Math.round((cappedLimit / 5) * 40 + (cappedAD / 5) * 40 + limitBonus * 20)
}

// ── Mock data ──────────────────────────────────────────────

function getMockData(): AShareData {
  return {
    indices: [
      {
        code: '000001',
        name: '上证指数',
        price: 3350.59,
        changePct: -0.31,
        changeAmt: -10.58,
        volume: 2938192,
        turnover: 358628340000,
        high: 3365.2,
        low: 3340.1,
        open: 3355.0,
        prevClose: 3361.17,
      },
      {
        code: '399001',
        name: '深证成指',
        price: 11121.95,
        changePct: -0.39,
        changeAmt: -43.44,
        volume: 4291266,
        turnover: 502516180000,
        high: 11200.0,
        low: 11080.0,
        open: 11180.0,
        prevClose: 11165.39,
      },
      {
        code: '399006',
        name: '创业板指',
        price: 2175.66,
        changePct: 0.12,
        changeAmt: 2.61,
        volume: 1823456,
        turnover: 210000000000,
        high: 2185.0,
        low: 2165.0,
        open: 2170.0,
        prevClose: 2173.05,
      },
      {
        code: '000688',
        name: '科创50',
        price: 986.45,
        changePct: 0.85,
        changeAmt: 8.32,
        volume: 856234,
        turnover: 98000000000,
        high: 992.0,
        low: 978.0,
        open: 980.0,
        prevClose: 978.13,
      },
      {
        code: '899050',
        name: '北证50',
        price: 1025.38,
        changePct: 1.23,
        changeAmt: 12.46,
        volume: 423156,
        turnover: 32000000000,
        high: 1030.0,
        low: 1015.0,
        open: 1018.0,
        prevClose: 1012.92,
      },
    ],
    limitUpCount: 65,
    limitDownCount: 12,
    advance: 2800,
    decline: 2100,
    flat: 300,
    promotionRate: 35,
    promotedCount: 21,
    promotionTotal: 60,
    volumeHistory: [
      { date: '05-23', volume: 18234567, turnover: 2876543210000 },
      { date: '05-26', volume: 21123456, turnover: 3234567890000 },
      { date: '05-27', volume: 16987654, turnover: 2676543210000 },
      { date: '05-28', volume: 22234567, turnover: 3434567890000 },
      { date: '05-29', volume: 19876543, turnover: 3098765432000 },
      { date: '05-30', volume: 20543210, turnover: 3156789012000 },
      { date: '05-31', volume: 23052654, turnover: 3071144520000 },
    ],
  }
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
  const fetching = useRef(false)

  // When date changes, load from cache or fetch
  useEffect(() => {
    let cancelled = false

    const entry = getDay(date)
    const cached = entry?.ashare as AShareData | undefined

    // If cached data exists, use it (for both today and past dates)
    if (cached) {
      setData(cached)
      setLastUpdated(entry ? new Date(entry.timestamp) : null)
      setError(null)
      setLoading(false)
      return
    }

    // Past date without cache: no data
    if (!isLatest) {
      setData(null)
      setLastUpdated(null)
      setError('No data for this date')
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

        if (!result.indices || result.indices.length === 0) {
          // Placeholder only; do not persist mock so the cache stays clean.
          setData((prev) => prev ?? getMockData())
        } else {
          setData(result)
          saveDay(date, { ashare: result })
          setLastUpdated(new Date())
        }
        setError(null)
      } catch {
        if (cancelled) return
        // Don't overwrite good data with mock; only placeholder if empty.
        setData((prev) => prev ?? getMockData())
        setError('Failed to fetch A-share data')
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
  }, [date, isLatest])

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

      if (!result.indices || result.indices.length === 0) {
        setData((prev) => prev ?? getMockData())
      } else {
        setData(result)
        saveDay(date, { ashare: result })
        setLastUpdated(new Date())
      }
      setError(null)
    } catch {
      // Keep the last good data; just surface the error (e.g. rate-limited).
      setData((prev) => prev ?? getMockData())
      setError('Failed to fetch A-share data')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isLatest])

  return { data, loading, error, lastUpdated, refresh }
}
