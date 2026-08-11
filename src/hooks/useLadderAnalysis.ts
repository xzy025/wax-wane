import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export type LadderState = 'candidate' | 'waiting' | 'observe' | 'exclude'
export type MarketCyclePhase = 'ice' | 'repair' | 'climax' | 'ebb'
export type ThemeGrade = 'A' | 'B' | 'C' | 'D'
export type LadderRole =
  | 'space-leader'
  | 'theme-leader'
  | 'first-pioneer'
  | 'mid-ladder'
  | 'follower'
export type ShapeArchetype =
  | 'low-platform-breakout'
  | 'platform-breakout'
  | 'trend-platform'
  | 'low-oversold-reversal'
  | 'event-reversal'
  | 'high-new-high'
  | 'non-platform-breakout'
  | 'insufficient'

export interface LadderImportStock {
  code: string
  name?: string
  status?: string
  consecutiveDays?: number
  nDayBoards?: string
  themes?: string[]
  subtheme?: string
  role?: string
  reason?: string
  firstTime?: string
  lastTime?: string
  openCount?: number
  turnoverRate?: number
  amount?: number
  sealAmount?: number
  onePrice?: boolean
}

export interface LadderImportPayload {
  asof: string
  stocks: LadderImportStock[]
}

export interface ThemeAnalysis {
  name: string
  grade: ThemeGrade
  score: number
  count: number
  firstBoardCount: number
  multiBoardCount: number
  maxBoards: number
  continuity: number
  promotionRate: number
  sealStability: number
  stockCodes: string[]
}

export interface TechnicalEvidence {
  available: boolean
  settled: boolean
  lastDate: string
  barCount: number
  ma20: number | null
  ma60: number | null
  ma120: number | null
  ma120Rising: boolean | null
  atr14Pct: number | null
  breakout20: boolean | null
  breakout60: boolean | null
  breakout120: boolean | null
  breakoutLine20: number | null
  pre20RangePct: number | null
  amountRatio20: number | null
  amountRatioSource: 'amount' | 'volume' | 'missing'
  prePosition120Pct: number | null
  episodeOnsetDate: string | null
  episodeReturnPct: number | null
  sessionsFromOnset: number | null
  recognitionLate: boolean
  onePrice: boolean
  shape: ShapeArchetype
  platformEdge: number | null
  onsetLow: number | null
}

export interface LadderStockAnalysis {
  rank: number
  code: string
  name: string
  price: number
  changePct: number
  boardType: 'main' | 'twenty' | 'beijing'
  consecutiveDays: number
  nDayBoards: string
  themes: string[]
  primaryTheme: string
  subtheme: string
  themeGrade: ThemeGrade
  themeScore: number
  role: LadderRole
  reason: string
  firstTime: string
  lastTime: string
  openCount: number
  turnoverRate: number
  amount: number
  sealAmount: number | null
  onePrice: boolean
  tBoard: boolean
  isMarginEligible: boolean
  reasonSource: 'kaipanla' | 'import' | 'none'
  state: LadderState
  score: number
  technical: TechnicalEvidence
  dimensions: Record<
    'market' | 'theme' | 'ladder' | 'technical' | 'seal',
    { score: number; note: string }
  >
  penalties: string[]
  warnings: string[]
  trigger: string
  invalidation: string
  mainRisk: string
}

export interface LimitLadderAnalysis {
  asof: string
  generatedAt: string
  ruleVersion: string
  archived: boolean
  market: {
    cycle: {
      phase: MarketCyclePhase
      score: number
      directionAvailable: boolean
      reasons: string[]
      current: {
        temperature: number
        limitUp: number
        limitDown: number
        breakRate: number
        promotionRate: number
        yestLimitPerf: number
        advance: number
        decline: number
        maxBoards: number
        ladderContinuity: number
      }
      previousTemperature?: number
    }
    limitUp: number
    limitDown: number
    breakRate: number
    promotionRate: number
    advance: number
    decline: number
    maxBoards: number
  }
  themes: ThemeAnalysis[]
  levels: Array<{ boards: number; stocks: LadderStockAnalysis[] }>
  firstBoards: LadderStockAnalysis[]
  stocks: LadderStockAnalysis[]
  quality: {
    source: 'kaipanla' | 'eastmoney' | 'sina' | 'import' | 'mixed'
    sourceDate: string
    sentimentSource: 'kaipanla' | 'derived' | 'mock'
    limitFieldsComplete: boolean
    klineComplete: number
    klineTotal: number
    degraded: boolean
    warnings: string[]
  }
  warnings: string[]
}

export interface LadderReasonDetail {
  code: string
  date: string
  reason: string
  explanation: string
  marketRole: string
  hotReason: string
  source: 'kaipanla'
}

export function useLadderReason(code: string, date: string) {
  const requestKey = `${date}:${code}`
  const [result, setResult] = useState<{
    key: string
    detail: LadderReasonDetail | null
    error: string | null
  }>({ key: '', detail: null, error: null })

  useEffect(() => {
    let cancelled = false
    if (!code) return

    fetchWithTimeout(
      `/api/ladder/reason?code=${encodeURIComponent(code)}&date=${encodeURIComponent(date)}`,
      15_000,
    )
      .then(async (response) => {
        const json = (await response.json()) as {
          detail?: LadderReasonDetail | null
          error?: string
        }
        if (!response.ok || json.error) throw new Error(json.error ?? `HTTP ${response.status}`)
        if (!cancelled) {
          setResult({ key: requestKey, detail: json.detail ?? null, error: null })
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setResult({
            key: requestKey,
            detail: null,
            error: reason instanceof Error ? reason.message : 'Failed to load limit-up reason',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [code, date, requestKey])

  if (result.key !== requestKey) {
    return { detail: null, loading: !!code, error: null }
  }
  return { detail: result.detail, loading: false, error: result.error }
}

export function useLadderAnalysis(date: string) {
  const [data, setData] = useState<LimitLadderAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetching = useRef(false)

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) await fetch('/api/refresh?market=ladder', { method: 'POST' }).catch(() => {})
      const res = await fetchWithTimeout(
        `/api/ladder/analysis?date=${encodeURIComponent(date)}`,
        120_000,
      )
      const json = (await res.json()) as LimitLadderAnalysis & { error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
      setData(json)
      setError(null)
      return json
    },
    [date],
  )

  useEffect(() => {
    let cancelled = false
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    load()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load ladder')
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          fetching.current = false
        }
      })
    return () => {
      cancelled = true
      fetching.current = false
    }
  }, [load])

  const refresh = useCallback(async () => {
    if (fetching.current) return false
    fetching.current = true
    setLoading(true)
    setError(null)
    try {
      await load(true)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ladder')
      return false
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  const importData = useCallback(async (payload: LadderImportPayload) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchWithTimeout('/api/ladder/import', 120_000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json()) as LimitLadderAnalysis & { error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
      setData(json)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return { data, loading, error, refresh, importData }
}
