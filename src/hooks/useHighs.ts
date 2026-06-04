import { useState, useCallback, useRef, useEffect } from 'react'
import { todayStr, getDay, saveDay } from '../utils/marketHistory'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export interface HighStock {
  code: string
  name: string
  price: number
  changePct: number
  refHigh: number // 参考高点价格（前期高点 或 52周高点）
  gapPct: number // 距该高点 %；<=0 表示已突破
}

export interface HighsData {
  prevHigh: { count: number; stocks: HighStock[] }
  high52w: { count: number; stocks: HighStock[] }
}

export interface HighsResult {
  data: HighsData | null
  loading: boolean
  error: string | null
  refresh: () => void
}

const EMPTY: HighsData = { prevHigh: { count: 0, stocks: [] }, high52w: { count: 0, stocks: [] } }

// The kline scan behind /api/highs is slow, so allow a longer client timeout
// than the default and keep it OFF the critical /api/ashare path.
const HIGHS_TIMEOUT = 20_000

/**
 * Prior-high (前期高点) + 52-week-high (52周高点) analysis for today's strong
 * stocks. Decoupled from useAShareData so the heavy per-stock kline scan never
 * blocks or times out the core market banner. localStorage day-cache + on-demand
 * fetch for today, mirroring useSentiment.
 */
export function useHighs(date: string = todayStr()): HighsResult {
  const isToday = date === todayStr()

  const cachedEntry = getDay(date)
  const cachedData = cachedEntry?.highs as HighsData | undefined
  const [data, setData] = useState<HighsData | null>(cachedData ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetching = useRef(false)

  useEffect(() => {
    let cancelled = false

    const entry = getDay(date)
    const cached = entry?.highs as HighsData | undefined
    if (cached) {
      setData(cached)
      setError(null)
      setLoading(false)
      return
    }

    if (!isToday) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }

    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetchWithTimeout('/api/highs', HIGHS_TIMEOUT)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const result: HighsData = await res.json()
        if (cancelled) return
        setData(result)
        saveDay(date, { highs: result })
        setError(null)
      } catch {
        if (cancelled) return
        setData(EMPTY)
        setError('Failed to fetch highs')
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
      try { await fetch('/api/refresh?market=highs', { method: 'POST' }) } catch { /* ignore */ }
      const res = await fetchWithTimeout('/api/highs', HIGHS_TIMEOUT)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result: HighsData = await res.json()
      setData(result)
      saveDay(date, { highs: result })
      setError(null)
    } catch {
      setError('Failed to fetch highs')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isToday])

  return { data, loading, error, refresh }
}
