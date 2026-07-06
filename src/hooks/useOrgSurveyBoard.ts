import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

/** Mirror of server OrgSurveyBoardRow(server/services/orgSurveyBoard.ts)。 */
export interface OrgSurveyBoardRow {
  code: string
  name: string
  price: number
  changePct: number
  orgs: number
  surveyDays: number
  latestDate: string
  netInflow?: number // 当日主力净流入(元,best-effort;门控关/失败=显示 —)
}

export interface OrgSurveyBoardHookResult {
  data: OrgSurveyBoardRow[] | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

/** 机构调研榜(纯排行·非战法·非买点·未回测)。from /api/screener/org-survey-board。 */
export function useOrgSurveyBoard(): OrgSurveyBoardHookResult {
  const [data, setData] = useState<OrgSurveyBoardRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)

  const load = useCallback(async (rescan: boolean) => {
    if (rescan) {
      await fetch('/api/refresh?market=org-survey-board', { method: 'POST' }).catch(() => {})
    }
    const res = await fetchWithTimeout('/api/screener/org-survey-board', 30_000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as OrgSurveyBoardRow[] & { error?: string }
    if (!Array.isArray(json)) throw new Error((json as { error?: string }).error ?? 'invalid response')
    setData(json)
    setLastUpdated(new Date())
    setError(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        await load(false)
      } catch {
        if (!cancelled) setError('机构调研榜获取失败')
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
      setError('机构调研榜获取失败')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}
