import { useState, useCallback, useRef, useEffect } from 'react'
import { todayStr, getDay, saveDay } from '../utils/marketHistory'

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

export interface USData {
  indices: IndexQuote[]
}

export interface USResult {
  data: USData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

function getMockData(): USData {
  return {
    indices: [
      {
        code: 'NVDA',
        name: '英伟达',
        price: 125.38,
        changePct: 3.21,
        changeAmt: 3.90,
        volume: 45678901234,
        turnover: 5678901234567,
        high: 126.5,
        low: 122.0,
        open: 122.5,
        prevClose: 121.48,
      },
      {
        code: 'LITE',
        name: 'Lumentum',
        price: 38.65,
        changePct: -1.52,
        changeAmt: -0.60,
        volume: 2345678901,
        turnover: 98765432100,
        high: 39.8,
        low: 38.2,
        open: 39.5,
        prevClose: 39.25,
      },
      {
        code: 'AMD',
        name: 'AMD',
        price: 162.45,
        changePct: 2.14,
        changeAmt: 3.40,
        volume: 34567890123,
        turnover: 4567890123456,
        high: 163.0,
        low: 159.5,
        open: 160.0,
        prevClose: 159.05,
      },
      {
        code: 'TSM',
        name: '台积电',
        price: 178.92,
        changePct: 0.85,
        changeAmt: 1.50,
        volume: 12345678901,
        turnover: 2345678901234,
        high: 179.5,
        low: 177.0,
        open: 177.5,
        prevClose: 177.42,
      },
    ],
  }
}

export function useUSData(date: string = todayStr()): USResult {
  const isToday = date === todayStr()

  // Initialize from cache
  const cachedEntry = getDay(date)
  const cachedData = cachedEntry?.us as USData | undefined
  const [data, setData] = useState<USData | null>(cachedData ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    cachedData && cachedEntry ? new Date(cachedEntry.timestamp) : null,
  )
  const fetching = useRef(false)
  const dataRef = useRef(data)
  dataRef.current = data

  // When date changes, load from cache or fetch
  useEffect(() => {
    const entry = getDay(date)
    const cached = entry?.us as USData | undefined

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
        const res = await fetch('/api/us')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const result: USData = await res.json()

        if (!result.indices || result.indices.length === 0) {
          const mock = getMockData()
          setData(mock)
          saveDay(date, { us: mock })
        } else {
          setData(result)
          saveDay(date, { us: result })
        }
        setLastUpdated(new Date())
        setError(null)
      } catch {
        if (!dataRef.current) {
          const mock = getMockData()
          setData(mock)
          saveDay(date, { us: mock })
        }
        setError('Failed to fetch US data')
      } finally {
        setLoading(false)
        fetching.current = false
      }
    })()
  }, [date, isToday])

  const refresh = useCallback(async () => {
    if (!isToday || fetching.current) return
    fetching.current = true
    setLoading(true)
    try {
      const res = await fetch('/api/us')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result: USData = await res.json()

      if (!result.indices || result.indices.length === 0) {
        const mock = getMockData()
        setData(mock)
        saveDay(date, { us: mock })
      } else {
        setData(result)
        saveDay(date, { us: result })
      }
      setLastUpdated(new Date())
      setError(null)
    } catch {
      if (!dataRef.current) {
        const mock = getMockData()
        setData(mock)
      }
      setError('Failed to fetch US data')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isToday])

  return { data, loading, error, lastUpdated, refresh }
}
