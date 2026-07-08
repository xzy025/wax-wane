import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

/** Mirror of server NewsFlashStock (server/services/newsFlashNormalize.ts). */
export interface NewsFlashStock {
  code: string
  name?: string
}

/** Mirror of server NewsFlashItem. */
export interface NewsFlashItem {
  id: string
  time: string
  title: string
  summary: string
  source: 'eastmoney' | 'sina'
  important: boolean
  stocks: NewsFlashStock[]
  url?: string
}

/** Mirror of server NewsFlashData (server/services/newsFlash.ts). */
export interface NewsFlashData {
  asof: string
  items: NewsFlashItem[]
  sources: { eastmoney: boolean; sina: boolean }
}

export interface NewsFlashHookResult {
  data: NewsFlashData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  /** 强刷:清服务端缓存再拉。 */
  refresh: () => Promise<boolean>
}

const POLL_MS = 30_000 // 快讯 7x24 滚动,挂载期间静默轮询(与服务端盘中 TTL 同步)

/**
 * 7x24 快讯(东财+新浪双源)。挂载期间每 30s 静默轮询:失败不清 data、不弹
 * error(快讯断一轮无感),只有首拉失败才报错。seq ref 丢弃过期响应。
 */
export function useNewsFlash(): NewsFlashHookResult {
  const [data, setData] = useState<NewsFlashData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const seq = useRef(0)

  const load = useCallback(async (rescan: boolean) => {
    const mySeq = ++seq.current
    try {
      if (rescan) {
        await fetch('/api/refresh?market=intel-flash', { method: 'POST' }).catch(() => {})
      }
      const res = await fetchWithTimeout('/api/intel/flash', 15_000)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as NewsFlashData & { error?: string }
      if (json.error) throw new Error(json.error)
      if (mySeq !== seq.current) return // 过期响应,丢弃
      setData(json)
      setLastUpdated(new Date())
      setError(null)
    } catch (e) {
      if (mySeq !== seq.current) return // 过期失败同样丢弃,不许盖住更新的数据
      throw e
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        await load(false)
      } catch {
        if (!cancelled) setError('flash-load-failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    const timer = setInterval(() => {
      // 静默轮询:失败跳过本轮,保留屏上旧数据
      load(false).catch(() => {})
    }, POLL_MS)
    return () => {
      cancelled = true
      seq.current++ // 卸载后丢弃在途响应
      clearInterval(timer)
    }
  }, [load])

  const refresh = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await load(true)
      return true
    } catch {
      setError('flash-load-failed')
      return false
    } finally {
      setLoading(false)
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}
