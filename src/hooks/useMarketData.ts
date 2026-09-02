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
  status: 'full' | 'degraded' | 'stale' | 'unavailable'
  refresh: () => void
  refreshCustom: () => void
}

export interface MarketConfig<T extends MarketData> {
  /** Market id; drives the API endpoint, quote endpoint and cache key. */
  market: 'hk' | 'us'
}

/**
 * Generic market-data hook shared by HK and US (previously two ~70%-identical
 * copies). A-share has extra fields and keeps its own hook.
 *
 * Error policy: failed fetches never invent placeholder quotes. The hook keeps
 * last-good values as stale and reports unavailable when no verified value
 * exists. Historical dates without a local archive remain unavailable.
 */
export function useMarketData<T extends MarketData>(
  config: MarketConfig<T>,
  date: string = getLastTradingDay(),
): MarketResult<T> {
  const { market } = config
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
  const [status, setStatus] = useState<MarketResult<T>['status']>(
    cachedData ? (isLatest ? 'stale' : 'full') : 'unavailable',
  )
  const fetching = useRef(false)
  const latestData = useRef<T | null>(cachedData ?? null)
  const setCurrentData = useCallback((next: T | null) => {
    latestData.current = next
    setData(next)
  }, [])

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
      if (!Array.isArray(result.indices) || result.indices.length === 0) {
        throw new Error(`${market.toUpperCase()} response did not include index quotes`)
      }
      const finalData = {
        ...result,
        indices: result.indices,
        customStocks: customQuotes,
      } as T
      setCurrentData(finalData)
      writeCache(date, finalData)
      setLastUpdated(new Date())
      setStatus('full')
      setError(null)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [market, endpoint, date, fetchCustomStocks, setCurrentData],
  )

  // When date changes, load from cache or fetch.
  useEffect(() => {
    let cancelled = false

    const entry = getDay(date)
    const cached = entry?.[market] as T | undefined
    if (cached && cached.indices && cached.indices.length > 0) {
      setCurrentData(cached)
      setLastUpdated(entry ? new Date(entry.timestamp) : null)
      setError(null)
      setStatus(isLatest ? 'stale' : 'full')
      setLoading(false)
      return
    }

    // Past date without cache must not borrow live or placeholder values.
    if (!isLatest) {
      setCurrentData(null)
      setLastUpdated(null)
      setError(`No archived ${market.toUpperCase()} data for this date`)
      setStatus('unavailable')
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
        // Keep a verified prior value as stale; never synthesize market quotes.
        setCurrentData(latestData.current)
        setError(`Failed to fetch ${market.toUpperCase()} data`)
        setStatus(latestData.current ? 'stale' : 'unavailable')
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
  }, [date, isLatest, load, market, setCurrentData])

  const refresh = useCallback(async () => {
    if (!isLatest || fetching.current) return
    fetching.current = true
    setLoading(true)
    setError(null)
    try {
      await load(true)
    } catch {
      // Keep the last good data; just surface the error.
      setCurrentData(latestData.current)
      setError(`Failed to fetch ${market.toUpperCase()} data`)
      setStatus(latestData.current ? 'stale' : 'unavailable')
    } finally {
      setLoading(false)
      fetching.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLatest, load, market, setCurrentData])

  const refreshCustom = useCallback(async () => {
    const customQuotes = await fetchCustomStocks()
    const current = latestData.current
    if (current) setCurrentData({ ...current, customStocks: customQuotes })
  }, [fetchCustomStocks, setCurrentData])

  return { data, loading, error, lastUpdated, status, refresh, refreshCustom }
}
