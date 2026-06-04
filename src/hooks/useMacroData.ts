import { useState, useCallback, useRef, useEffect } from 'react'
import { todayStr, getDay, saveDay } from '../utils/marketHistory'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export interface MacroIndicator {
  id: string
  value: number
  previousClose: number
  unit: string
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

export function useMacroData(date: string = todayStr()): MacroDataResult {
  const isToday = date === todayStr()

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
    if (!isToday) {
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
        saveDay(date, { macro: result })
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
  }, [date, isToday])

  const refresh = useCallback(async () => {
    if (!isToday || fetching.current) return
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
      saveDay(date, { macro: result })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isToday])

  return { data, loading, error, lastUpdated, refresh }
}
