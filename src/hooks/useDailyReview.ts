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

/** Mirror of server ReversalSignal (server/services/reboundRules.ts). */
export interface ReversalSignal {
  date: string
  chgPct: number
  volRatio: number // 当日量/昨日量
  vol5Ratio: number
  downDays: number
  downCumPct: number
}

/** Mirror of server ReboundPioneer (server/services/reboundReview.ts). */
export interface ReboundPioneer {
  code: string
  name: string
  changePct: number
  firstTime: string // HHMMSS;兜底源为空串
  lastTime: string
  openCount: number
  consecutiveDays: number
  industry: string
  turnoverRate: number
  amount: number
}

/** Mirror of server ReboundResilient. */
export interface ReboundResilient {
  code: string
  name: string
  changePct: number
  volRatio: number
  cumRelPct: number
  counterTrendDays: number
  stockChgPct: number
  indexChgPct: number
}

/** Mirror of server ReboundSection. */
export interface ReboundSection {
  detected: boolean
  signal: ReversalSignal | null
  secondaryChgPct: number | null
  window: { fromDate: string; toDate: string } | null
  pioneers: ReboundPioneer[]
  fbtAvailable: boolean
  resilient: ReboundResilient[]
  brokerage: {
    code: string
    name: string
    todayChg: number
    topMovers: { code: string; name: string; changePct: number }[]
  } | null
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
  /** 反攻日区块;旧存档/取数失败 = undefined/null,非反攻日 detected:false(均不渲染)。 */
  reboundDay?: ReboundSection | null
  fromCache?: boolean
}

export interface DailyReviewHookResult {
  data: DailyReviewData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  /** Re-run the daily review: clears the server cache then re-fetches. Resolves true on success. */
  refresh: () => Promise<boolean>
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
  const refresh = useCallback(async (): Promise<boolean> => {
    fetching.current = true
    setLoading(true)
    setError(null)
    try {
      await load(true)
      return true
    } catch {
      setError('每日复盘综述获取失败')
      return false
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}
