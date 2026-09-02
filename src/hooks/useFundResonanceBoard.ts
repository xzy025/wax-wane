import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export interface Seat { name: string; amount: number }
export interface FundResonanceBoardItem {
  code: string; name: string; category: 'industry' | 'concept'; rank: number; strengthScore: number
  netInflow: number; netInflowPct: number; superLargeNet?: number; largeNet?: number; mediumNet?: number; smallNet?: number
}
export interface FundResonanceBoardRow {
  code: string; name: string; price: number; changePct: number; amount: number; marketCap: number
  netInflow: number; netInflowPct: number; superLargeNet?: number; largeNet?: number; mediumNet?: number; smallNet?: number
  turnoverRank: number; inflowRank: number; score: number; boardScore: number; stockScore: number; crossSourceScore: number
  level: 'strong' | 'resonance' | 'anomaly'; completeness: 'full' | 'eastmoney-only'
  boards: Array<{ code: string; name: string; category: 'industry' | 'concept'; rank: number; strengthScore: number }>
  sina?: { mainNet: number; mainRatio?: number; retailNet: number; retailRatio?: number }
  surveyOrgs?: number
  lhb?: { netAmt: number; buyAmt: number; sellAmt: number; buySeats: Seat[]; sellSeats: Seat[]; reason: string }
}
export interface FundResonanceBoardData {
  version: 2; asof: string; generatedAt: string; fromCache?: boolean; degraded?: boolean
  quality: { eastmoneyValid: boolean; sinaAvailable: boolean; tradeDateVerified: boolean; boardCount: number; candidateCount: number; validStockCount: number; warnings: string[] }
  boards: { industry: FundResonanceBoardItem[]; concept: FundResonanceBoardItem[] }
  stocks: FundResonanceBoardRow[]
}
export interface FundResonanceBoardHookResult { data: FundResonanceBoardData | null; loading: boolean; error: string | null; lastUpdated: Date | null; refresh: () => Promise<boolean> }

export function useFundResonanceBoard(): FundResonanceBoardHookResult {
  const [data, setData] = useState<FundResonanceBoardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const requestId = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (rescan: boolean): Promise<boolean> => {
    const id = ++requestId.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      if (rescan) {
        await fetchWithTimeout('/api/refresh?market=fund-resonance-board', 30_000, {
          method: 'POST',
          signal: controller.signal,
        })
      }
      const res = await fetchWithTimeout('/api/screener/fund-resonance-board', 60_000, {
        signal: controller.signal,
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const json = (await res.json()) as FundResonanceBoardData & { error?: string }
      if (json.version !== 2 || !Array.isArray(json.stocks) || !json.boards) {
        throw new Error(json.error ?? 'invalid response')
      }
      if (controller.signal.aborted || id !== requestId.current) return false
      setData(json)
      setLastUpdated(new Date(json.generatedAt))
      setError(null)
      return true
    } catch (err) {
      if (controller.signal.aborted || id !== requestId.current) return false
      setError(err instanceof Error ? err.message : '资金共振榜获取失败')
      return false
    } finally {
      if (id === requestId.current) {
        setLoading(false)
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    void load(false)
    return () => {
      requestId.current += 1
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [load])

  const refresh = useCallback(() => load(true), [load])

  return { data, loading, error, lastUpdated, refresh }
}
