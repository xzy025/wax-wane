import { useState, useCallback, useRef, useEffect } from 'react'
import { todayStr, getDay, saveDay } from '../utils/marketHistory'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

interface IndexQuote {
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

export interface HKData {
  indices: IndexQuote[]
}

export interface HKResult {
  data: HKData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

function getMockData(): HKData {
  return {
    indices: [
      {
        code: 'HSI',
        name: '恒生指数',
        price: 18258.65,
        changePct: 1.23,
        changeAmt: 221.98,
        volume: 1234567890,
        turnover: 98765432100,
        high: 18320.0,
        low: 18100.0,
        open: 18150.0,
        prevClose: 18036.67,
      },
      {
        code: 'HSTECH',
        name: '恒生科技',
        price: 3856.42,
        changePct: 2.56,
        changeAmt: 96.14,
        volume: 987654321,
        turnover: 76543210000,
        high: 3880.0,
        low: 3800.0,
        open: 3810.0,
        prevClose: 3760.28,
      },
      {
        code: 'HCINT',
        name: '中概互联',
        price: 6542.18,
        changePct: -0.82,
        changeAmt: -54.12,
        volume: 567890123,
        turnover: 45678901234,
        high: 6600.0,
        low: 6520.0,
        open: 6580.0,
        prevClose: 6596.3,
      },
    ],
  }
}

export function useHKData(date: string = todayStr()): HKResult {
  const isToday = date === todayStr()

  // Initialize from cache
  const cachedEntry = getDay(date)
  const cachedData = cachedEntry?.hk as HKData | undefined
  const [data, setData] = useState<HKData | null>(cachedData ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    cachedData && cachedEntry ? new Date(cachedEntry.timestamp) : null,
  )
  const fetching = useRef(false)

  // When date changes, load from cache or fetch
  useEffect(() => {
    let cancelled = false

    const entry = getDay(date)
    const cached = entry?.hk as HKData | undefined

    // If cached data exists, use it
    if (cached && cached.indices && cached.indices.length > 0) {
      setData(cached)
      setLastUpdated(entry ? new Date(entry.timestamp) : null)
      setError(null)
      setLoading(false)
      return
    }

    // Past date without cache: use mock
    if (!isToday) {
      const mock = getMockData()
      setData(mock)
      setLastUpdated(null)
      setError(null)
      setLoading(false)
      return
    }

    // Today without cache: fetch fresh data
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetchWithTimeout('/api/hk')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const result: HKData = await res.json()
        if (cancelled) return

        if (!result.indices || result.indices.length === 0) {
          const mock = getMockData()
          setData(mock)
          saveDay(date, { hk: mock })
        } else {
          setData(result)
          saveDay(date, { hk: result })
        }
        setLastUpdated(new Date())
        setError(null)
      } catch {
        if (cancelled) return
        const mock = getMockData()
        setData(mock)
        saveDay(date, { hk: mock })
        setError('Failed to fetch HK data')
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
      const res = await fetchWithTimeout('/api/hk')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result: HKData = await res.json()

      if (!result.indices || result.indices.length === 0) {
        const mock = getMockData()
        setData(mock)
        saveDay(date, { hk: mock })
      } else {
        setData(result)
        saveDay(date, { hk: result })
      }
      setLastUpdated(new Date())
      setError(null)
    } catch {
      const mock = getMockData()
      setData(mock)
      saveDay(date, { hk: mock })
      setError('Failed to fetch HK data')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isToday])

  return { data, loading, error, lastUpdated, refresh }
}
