import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export interface ThemeRow {
  code: string
  name: string
  label: string
  price: number
  changePct: number
  pe: number | null
  pb: number | null
  marketCap: number
  chg60: number | null
  chgYtd: number | null
  found: boolean
}

export interface ThemeSummary {
  count: number
  avgChangePct: number
  upCount: number
  downCount: number
  leader: { name: string; changePct: number } | null
}

export interface ThemeBlock {
  id: string
  name: string
  nameEn: string
  blurb: string
  summary: ThemeSummary
  constituents: ThemeRow[]
}

export interface ThemesResult {
  themes: ThemeBlock[] | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

/**
 * Fetches the 题材 (theme/sector) comparison data from /api/themes.
 * Error policy mirrors useMarketData: a failed fetch keeps the last good data
 * and surfaces `error` instead of blanking the view.
 */
export function useThemes(): ThemesResult {
  const [themes, setThemes] = useState<ThemeBlock[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)

  const load = useCallback(async (clearServerCache: boolean) => {
    if (clearServerCache) {
      await fetch('/api/refresh?market=themes', { method: 'POST' }).catch(() => {})
    }
    const res = await fetchWithTimeout('/api/themes')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { themes?: ThemeBlock[] }
    setThemes(json.themes ?? [])
    setLastUpdated(new Date())
    setError(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        await load(false)
      } catch {
        if (!cancelled) setError('Failed to fetch themes')
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
  }, [load])

  const refresh = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    setError(null)
    try {
      await load(true)
    } catch {
      setError('Failed to fetch themes')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { themes, loading, error, lastUpdated, refresh }
}
