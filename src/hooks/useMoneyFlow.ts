import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

/** 营业部一行（mirror of server Seat）。金额单位：元。 */
export interface Seat {
  name: string
  amount: number
}

/** 龙虎榜个股一行（mirror of server LhbStock）。金额单位：元。 */
export interface LhbStock {
  code: string
  name: string
  close: number
  changePct: number
  netAmt: number
  buyAmt: number
  sellAmt: number
  dealAmt: number // 龙虎榜成交额（买+卖）
  days: number // 上榜天数（当日=1；窗口=窗口内上榜次数）
  reason: string // 上榜原因
  concepts: string[] // 概念标签
  buySeats: Seat[] // 主要买入营业部
  sellSeats: Seat[] // 主要卖出营业部
}

/** 概念出现次数（供筛选 chips）。 */
export interface ConceptTally {
  name: string
  count: number
}

export interface DragonTigerSummary {
  inflowCount: number
  outflowCount: number
  totalInflow: number
  totalOutflow: number
}

export interface DragonTigerData {
  tradeDate: string
  buy: LhbStock[] // 主力在买（净流入）
  sell: LhbStock[] // 主力在卖（净流出）
  summary: DragonTigerSummary
  concepts: ConceptTally[]
  lastUpdated: string
}

export interface MoneyFlowResult {
  data: DragonTigerData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

/**
 * Fetches 龙虎榜 (Dragon-Tiger Board) for a trade date + window from /api/moneyflow.
 * `date` (YYYY-MM-DD) optional — omit for the latest trading day. `window` is
 * 1 (当日) / 3 / 5 day cumulative. Changing either re-fetches. A failed fetch
 * keeps last-good data and surfaces `error`.
 */
export function useMoneyFlow(date?: string, window: 1 | 3 | 5 = 1): MoneyFlowResult {
  const [data, setData] = useState<DragonTigerData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)

  const load = useCallback(
    async (clearServerCache: boolean) => {
      if (clearServerCache) {
        await fetch('/api/refresh?market=moneyflow', { method: 'POST' }).catch(() => {})
      }
      const params = new URLSearchParams()
      if (date) params.set('date', date)
      if (window !== 1) params.set('window', String(window))
      const qs = params.toString() ? `?${params}` : ''
      // Cold load fans out one concept fetch per stock server-side → allow 30s.
      const res = await fetchWithTimeout(`/api/moneyflow${qs}`, 30_000)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as DragonTigerData
      setData(json)
      setLastUpdated(new Date())
      setError(null)
    },
    [date, window],
  )

  useEffect(() => {
    let cancelled = false
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        await load(false)
      } catch {
        if (!cancelled) setError('Failed to fetch dragon-tiger board')
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
      setError('Failed to fetch dragon-tiger board')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}

/** Recent trading days from /api/moneyflow/dates — feeds the date picker to block non-trading days. */
export function useTradingDates(): { dates: Set<string>; latest: string | null } {
  const [dates, setDates] = useState<Set<string>>(new Set())
  const [latest, setLatest] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetchWithTimeout('/api/moneyflow/dates', 10_000)
        if (!res.ok) return
        const json = (await res.json()) as { dates: string[] }
        if (cancelled || !json.dates?.length) return
        setDates(new Set(json.dates))
        setLatest(json.dates[0] ?? null)
      } catch {
        // leave empty → picker falls back to weekend-only filtering
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { dates, latest }
}
