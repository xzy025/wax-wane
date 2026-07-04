import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export type BuyGroup =
  | 'breakout' | 'trigger' | 'pullback' | 'highdiv' | 'volbreak' | 'fundres' | 'bhold' | 'trendnew'

export type ForwardReason =
  | 'target' | 'target-gap' | 'stop' | 'stop-gap' | 'time' | 'trail' | 'open' | 'pending'
  | 'stale' // 停牌/退市 mark-to-last 平仓(计入 closed)
  | 'skipped' // bhold 确认口径:确认窗未触发/先破位废弃(不进指标)

/** Mirror of server SampleConfidence (server/services/screenerForward.ts). */
export type SampleConfidence = 'low' | 'medium' | 'high'

/** Mirror of server Metrics (server/backtest/engine.ts). */
export interface Metrics {
  n: number
  winRate: number
  avgRetPct: number
  avgWinPct: number
  avgLossPct: number
  payoff: number
  profitFactor: number | null // null=∞(零亏损;server engine.aggregate 约定,显示层出「∞」)
  expectancyR: number
  maxDDR: number
  avgHoldBars: number
  targetRate: number
  stopRate: number
  timeRate: number
}

/** Mirror of server ForwardPick (server/services/screenerForward.ts). */
export interface ForwardPick {
  asof: string
  group: BuyGroup
  code: string
  name: string
  entry: number
  stop: number
  target: number
  status: 'open' | 'closed' | 'pending' | 'skipped'
  exit: number
  exitDate: string
  reason: ForwardReason
  R: number
  retPct: number
  barsHeld: number
  barsElapsed: number
  // 归因切片标签(事后分析用,缺失=该因子当时未挂上)。
  score?: number
  taBias?: string
  lhbInstDays?: number
  boardQuadrant?: string
  regimePhase?: string // 信号日情绪环境 attack/caution/retreat
  marketTrend?: string // 信号日大盘趋势 strong/neutral/weak
}

/** Mirror of server StrategyTrack. */
export interface StrategyTrack {
  group: BuyGroup
  closed: Metrics
  closedCount: number
  openCount: number
  pendingCount: number
  staleCount?: number // 停牌 mark-to-last 平仓笔数(已含在 closedCount;旧归档缺失)
  skippedCount?: number // bhold 确认口径废弃笔数(旧归档缺失)
  sampleConfidence: SampleConfidence
  unrealizedAvgR: number
  backtestExpectancyR?: number
  backtestProfitFactor?: number
  note?: string
  picks: ForwardPick[]
}

/** Mirror of server SegmentBucket/SegmentGroup. */
export interface SegmentBucket {
  label: string
  metrics: Metrics
  sampleConfidence: SampleConfidence
}
export interface SegmentGroup {
  by: string
  buckets: SegmentBucket[]
}

/** Mirror of server ScreenerForwardResult. */
export interface ScreenerForwardResult {
  asof: string
  generatedAt: string
  hold: number
  snapshotCount: number
  dateRange: [string, string] | null
  totalPicks: number
  pendingCount: number
  skippedCount?: number
  strategies: StrategyTrack[]
  overall: Metrics // 买点口径(trigger 等观察组不计)
  breakoutSegments?: SegmentGroup[]
  regimeSegments?: SegmentGroup[] // 全买点战法按信号日市场环境切片
  fromCache?: boolean
}

export interface ScreenerForwardHookResult {
  data: ScreenerForwardResult | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  /** Re-run the rolling eval: clears the server cache then re-fetches. Resolves true on success. */
  refresh: () => Promise<boolean>
}

/**
 * Fetches the 滚动实盘回测 result from /api/screener/forward. Same error policy as
 * useScreener: keep last-good data, surface `error`. A cold compute fetches fresh
 * klines for every unique archived code, so the timeout is generous.
 */
export function useScreenerForward(): ScreenerForwardHookResult {
  const [data, setData] = useState<ScreenerForwardResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)

  const load = useCallback(async (rescan: boolean) => {
    if (rescan) {
      await fetch('/api/refresh?market=screener-forward', { method: 'POST' }).catch(() => {})
    }
    const res = await fetchWithTimeout('/api/screener/forward', 200_000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as ScreenerForwardResult & { error?: string }
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
        if (!cancelled) setError('实盘战绩获取失败')
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
      setError('实盘战绩获取失败')
      return false
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}
