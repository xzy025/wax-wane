import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

/** 龙虎榜一行（mirror of server LhbRow）。金额单位：元。 */
export interface LhbRow {
  code: string
  name: string
  close: number
  changePct: number
  turnover: number
  netAmt: number
  buyAmt: number
  sellAmt: number
  reason: string
  seat: string
}

/** 个股主力资金流一行（mirror of server FundFlowRow）。金额单位：元。 */
export interface FundFlowRow {
  code: string
  name: string
  price: number
  changePct: number
  mainNet: number
  mainNetPct: number
  superNet: number
  bigNet: number
}

/** 多日累计榜一行。 */
export interface RankEntry {
  code: string
  name: string
  totalNet: number
  days: number
  latestChangePct: number
}

export interface MoneyFlowData {
  tradeDate: string
  lhb: { today: LhbRow[]; d3: RankEntry[]; d5: RankEntry[] }
  fundFlow: { today: FundFlowRow[]; d3: RankEntry[]; d5: RankEntry[] }
  lastUpdated: string
}

export interface MoneyFlowResult {
  data: MoneyFlowData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

/**
 * Fetches 资金流 (龙虎榜净买入 + 个股主力资金流) from /api/moneyflow.
 * Mirrors useThemes: a failed fetch keeps last good data and surfaces `error`.
 */
export function useMoneyFlow(): MoneyFlowResult {
  const [data, setData] = useState<MoneyFlowData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)

  const load = useCallback(async (clearServerCache: boolean) => {
    if (clearServerCache) {
      await fetch('/api/refresh?market=moneyflow', { method: 'POST' }).catch(() => {})
    }
    const res = await fetchWithTimeout('/api/moneyflow')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as MoneyFlowData
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
        if (!cancelled) setError('Failed to fetch money flow')
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
      setError('Failed to fetch money flow')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}
