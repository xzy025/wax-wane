import { useState, useCallback, useRef, useEffect } from 'react'
import { getLastTradingDay, getDay, saveDay } from '../utils/marketHistory'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export interface HotStock {
  rank: number
  code: string
  name: string
  changePct: number | null
  tags: string[]
  popularityTag?: string
}

export interface DragonTigerStock {
  code: string
  name: string
  changePct: number
  reason: string
  buyAmt: number
  sellAmt: number
  netAmt: number
  explain: string
}

export interface HotListData {
  eastmoney: HotStock[]
  ths: HotStock[]
  dragonTiger: DragonTigerStock[]
  sourceStatus?: {
    eastmoney: HotListSourceStatus
    ths: HotListSourceStatus
    dragonTiger: HotListSourceStatus
  }
}

export interface HotListSourceStatus {
  source: string
  status: 'full' | 'degraded' | 'stale' | 'unavailable'
  warnings: string[]
  missingReasons: string[]
  asOf: string | null
  receivedAt: string | null
}

export interface HotListResult {
  data: HotListData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  status: 'full' | 'degraded' | 'stale' | 'unavailable'
  refresh: () => void
}

function hasObservedSource(data: HotListData): boolean {
  if (data.sourceStatus) {
    return Object.values(data.sourceStatus).some((source) => source.status !== 'unavailable')
  }
  return data.eastmoney.length > 0 || data.ths.length > 0 || data.dragonTiger.length > 0
}

function responseStatus(data: HotListData): HotListResult['status'] {
  if (!hasObservedSource(data)) return 'unavailable'
  return data.sourceStatus && Object.values(data.sourceStatus).some((source) => source.status !== 'full')
    ? 'degraded'
    : 'full'
}

export function useHotList(date: string = getLastTradingDay()): HotListResult {
  const isLatest = date === getLastTradingDay()

  const cachedEntry = getDay(date)
  const cachedData = cachedEntry?.hotlist as HotListData | undefined
  const [data, setData] = useState<HotListData | null>(cachedData ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    cachedData && cachedEntry ? new Date(cachedEntry.timestamp) : null,
  )
  const [status, setStatus] = useState<HotListResult['status']>(cachedData ? (isLatest ? 'stale' : responseStatus(cachedData)) : 'unavailable')
  const fetching = useRef(false)
  const latestData = useRef<HotListData | null>(cachedData ?? null)
  const setCurrentData = useCallback((next: HotListData | null) => {
    latestData.current = next
    setData(next)
  }, [])

  useEffect(() => {
    let cancelled = false

    const entry = getDay(date)
    const cached = entry?.hotlist as HotListData | undefined
    const hasCache = !!cached

    // Show cached data immediately if we have it.
    if (hasCache) {
      setCurrentData(cached!)
      setLastUpdated(entry ? new Date(entry.timestamp) : null)
      setError(null)
      setStatus(isLatest ? 'stale' : responseStatus(cached!))
    }

    // Historical dates are archive-only; never substitute a live/mock ranking.
    if (!isLatest) {
      if (!hasCache) {
        setCurrentData(null)
        setLastUpdated(null)
        setError('No archived hot list data for this date')
        setStatus('unavailable')
      }
      setLoading(false)
      return
    }

    // Today: fetch fresh. With cache present this is a background revalidate
    // (stale-while-revalidate) — cached data stays on screen and is replaced
    // only when fresh data arrives; a failure keeps the cache intact.
    if (fetching.current) return
    fetching.current = true
    if (!hasCache) setLoading(true)
    ;(async () => {
      try {
        const res = await fetchWithTimeout('/api/hotlist')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const result: HotListData = await res.json()
        if (cancelled) return

        if (!hasObservedSource(result)) throw new Error('All hot-list sources unavailable')
        setCurrentData(result)
        if (hasObservedSource(result)) {
          saveDay(date, { hotlist: result })
          setLastUpdated(new Date())
        }
        setStatus(responseStatus(result))
        setError(null)
      } catch {
        if (cancelled) return
        // Keep last-good rankings as stale; never invent a leaderboard.
        setCurrentData(latestData.current)
        setError('Failed to fetch hot list')
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
      // Clear server-side cache first
      try { await fetch('/api/refresh?market=hotlist', { method: 'POST' }) } catch { /* ignore */ }
      const res = await fetchWithTimeout('/api/hotlist')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result: HotListData = await res.json()

      if (!hasObservedSource(result)) throw new Error('All hot-list sources unavailable')
      setCurrentData(result)
      if (hasObservedSource(result)) {
        saveDay(date, { hotlist: result })
        setLastUpdated(new Date())
      }
      setStatus(responseStatus(result))
      setError(null)
    } catch {
      // Keep last-good rankings as stale; never invent a leaderboard.
      setCurrentData(latestData.current)
      setError('Failed to fetch hot list')
      setStatus(latestData.current ? 'stale' : 'unavailable')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isLatest, setCurrentData])

  return { data, loading, error, lastUpdated, status, refresh }
}
