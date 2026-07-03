import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export type Quadrant = 'hs' | 'ls' | 'hw' | 'lw'
export type RotationCategory = 'industry' | 'concept'

/** Mirror of server RotationBoard (server/services/rotation.ts). */
export interface RotationBoard {
  code: string
  name: string
  todayChg: number
  longChg: number
  shortChg: number
  quadrant: Quadrant
}
export interface RotationSummary {
  total: number
  hs: number
  ls: number
  hw: number
  lw: number
  shortUpPct: number
}
export interface RotationResult {
  asof: string
  category: RotationCategory
  longWin: number
  shortWin: number
  boards: RotationBoard[]
  summary: RotationSummary
}
export interface RotationHookResult {
  data: RotationResult | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  /** Re-fetch with a fresh server-side scan (clears cache). */
  refresh: () => void
}

/**
 * Fetches the sector-rotation quadrant from /api/rotation. Re-fetches when
 * category / window params change. Cold concept scans can be slow (per-board
 * kline), so the timeout is generous. Error policy mirrors useScreener.
 */
export function useRotation(category: RotationCategory, longWin: number, shortWin: number): RotationHookResult {
  const [data, setData] = useState<RotationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)
  // 单调递增请求号:参数切换/手动刷新都会发新请求但不中止旧 fetch(概念冷扫可跑数十秒),
  // 只允许最新一次请求提交状态——否则慢的旧响应回来会覆盖新数据(界面选行业、数据是概念)。
  const seq = useRef(0)

  const load = useCallback(
    async (rescan: boolean) => {
      const id = ++seq.current
      if (rescan) {
        await fetch('/api/refresh?market=rotation', { method: 'POST' }).catch(() => {})
      }
      const url = `/api/rotation?category=${category}&long=${longWin}&short=${shortWin}`
      const res = await fetchWithTimeout(url, 200_000)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as RotationResult & { error?: string }
      if (json.error) throw new Error(json.error)
      if (id !== seq.current) return // 已有更新的请求在飞/已完成,旧响应丢弃
      setData(json)
      setLastUpdated(new Date())
      setError(null)
    },
    [category, longWin, shortWin],
  )

  useEffect(() => {
    let cancelled = false
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        await load(false)
      } catch {
        if (!cancelled) setError('板块轮动数据获取失败')
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
      setError('板块轮动数据获取失败')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}

// ── 板块内强势股下钻 ─────────────────────────────────────────────
export interface BoardStock {
  group: 'breakout' | 'trigger'
  code: string
  name: string
  price: number
  changePct: number
  pivot: number
  stopLoss: number
  target: number
  score: number
  distToPivotPct: number
  dist52Pct: number
  signals: { pattern: string }
}
export interface BoardStocksResult {
  code: string
  name: string
  scanned: number
  breakout: BoardStock[]
  trigger: BoardStock[]
  /** 成分股当日涨跌幅榜(前10,不依赖新高战法命中);蓝筹反转板块靠这个看具体标的。 */
  topMovers: { code: string; name: string; changePct: number }[]
}

/** 取某板块成分股的新高战法候选(突破/扳机)。code=null 时不取。 */
export function useBoardStocks(code: string | null): {
  data: BoardStocksResult | null
  loading: boolean
  error: string | null
} {
  const [data, setData] = useState<BoardStocksResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) {
      setData(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    ;(async () => {
      try {
        const res = await fetchWithTimeout(`/api/rotation/board-stocks?code=${encodeURIComponent(code)}`, 120_000)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as BoardStocksResult & { error?: string }
        if (json.error) throw new Error(json.error)
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setError('板块下钻获取失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code])

  return { data, loading, error }
}
