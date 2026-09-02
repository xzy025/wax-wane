import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export interface WorkbenchStatusEntry {
  runId: string
  tradeDate: string
  phase: 'premarket' | 'auction' | 'open' | 'settled'
  checkpoint: string
  status: 'scheduled' | 'running' | 'success' | 'degraded' | 'failed' | 'skipped'
  captureStatus: 'on-time' | 'late-live' | 'unavailable'
  sourceStatus: 'full' | 'degraded' | 'unavailable'
  provider?: string
  providerTimestamp?: string
  startedAt?: string
  finishedAt?: string
  dataAsOf?: string
  warnings: string[]
  error?: string
}

export interface WorkbenchCheckpointSpec {
  checkpoint: string
  phase: string
  label: string
  atSec: number
  cutoffSec: number
}

export interface WorkbenchAsiaInstrument {
  symbol: string
  market: 'JP' | 'KR'
  sessionStatus: 'open' | 'break' | 'closed' | 'holiday' | 'unknown'
  previousClose: number | null
  price: number | null
  returnFromClose: number | null
  return5m: number | null
  return15m: number | null
  return30m: number | null
  realizedVolatility: number | null
}

export interface WorkbenchAsiaState {
  tradeDate: string
  checkpoint: 'asia-open' | 'asia-0830' | 'asia-0900' | 'pre-auction'
  provider: string
  providerTimestamp: string
  receivedAt: string
  instruments: WorkbenchAsiaInstrument[]
  quality: 'full' | 'degraded' | 'unavailable'
  warnings: string[]
}

export interface WorkbenchBehaviorLabel {
  label: string
  detail: string
  evidence: string[]
}

export interface WorkbenchBehavior {
  symbol: string
  tradeDate: string
  lockRetention: number | null
  finalRetention: number | null
  matchedAmountAtPrelock: number | null
  matchedAmountAtFinal: number | null
  matchedConversion: number | null
  labels: WorkbenchBehaviorLabel[]
  heuristicVersion: 'heuristic-v1'
}

export interface WorkbenchAuctionResearch {
  tradeDate: string
  phase: string
  snapshotCount: number
  behaviors: WorkbenchBehavior[]
  labels: Record<string, number>
  warnings: string[]
}

export interface PremarketWorkbenchData {
  tradeDate: string
  generatedAt: string
  scheduler: {
    nextWindow: { checkpoint: string; atSecondsOfDay: number } | null
    checkpoints: WorkbenchCheckpointSpec[]
    lastRuns: Record<string, WorkbenchStatusEntry>
  }
  asia: Partial<Record<string, WorkbenchAsiaState | null>>
  auction: WorkbenchAuctionResearch
}

export function usePremarketWorkbench(enabled = true, refreshKey = 0) {
  const [result, setResult] = useState<{
    data: PremarketWorkbenchData | null
    error: string | null
    loading: boolean
  }>({ data: null, error: null, loading: true })
  const requestId = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    const id = ++requestId.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setResult((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const response = await fetchWithTimeout('/api/ops/premarket-workbench', 20_000, {
        signal: controller.signal,
      })
      const json = (await response.json()) as PremarketWorkbenchData & { error?: string }
      if (!response.ok || json.error) throw new Error(json.error ?? 'HTTP ' + response.status)
      if (controller.signal.aborted || id !== requestId.current) return
      setResult({ data: json, error: null, loading: false })
    } catch (err) {
      if (controller.signal.aborted || id !== requestId.current) return
      setResult((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to load premarket workbench',
        loading: false,
      }))
    } finally {
      if (id === requestId.current && abortRef.current === controller) {
        abortRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void load()
    const timer = setInterval(() => void load(), 30_000)
    return () => {
      requestId.current += 1
      abortRef.current?.abort()
      abortRef.current = null
      clearInterval(timer)
    }
  }, [enabled, load, refreshKey])
  return { data: result.data, error: result.error, loading: result.loading, refresh: load }
}