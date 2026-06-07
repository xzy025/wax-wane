import { useState, useCallback, useRef, useEffect } from 'react'
import { getLastTradingDay, getDay, saveDay, type SaveDayOptions } from '../utils/marketHistory'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'
import { getCustomStocks } from '../utils/customStocks'

export interface IndexQuote {
  code: string
  name: string
  price: number
  changePct: number
  changeAmt: number
  volume: number
  turnover: number
  high: number
  low: number
  open: number
  prevClose: number
}

export interface MarketData {
  indices: IndexQuote[]
  customStocks: IndexQuote[]
}

export interface MarketResult<T extends MarketData> {
  data: T | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
  refreshCustom: () => void
}

export interface MarketConfig<T extends MarketData> {
  /** Market id; drives the API endpoint, quote endpoint and cache key. */
  market: 'hk' | 'us'
  /** Mock data used only as a placeholder when there is no data at all. */
  getMock: () => T
}

/**
 * Generic market-data hook shared by HK and US (previously two ~70%-identical
 * copies). A-share has extra fields and keeps its own hook.
 *
 * Error policy: a failed fetch NEVER overwrites good data with mock. We keep
 * the last good value and surface `error` so the UI can flag stale/failed data
 * instead of silently showing fixed mock numbers (which read as "refresh did
 * nothing"). Mock is only used as a first-load placeholder when nothing exists.
 */
export function useMarketData<T extends MarketData>(
  config: MarketConfig<T>,
  date: string = getLastTradingDay(),
): MarketResult<T> {
  const { market, getMock } = config
  const endpoint = `/api/${market}`
  const isLatest = date === getLastTradingDay()

  const writeCache = (d: string, value: T) =>
    saveDay(d, { [market]: value } as SaveDayOptions)

  const cachedEntry = getDay(date)
  const cachedData = cachedEntry?.[market] as T | undefined
  const [data, setData] = useState<T | null>(cachedData ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    cachedData && cachedEntry ? new Date(cachedEntry.timestamp) : null,
  )
  const fetching = useRef(false)

  const fetchCustomStocks = useCallback(async (): Promise<IndexQuote[]> => {
    const codes = getCustomStocks(market)
    if (codes.length === 0) return []
    try {
      const res = await fetchWithTimeout(`${endpoint}/quote?codes=${codes.join(',')}`)
      if (!res.ok) return []
      const json = await res.json()
      return json.quotes ?? []
    } catch {
      return []
    }
  }, [market, endpoint])

  // Shared fetch routine for both initial load and explicit refresh.
  const load = useCallback(
    async (clearServerCache: boolean) => {
      if (clearServerCache) {
        // Only clear this market's server cache, not every market's.
        await fetch(`/api/refresh?market=${market}`, { method: 'POST' }).catch(() => {})
      }
      const [res, customQuotes] = await Promise.all([
        fetchWithTimeout(endpoint),
        fetchCustomStocks(),
      ])
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result = (await res.json()) as T
      const finalData = {
        ...result,
        indices: result.indices?.length > 0 ? result.indices : getMock().indices,
        customStocks: customQuotes,
      } as T
      setData(finalData)
      writeCache(date, finalData)
      setLastUpdated(new Date())
      setError(null)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [market, endpoint, date, fetchCustomStocks],
  )

  // When date changes, load from cache or fetch.
  useEffect(() => {
    let cancelled = false

    const entry = getDay(date)
    const cached = entry?.[market] as T | undefined
    if (cached && cached.indices && cached.indices.length > 0) {
      setData(cached)
      setLastUpdated(entry ? new Date(entry.timestamp) : null)
      setError(null)
      setLoading(false)
      return
    }

    // Past date without cache: show mock placeholder (no live history available).
    if (!isLatest) {
      setData(getMock())
      setLastUpdated(null)
      setError(null)
      setLoading(false)
      return
    }

    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        await load(false)
      } catch {
        if (cancelled) return
        // First load failed: keep nothing-but-mock placeholder, flag the error.
        setData((prev) => prev ?? getMock())
        setError(`Failed to fetch ${market.toUpperCase()} data`)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, isLatest])

  const refresh = useCallback(async () => {
    if (!isLatest || fetching.current) return
    fetching.current = true
    setLoading(true)
    setError(null)
    try {
      await load(true)
    } catch {
      // Keep the last good data; just surface the error.
      setData((prev) => prev ?? getMock())
      setError(`Failed to fetch ${market.toUpperCase()} data`)
    } finally {
      setLoading(false)
      fetching.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLatest, load, market])

  const refreshCustom = useCallback(async () => {
    const customQuotes = await fetchCustomStocks()
    setData((prev) => (prev ? { ...prev, customStocks: customQuotes } : prev))
  }, [fetchCustomStocks])

  return { data, loading, error, lastUpdated, refresh, refreshCustom }
}
