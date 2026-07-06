import { useState, useCallback, useRef, useEffect } from 'react'
import { getLastTradingDay, getDay, saveDay } from '../utils/marketHistory'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export interface MacroIndicator {
  id: string
  value: number
  previousClose: number
  unit: string
  /** 服务端来源标注:live=真实上游,mock=占位假数(不落 localStorage 日存档)。 */
  source?: 'live' | 'mock'
}

/** mock 占位指标只做当次展示,过滤后再落日存档,避免假数冒充真实历史。 */
function realOnly(indicators: MacroIndicator[]): MacroIndicator[] {
  return indicators.filter((i) => i.source !== 'mock')
}

export interface MacroDataResult {
  data: MacroIndicator[]
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

async function fetchFromBackend(): Promise<MacroIndicator[]> {
  const res = await fetchWithTimeout('/api/mcp/macro/indicators')
  if (!res.ok) throw new Error(`Macro API: ${res.status}`)
  return res.json()
}

// ── Hook ───────────────────────────────────────────────────────

export function useMacroData(date: string = getLastTradingDay()): MacroDataResult {
  const isLatest = date === getLastTradingDay()

  // Initialize from cache (works for both today and past dates)
  const cachedEntry = getDay(date)
  const cachedData = cachedEntry?.macro as MacroIndicator[] | undefined
  const [data, setData] = useState<MacroIndicator[]>(cachedData ?? [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    cachedData && cachedData.length > 0 && cachedEntry ? new Date(cachedEntry.timestamp) : null,
  )
  const fetching = useRef(false)

  // When date changes, load from cache or fetch
  useEffect(() => {
    let cancelled = false

    const entry = getDay(date)
    const cached = entry?.macro as MacroIndicator[] | undefined

    // If cached data exists, use it (for both today and past dates)
    if (cached && cached.length > 0) {
      setData(cached)
      setLastUpdated(entry ? new Date(entry.timestamp) : null)
      setError(null)
      setLoading(false)
      return
    }

    // Past date without cache: no data
    if (!isLatest) {
      setData([])
      setLastUpdated(null)
      setError('No data for this date')
      setLoading(false)
      return
    }

    // Today without cache: fetch from backend
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        const result = await fetchFromBackend()
        if (cancelled) return
        setData(result)
        setLastUpdated(new Date())
        setError(null)
        const real = realOnly(result)
        if (real.length > 0) saveDay(date, { macro: real })
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Unknown error')
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
      // Clear only the macro server cache first
      try { await fetch('/api/refresh?market=macro', { method: 'POST' }) } catch { /* ignore */ }
      const result = await fetchFromBackend()
      setData(result)
      setLastUpdated(new Date())
      setError(null)
      const real = realOnly(result)
      if (real.length > 0) saveDay(date, { macro: real })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isLatest])

  return { data, loading, error, lastUpdated, refresh }
}
