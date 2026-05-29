import { useState, useCallback, useRef, useEffect } from 'react'
import { todayStr, getDay, saveDay } from '../utils/marketHistory'

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

// ── Fetch from backend (no API key exposed to client) ─────

async function fetchFromBackend(): Promise<MacroIndicator[]> {
  const res = await fetch('/api/mcp/macro/indicators')
  if (!res.ok) throw new Error(`Macro API: ${res.status}`)
  return res.json()
}

// ── Hook ───────────────────────────────────────────────────────

export function useMacroData(date: string = todayStr()): MacroDataResult {
  const isToday = date === todayStr()

  // Initialize from history if viewing a past date
  const initial = !isToday ? ((getDay(date)?.macro as MacroIndicator[] | undefined) ?? []) : []
  const [data, setData] = useState<MacroIndicator[]>(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    !isToday && initial.length > 0 ? new Date(getDay(date)?.timestamp ?? Date.now()) : null,
  )
  const fetching = useRef(false)

  // When date changes, load from history or fetch
  useEffect(() => {
    if (!isToday) {
      const entry = getDay(date)
      const historical = entry?.macro as MacroIndicator[] | undefined
      setData(historical ?? [])
      setLastUpdated(historical && entry ? new Date(entry.timestamp) : null)
      setError(historical ? null : 'No data for this date')
      setLoading(false)
      return
    }

    // Today: fetch from backend (API key stays on server)
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
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
    })()
  }, [date, isToday])

  const refresh = useCallback(async () => {
    if (!isToday || fetching.current) return
    fetching.current = true
    setLoading(true)
    try {
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
