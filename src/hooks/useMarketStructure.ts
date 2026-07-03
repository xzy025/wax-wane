import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

/** Mirror of server MarketStructureBoard (server/services/marketStructure.ts). */
export interface MarketStructureBoard {
  code: string
  name: string
  longChg: number
  shortChg: number
  todayChg: number
}

/** Mirror of server MarketStructureSummary. */
export interface MarketStructureSummary {
  asof: string
  generatedAt: string
  limitUp: number
  limitDown: number
  advanceCount: number
  declineCount: number
  breakRate: number
  boardTotal: number
  hsCount: number
  lsCount: number
  hwCount: number
  lwCount: number
  shortUpPct: number
  topHs: MarketStructureBoard[]
  topLs: MarketStructureBoard[]
  fromCache?: boolean
}

export interface MarketStructureHookResult {
  data: MarketStructureSummary | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  /** Re-run the daily structure snapshot: clears the server cache then re-fetches. Resolves true on success. */
  refresh: () => Promise<boolean>
}

/** Fetches the 每日市场结构(板块集中度/抱团象限)快照 from /api/screener/market-structure. */
export function useMarketStructure(): MarketStructureHookResult {
  const [data, setData] = useState<MarketStructureSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)

  const load = useCallback(async (rescan: boolean) => {
    if (rescan) {
      await fetch('/api/refresh?market=market-structure', { method: 'POST' }).catch(() => {})
    }
    const res = await fetchWithTimeout('/api/screener/market-structure', 60_000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as MarketStructureSummary & { error?: string }
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
        if (!cancelled) setError('市场结构获取失败')
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

  const refresh = useCallback(async (): Promise<boolean> => {
    if (fetching.current) return false // 已在拉取,本次未执行,不可当成功
    fetching.current = true
    setLoading(true)
    setError(null)
    try {
      await load(true)
      return true
    } catch {
      setError('市场结构获取失败')
      return false
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}
