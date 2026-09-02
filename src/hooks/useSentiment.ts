import { useState, useCallback, useRef, useEffect } from 'react'
import { getLastTradingDay, getDay, saveDay } from '../utils/marketHistory'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export interface SentimentData {
  date: string
  limitUp: number | null
  limitDown: number | null
  breakRate: number | null
  riseCount: number | null
  fallCount: number | null
  yestLimitPerf: number | null
  temperature: number | null
  coverage?: number
  status?: 'full' | 'degraded' | 'stale' | 'unavailable'
  missingReasons?: string[]
  warnings?: string[]
  /** 服务端来源标注：开盘啦原始或由真实 A 股宽度/涨跌停推导。 */
  source?: 'kaipanla' | 'derived'
}

export interface SentimentResult {
  data: SentimentData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  status: 'full' | 'degraded' | 'stale' | 'unavailable'
  refresh: () => void
}

/**
 * Market sentiment thermometer (开盘啦 via /api/sentiment).
 * Mirrors useHotList: localStorage day-cache + on-demand fetch for today,
 * with a server-cache-clearing refresh.
 */
export function useSentiment(date: string = getLastTradingDay()): SentimentResult {
  const isLatest = date === getLastTradingDay()

  const cachedEntry = getDay(date)
  const cachedData = cachedEntry?.sentiment as SentimentData | undefined
  const [data, setData] = useState<SentimentData | null>(cachedData ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    cachedData && cachedEntry ? new Date(cachedEntry.timestamp) : null,
  )
  const [status, setStatus] = useState<SentimentResult['status']>(cachedData ? 'stale' : 'unavailable')
  const fetching = useRef(false)
  const latestData = useRef<SentimentData | null>(cachedData ?? null)
  const setCurrentData = useCallback((next: SentimentData | null) => {
    latestData.current = next
    setData(next)
  }, [])

  useEffect(() => {
    let cancelled = false

    const entry = getDay(date)
    const cached = entry?.sentiment as SentimentData | undefined
    // 修复前可能存过 source=mock 的旧缓存；不再把它当市场事实使用。
    if (cached && typeof cached.temperature !== 'undefined' && (cached as { source?: string }).source !== 'mock') {
      setCurrentData(cached)
      setLastUpdated(entry ? new Date(entry.timestamp) : null)
      setError(null)
      setStatus(cached.status ?? (isLatest ? 'stale' : 'full'))
      setLoading(false)
      return
    }

    // Sentiment is an intraday metric; only fetch for the current day.
    if (!isLatest) {
      setCurrentData(null)
      setLastUpdated(null)
      setError('No archived sentiment data for this date')
      setStatus('unavailable')
      setLoading(false)
      return
    }

    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetchWithTimeout('/api/sentiment')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const result: SentimentData = await res.json()
        if (cancelled) return
        setCurrentData(result)
        if (result.status !== 'unavailable') saveDay(date, { sentiment: result })
        setLastUpdated(new Date())
        setStatus(result.status ?? 'full')
        setError(null)
      } catch {
        if (cancelled) return
        setError('Failed to fetch sentiment')
        setCurrentData(latestData.current)
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
      try { await fetch('/api/refresh?market=sentiment', { method: 'POST' }) } catch { /* ignore */ }
      const res = await fetchWithTimeout('/api/sentiment')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result: SentimentData = await res.json()
      setCurrentData(result)
      if (result.status !== 'unavailable') saveDay(date, { sentiment: result })
      setLastUpdated(new Date())
      setStatus(result.status ?? 'full')
      setError(null)
    } catch {
      setCurrentData(latestData.current)
      setError('Failed to fetch sentiment')
      setStatus(latestData.current ? 'stale' : 'unavailable')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isLatest, setCurrentData])

  return { data, loading, error, lastUpdated, status, refresh }
}
