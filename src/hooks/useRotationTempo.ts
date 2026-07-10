import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

// ── Mirror of server rotationTempo.ts / rotationRules.ts ──────────────
export type TempoState = 'launch' | 'adjust'
export type TempoTier = 'strong' | 'weak' | 'adjust'
export type TempoQualifier = 'aboveIndex' | 'volUp' | 'volDown' | 'resilient'
export type TempoSource = 'em-industry' | 'em-concept' | 'kpl-theme'
export type TempoNoteKind = 'soloStrong' | 'split' | 'inflow'

export interface TempoCell {
  date: string
  state: TempoState
  dayN: number
  tier: TempoTier
  chg: number
  qualifiers: TempoQualifier[]
}

export interface TempoNote {
  kind: TempoNoteKind
  date: string
  detail?: string
}

export interface TempoRow {
  code: string
  name: string
  source: TempoSource
  recon: boolean // 成分股等权重构(无量比)
  cells: TempoCell[]
  heat: number
  active: boolean
  notes: TempoNote[]
}

export interface RotationTempoResult {
  asof: string
  dates: string[]
  benchmark: { name: string; cells: { date: string; chg: number }[] }
  rows: TempoRow[]
  sources: { em: 'live' | 'recon' | 'down'; kpl: 'live' | 'off' | 'down' }
  fromArchive?: boolean
}

export interface RotationTempoHookResult {
  data: RotationTempoResult | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => Promise<void>
}

/**
 * 节奏表(板块×5日 启动/调整网格)。pins 变化重取(只影响钉选行的富注记增补,服务端主缓存命中,便宜)。
 * 冷扫可含成分股重构(百余次个股K线),超时同 useRotation 给足;seq 防旧响应覆盖。
 */
export function useRotationTempo(pins: string[]): RotationTempoHookResult {
  const [data, setData] = useState<RotationTempoResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)
  const seq = useRef(0)
  const pinsKey = pins.join(',')

  const load = useCallback(
    async (rescan: boolean) => {
      const id = ++seq.current
      if (rescan) {
        await fetch('/api/refresh?market=rotation-tempo', { method: 'POST' }).catch(() => {})
      }
      const url = `/api/rotation/tempo${pinsKey ? `?pins=${encodeURIComponent(pinsKey)}` : ''}`
      const res = await fetchWithTimeout(url, 200_000)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as RotationTempoResult & { error?: string }
      if (json.error) throw new Error(json.error)
      if (id !== seq.current) return
      setData(json)
      setLastUpdated(new Date())
      setError(null)
    },
    [pinsKey],
  )

  useEffect(() => {
    let cancelled = false
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        await load(false)
      } catch {
        if (!cancelled) setError('节奏表获取失败')
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
      setError('节奏表获取失败')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}
