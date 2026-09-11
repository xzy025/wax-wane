import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export interface InstitutionFlowWindow {
  window: number
  onDays: number
  buyDays: number
  sellDays: number
  instBuy: number
  instSell: number
  instNet: number
  hotNet: number
}

export interface InstitutionAccumCandidate {
  code: string
  name: string
  price: number
  changePct: number
  score: number
  tier: 1 | 2 | 3
  status: 'confirmed' | 'watch'
  flows: Record<'d5' | 'd10' | 'd20' | 'd30', InstitutionFlowWindow>
  flowIntensity10: number
  flowIntensity30: number
  persistence: number
  acceleration: number
  pricePosition120: number
  drawdown120: number
  relativeStrength5: number
  relativeStrength20: number
  ma20: number
  surveyOrgs: number
  surveyDays: number
  latestActiveDate: string
  latestActiveAge: number
  confirmPrice: number
  stopRef: number
  targetRef: number
  reason: string
  riskNote?: string
}

export interface InstitutionAccumData {
  asof: string
  generatedAt: string
  windowDates: string[]
  candidates: InstitutionAccumCandidate[]
  scanned: number
  fromCache?: boolean
}

export function useInstitutionAccum(immediate = true) {
  const [data, setData] = useState<InstitutionAccumData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetching = useRef(false)

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) {
      await fetch('/api/refresh?market=institution-accum', { method: 'POST' }).catch(() => {})
    }
    const res = await fetchWithTimeout('/api/screener/institution-accum', 180_000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as InstitutionAccumData & { error?: string }
    if (json.error || !Array.isArray(json.candidates)) throw new Error(json.error ?? 'invalid response')
    setData(json)
    setError(null)
  }, [])

  useEffect(() => {
    if (!immediate || fetching.current) return
    let cancelled = false
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        await load(false)
      } catch {
        if (!cancelled) setError('机构累积选股获取失败')
      } finally {
        if (!cancelled) {
          fetching.current = false
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
      fetching.current = false
    }
  }, [immediate, load])

  const refresh = useCallback(async () => {
    if (fetching.current) return false
    fetching.current = true
    setLoading(true)
    setError(null)
    try {
      await load(true)
      return true
    } catch {
      setError('机构累积选股获取失败')
      return false
    } finally {
      fetching.current = false
      setLoading(false)
    }
  }, [load])

  return { data, loading, error, refresh }
}
