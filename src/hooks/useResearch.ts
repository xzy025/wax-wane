import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

/** Mirror of server ReportFile (server/services/researchFiles.ts). */
export interface ReportFile {
  name: string
  kind: 'pdf' | 'md' | 'txt'
  sizeBytes: number
  mtimeMs: number
  date: string
  fingerprint: string
}

/** Mirror of server ReportAnalysis (server/services/research.ts). */
export interface ReportAnalysis {
  fingerprint: string
  fileName: string
  date: string
  stockName: string | null
  stockCode: string | null
  industry: string | null
  brokerage: string | null
  rating: string | null
  targetPrice: string | null
  thesis: string[]
  catalysts: string[]
  risks: string[]
  oneLiner: string
  analyzedAt: string
  truncated: boolean
}

export interface ResearchDigest {
  date: string
  fingerprintsHash: string
  reportCount: number
  overview: string
  hotIndustries: string[]
  keyStocks: { name: string; code: string | null; reason: string }[]
  consensus: string | null
  generatedAt: string
}

export type ReportStatus = 'analyzed' | 'pending' | 'extract_failed'

export interface ResearchReportEntry {
  file: ReportFile
  status: ReportStatus
  analysis: ReportAnalysis | null
  error?: string
}

/** Mirror of server FeishuSyncStatus (server/services/feishuSync.ts). */
export interface FeishuSyncStatus {
  configured: boolean
  syncing: boolean
  lastSyncAt: string | null
  lastError: string | null
}

/** Mirror of server ResearchData. */
export interface ResearchData {
  date: string
  llmConfigured: boolean
  analyzing: boolean
  /** 可选:容忍旧缓存响应;服务端未配置飞书时 configured=false。 */
  feishu?: FeishuSyncStatus
  reports: ResearchReportEntry[]
  digest: ResearchDigest | null
  generatedAt: string
}

export interface ResearchHookResult {
  data: ResearchData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => Promise<boolean>
}

const CONVERGE_POLL_MS = 20_000 // 后台分析进行中/有待分析时的收敛轮询间隔

/**
 * 每日研报看板。GET 即时返回磁盘状态并触发服务端后台分析;存在 pending/analyzing
 * 时每 20s 静默补拉,分析逐篇落盘后前端自动点亮(LLM 全挂时服务端 30min 限流兜底,
 * 轮询本身不烧 LLM 调用)。date 缺省今日;切换历史日期自动重拉。
 */
export function useResearch(date?: string): ResearchHookResult {
  const [data, setData] = useState<ResearchData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const seq = useRef(0)

  const load = useCallback(
    async (rescan: boolean) => {
      const mySeq = ++seq.current
      try {
        if (rescan) {
          await fetch('/api/refresh?market=intel-research', { method: 'POST' }).catch(() => {})
        }
        const url = date ? `/api/intel/research?date=${encodeURIComponent(date)}` : '/api/intel/research'
        const res = await fetchWithTimeout(url, 20_000)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as ResearchData & { error?: string }
        if (json.error) throw new Error(json.error)
        if (mySeq !== seq.current) return
        setData(json)
        setLastUpdated(new Date())
        setError(null)
      } catch (e) {
        if (mySeq !== seq.current) return // 过期失败同样丢弃,不许盖住更新的数据
        throw e
      }
    },
    [date],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        await load(false)
      } catch {
        if (!cancelled) setError('research-load-failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      seq.current++
    }
  }, [load])

  // 收敛轮询:仅在有未完成分析时挂 timer,全部到终态自动停。「有已分析但汇总缺失」
  // 也算未完成——汇总 LLM 可能上轮失败,服务端 30 分钟窗口后会补生成,轮询要等到它落盘。
  // 飞书同步进行中同样算未完成:新 PDF 随时落盘,轮询等它出现。
  const hasUnfinished =
    !!data &&
    (data.analyzing ||
      (data.feishu?.syncing ?? false) ||
      data.reports.some((r) => r.status === 'pending') ||
      (data.llmConfigured && !data.digest && data.reports.some((r) => r.status === 'analyzed')))
  useEffect(() => {
    if (!hasUnfinished) return
    const timer = setInterval(() => {
      load(false).catch(() => {}) // 静默,保留旧数据
    }, CONVERGE_POLL_MS)
    return () => clearInterval(timer)
  }, [hasUnfinished, load])

  const refresh = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await load(true)
      return true
    } catch {
      setError('research-load-failed')
      return false
    } finally {
      setLoading(false)
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}

/** 可回看的研报日期列表(目录文件归属日 ∪ 已有汇总的日期,倒序)。 */
export function useResearchDates(): { dates: string[]; reload: () => void } {
  const [dates, setDates] = useState<string[]>([])
  const load = useCallback(() => {
    fetchWithTimeout('/api/intel/research/dates', 10_000)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: { dates?: string[] }) => setDates(Array.isArray(json.dates) ? json.dates : []))
      .catch(() => {}) // 日期列表是增强,失败静默(面板仍可看今日)
  }, [])
  useEffect(() => {
    load()
  }, [load])
  return { dates, reload: load }
}
