import { useState, useCallback, useRef, useEffect } from 'react'
import { todayStr, getDay, saveDay } from '../utils/marketHistory'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export interface SentimentData {
  date: string
  limitUp: number
  limitDown: number
  breakRate: number
  riseCount: number
  fallCount: number
  yestLimitPerf: number
  temperature: number
}

export interface SentimentResult {
  data: SentimentData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

/**
 * Market sentiment thermometer (开盘啦 via /api/sentiment).
 * Mirrors useHotList: localStorage day-cache + on-demand fetch for today,
 * with a server-cache-clearing refresh.
 */
export function useSentiment(date: string = todayStr()): SentimentResult {
  const isToday = date === todayStr()

  const cachedEntry = getDay(date)
  const cachedData = cachedEntry?.sentiment as SentimentData | undefined
  const [data, setData] = useState<SentimentData | null>(cachedData ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    cachedData && cachedEntry ? new Date(cachedEntry.timestamp) : null,
  )
  const fetching = useRef(false)

  useEffect(() => {
    let cancelled = false

    const entry = getDay(date)
    const cached = entry?.sentiment as SentimentData | undefined
    if (cached && typeof cached.temperature === 'number') {
      setData(cached)
      setLastUpdated(entry ? new Date(entry.timestamp) : null)
      setError(null)
      setLoading(false)
      return
    }

    // Sentiment is an intraday metric; only fetch for the current day.
    if (!isToday) {
      setData(null)
      setLastUpdated(null)
      setError(null)
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
        setData(result)
        saveDay(date, { sentiment: result })
        setLastUpdated(new Date())
        setError(null)
      } catch {
        if (cancelled) return
        setError('Failed to fetch sentiment')
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
  }, [date, isToday])

  const refresh = useCallback(async () => {
    if (!isToday || fetching.current) return
    fetching.current = true
    setLoading(true)
    setError(null)
    try {
      try { await fetch('/api/refresh?market=sentiment', { method: 'POST' }) } catch { /* ignore */ }
      const res = await fetchWithTimeout('/api/sentiment')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result: SentimentData = await res.json()
      setData(result)
      saveDay(date, { sentiment: result })
      setLastUpdated(new Date())
      setError(null)
    } catch {
      setError('Failed to fetch sentiment')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isToday])

  return { data, loading, error, lastUpdated, refresh }
}
