import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

/** 营业部一行(mirror of server Seat)。 */
export interface Seat {
  name: string
  amount: number
}

/** Mirror of server FundResonanceBoardRow(server/services/fundResonanceBoard.ts)。 */
export interface FundResonanceBoardRow {
  code: string
  name: string
  price: number
  changePct: number
  netInflow: number
  netInflowPct: number
  turnoverRank: number
  inflowRank: number
  lhb?: { netAmt: number; buyAmt: number; sellAmt: number; buySeats: Seat[]; sellSeats: Seat[]; reason: string }
}

export interface FundResonanceBoardHookResult {
  data: FundResonanceBoardRow[] | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

/** 资金共振榜(Top10,纯排行·非战法·非买点·未回测)。from /api/screener/fund-resonance-board。 */
export function useFundResonanceBoard(): FundResonanceBoardHookResult {
  const [data, setData] = useState<FundResonanceBoardRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)

  const load = useCallback(async (rescan: boolean) => {
    if (rescan) {
      await fetch('/api/refresh?market=fund-resonance-board', { method: 'POST' }).catch(() => {})
    }
    const res = await fetchWithTimeout('/api/screener/fund-resonance-board', 30_000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as FundResonanceBoardRow[] & { error?: string }
    if (!Array.isArray(json)) throw new Error((json as { error?: string }).error ?? 'invalid response')
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
        if (!cancelled) setError('资金共振榜获取失败')
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
      setError('资金共振榜获取失败')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}
