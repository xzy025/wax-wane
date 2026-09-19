import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export interface McpUniverseStock {
  code: string
  name: string
  /** 命中的策略 key 列表；长度 ≥2 表示跨策略共振。 */
  hits: string[]
}

export interface McpUniverseGroup {
  key: string
  label: string
  mcpStrategy: string
  totalStocks: number
  collected: number
  truncated: boolean
  codes: { code: string; name: string }[]
}

export interface McpUniverseData {
  schemaVersion: string
  provider: string
  asof: string
  generatedAt: string
  purpose: string
  statusNote: string
  coverageNote?: string
  groups: McpUniverseGroup[]
  union: McpUniverseStock[]
  unionSize: number
  availableDates: string[]
  multiHit: McpUniverseStock[]
}

/**
 * MCP 候选集(影子观察)。数据来自 WorkBuddy 会话每日落盘的
 * docs/screener/mcp-universe-<date>.json，服务端只做直读。
 * 非战法、非买点、未回测 —— 前端必须保留该标注，不得与正式选股信号混排。
 */
export function useMcpUniverse(immediate = true) {
  const [data, setData] = useState<McpUniverseData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 磁盘上还没有任何候选集文件(404)——与"加载失败"区分开,那是不同的用户动作。 */
  const [missing, setMissing] = useState(false)
  const fetching = useRef(false)

  const load = useCallback(async () => {
    const res = await fetchWithTimeout('/api/screener/mcp-universe', 30_000)
    if (res.status === 404) {
      setMissing(true)
      setError(null)
      return
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as McpUniverseData & { error?: string }
    if (json.error || !Array.isArray(json.groups)) throw new Error(json.error ?? 'invalid response')
    setMissing(false)
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
        await load()
      } catch {
        if (!cancelled) setError('MCP 候选集获取失败')
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
    setMissing(false)
    try {
      await load()
      return true
    } catch {
      setError('MCP 候选集获取失败')
      return false
    } finally {
      fetching.current = false
      setLoading(false)
    }
  }, [load])

  return { data, loading, error, missing, refresh }
}
