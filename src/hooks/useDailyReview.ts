import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

/** Mirror of server MacroEvent (server/services/macroCalendar.ts). */
export interface MacroEvent {
  date: string
  time?: string
  country: string
  name: string
  star: number
  previous?: string
  consensus?: string
  approx?: boolean
  source: 'jin10' | 'builtin'
}

/** Mirror of server ReviewQuote (server/services/dailyReview.ts). */
export interface ReviewQuote {
  code: string
  name: string
  price: number
  changePct: number
}

export interface ReviewNewsItem {
  title: string
  summary: string
  source: string
  link: string
}

export interface ReviewDragonRow {
  code: string
  name: string
  changePct: number
  netAmt: number
  reason: string
}

export interface ReviewBoardChip {
  name: string
  shortChg: number
  todayChg: number
}

export interface ReviewNarrative {
  tone: string
  markdown: string
  generatedAt: string
}

/** Mirror of server DailyReviewData. */
export interface DailyReviewData {
  asof: string
  generatedAt: string
  overnight: ReviewQuote[]
  asia: ReviewQuote[]
  news: ReviewNewsItem[]
  dragonTiger: ReviewDragonRow[]
  calendar: MacroEvent[]
  calendarSource: 'jin10' | 'builtin' | 'mixed'
  ashare: {
    indices: ReviewQuote[]
    totalTurnover: number
    limitUp: number
    limitDown: number
    advance: number
    decline: number
  } | null
  structure: {
    hsCount: number
    lsCount: number
    hwCount: number
    lwCount: number
    shortUpPct: number
    topHs: ReviewBoardChip[]
    topLs: ReviewBoardChip[]
  } | null
  narrative: ReviewNarrative | null
  fromCache?: boolean
}

export interface DailyReviewHookResult {
  data: DailyReviewData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  /** Re-run the daily review: clears the server cache then re-fetches. */
  refresh: () => void
}

/**
 * Fetches the 每日复盘综述(外围→消息面→宏观日历→A股→板块轮动) from /api/screener/daily-review.
 * `immediate=false` 时挂载不自动拉取——ScreenerView 只为盘后串联 refresh() 挂这个 hook,
 * 数据由 RotationView 里的卡片实例消费,挂载拉取纯属浪费。
 */
export function useDailyReview(immediate = true): DailyReviewHookResult {
  const [data, setData] = useState<DailyReviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)

  const load = useCallback(async (rescan: boolean) => {
    if (rescan) {
      await fetch('/api/refresh?market=daily-review', { method: 'POST' }).catch(() => {})
    }
    // 聚合含 8 个上游 + 盘后可能带一次 LLM 叙事生成(30s),超时给足。
    const res = await fetchWithTimeout('/api/screener/daily-review', 90_000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as DailyReviewData & { error?: string }
    if (json.error) throw new Error(json.error)
    setData(json)
    setLastUpdated(new Date())
    setError(null)
  }, [])

  useEffect(() => {
    if (!immediate) return
    let cancelled = false
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        await load(false)
      } catch {
        if (!cancelled) setError('每日复盘综述获取失败')
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
  }, [load, immediate])

  // 与模板 useMarketStructure 不同:refresh 不做 fetching 静默跳过——每日扫描串联
  // await review.refresh() 时若恰与挂载拉取撞车,静默 no-op 会让"重扫+落盘"悄悄没发生。
  // 并发的 GET 由服务端 createCache 的 in-flight 去重兜底,重复 setState 无害。
  const refresh = useCallback(async () => {
    fetching.current = true
    setLoading(true)
    setError(null)
    try {
      await load(true)
    } catch {
      setError('每日复盘综述获取失败')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}
