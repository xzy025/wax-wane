import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export type ScreenerGroup = 'trigger' | 'breakout'

/** Mirror of server ScreenerCandidate (server/services/screener.ts). */
export interface ScreenerCandidate {
  group: ScreenerGroup
  code: string
  name: string
  price: number
  changePct: number
  pivot: number
  stopLoss: number
  target: number
  rsRaw: number
  coil: number
  trendStrength: number
  volRatio: number
  atrRatio: number
  volScore: number
  distToPivotPct: number
  score: number
  signals: { trendOk: boolean; volDry: boolean; atrContract: boolean; breakoutVol: boolean; pattern: string }
}

export interface ScreenerRegime {
  phase: 'attack' | 'caution' | 'retreat'
  temperature: number
  limitUp: number
  limitDown: number
  breakRate: number
  note: string
}

export interface ScreenerResult {
  asof: string
  regime: ScreenerRegime
  breakout: ScreenerCandidate[]
  trigger: ScreenerCandidate[]
  scanned: number
  universe: number
  truncated: boolean
}

export interface ScreenerHookResult {
  data: ScreenerResult | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  /** Re-run the scan: clears the server cache then re-fetches (the 每日扫描 button). */
  refresh: () => void
}

/**
 * Fetches the 新高战法 screener result from /api/screener. Error policy mirrors
 * useThemes: keep last-good data, surface `error`. The whole-market scan can
 * take ~10-30s on a cold cache, so the fetch timeout is generous.
 */
export function useScreener(): ScreenerHookResult {
  const [data, setData] = useState<ScreenerResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)

  const load = useCallback(async (rescan: boolean) => {
    if (rescan) {
      await fetch('/api/refresh?market=screener', { method: 'POST' }).catch(() => {})
    }
    const res = await fetchWithTimeout('/api/screener', 200_000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as ScreenerResult & { error?: string }
    if (json.error) throw new Error(json.error)
    setData(json)
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
        if (!cancelled) setError('选股数据获取失败')
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
      setError('选股数据获取失败')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}
