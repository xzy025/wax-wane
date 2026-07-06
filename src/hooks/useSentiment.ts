import { useState, useCallback, useRef, useEffect } from 'react'
import { getLastTradingDay, getDay, saveDay } from '../utils/marketHistory'
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
  /** 服务端三级兜底链的来源标注(kaipanla→东财推导→mock);mock 不落 localStorage。 */
  source?: 'kaipanla' | 'derived' | 'mock'
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
  const fetching = useRef(false)

  useEffect(() => {
    let cancelled = false

    const entry = getDay(date)
    const cached = entry?.sentiment as SentimentData | undefined
    // 历史上误存过 mock(修复前无守卫),读到就当没有:今日走重取,历史日显示空态。
    if (cached && typeof cached.temperature === 'number' && cached.source !== 'mock') {
      setData(cached)
      setLastUpdated(entry ? new Date(entry.timestamp) : null)
      setError(null)
      setLoading(false)
      return
    }

    // Sentiment is an intraday metric; only fetch for the current day.
    if (!isLatest) {
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
        // mock 兜底数据只做当次展示,不写进日存档冒充真实历史情绪。
        if (result.source !== 'mock') saveDay(date, { sentiment: result })
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
  }, [date, isLatest])

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
      setData(result)
      if (result.source !== 'mock') saveDay(date, { sentiment: result })
      setLastUpdated(new Date())
      setError(null)
    } catch {
      setError('Failed to fetch sentiment')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isLatest])

  return { data, loading, error, lastUpdated, refresh }
}
