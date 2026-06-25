import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

export type ScreenerGroup = 'trigger' | 'breakout' | 'watch'

/** 龙虎榜加分(近 K 交易日机构/资金净买埋伏)。金额单位:元。 */
export interface LhbConfluence {
  onDays: number
  net: number
  instDays: number
  instNet: number
  hotDays: number
  hotNet: number
  score: number
}

export interface Pivots {
  r1: number
  r2: number
  s1: number
  s2: number
}

/** 板块强弱加分(个股所属行业板块当前 2×2 象限)。 */
export interface BoardConfluence {
  code: string
  name: string
  quadrant: 'hs' | 'ls' | 'hw' | 'lw'
  shortChg: number
  strong: boolean
  score: number
}

/** Mirror of server ScreenerCandidate (server/services/screener.ts). */
export interface ScreenerCandidate {
  group: ScreenerGroup
  code: string
  name: string
  price: number
  changePct: number
  pivot: number
  entry?: number // 介入/试探价=收盘(缺失=旧缓存快照,回退 price)
  add?: number // 加仓价:突破组金字塔+1R / 扳机组=pivot(缺失=旧缓存快照)
  stopLoss: number
  target: number
  rsRaw: number
  coil: number
  trendStrength: number
  volRatio: number
  atrRatio: number
  volScore: number
  breakoutVolRatio?: number // 今日量/50日均量(放量倍数,缺失=旧缓存快照)
  ma5?: number // 5日线(加仓参考,缺失=旧缓存快照)
  watchReason?: string // 临界观察组:距触发还差什么
  distToPivotPct: number
  dist52Pct: number
  score: number
  pivots?: Pivots
  signals: { trendOk: boolean; volDry: boolean; atrContract: boolean; breakoutVol: boolean; pattern: string }
  lhbInst?: LhbConfluence
  board?: BoardConfluence
}

/** Mirror of server PullbackScreenerCandidate (回调二次启动/圆弧底反包). */
export interface PullbackScreenerCandidate {
  code: string
  name: string
  price: number
  changePct: number
  priorHigh: number // 近高(=测量目标/前高)
  arcLow: number // 圆弧底低点(=止损位)
  retracePct: number // 距近高回调%
  daysSinceHigh: number
  recoverPct: number // 自低回升%
  stopLoss: number
  target: number
  rsRaw: number
  score: number
  pivots?: Pivots
  volSpikeRatio?: number // 今日量/均量(异常放量倍数,缺失=旧缓存快照)
  signals: { leader: boolean; arcUp: boolean; maCrossNear: boolean; volSpike: boolean; pattern: string }
  lhbInst?: LhbConfluence
}

/** Mirror of server HighDivScreenerCandidate (连续新高·缩量十字星·守MA5 分歧低吸). */
export interface HighDivScreenerCandidate {
  group: 'highdiv'
  code: string
  name: string
  price: number
  changePct: number
  nhHigh: number // 近期新高
  retraceFromHigh: number // 距新高回撤%
  dryRatio: number // 缩量倍数(今日量/昨量)
  bodyRatio: number // 实体率(越小越像十字星)
  consolDays: number // 整理持续天数(连续缩量站MA5)
  amplitude: number
  lowerWick: number // 下影/振幅
  turnoverRate?: number // 今日换手率%(过高已降 tier)
  ma5: number
  ma10: number
  ma20: number
  upperHalf: boolean // 收盘在振幅上半区(弱转强代理)
  entry: number
  stop: number
  target: number
  riskReward: number
  positionHint: string
  tier: number
  score: number
  kPath: string
  reason: string
  riskNote?: string
  lhbInst?: LhbConfluence
}

export interface ScreenerRegime {
  phase: 'attack' | 'caution' | 'retreat'
  temperature: number
  limitUp: number
  limitDown: number
  breakRate: number
  note: string
  marketTrend: 'strong' | 'neutral' | 'weak'
  targetRMult: number
}

export interface ScreenerResult {
  asof: string
  regime: ScreenerRegime
  breakout: ScreenerCandidate[]
  trigger: ScreenerCandidate[]
  watch?: ScreenerCandidate[] // 临界观察(可选,兼容旧缓存快照)
  pullback: PullbackScreenerCandidate[]
  highdiv?: HighDivScreenerCandidate[] // 第四组:连续新高分歧低吸(可选,兼容旧快照)
  scanned: number
  scannedPullback: number
  universe: number
  truncated: boolean
  savedAt?: string
  closed?: boolean
  fromCache?: boolean // 本次响应来自服务端磁盘存档兜底(重启/盘后/过0点)
}

export interface ScreenerHookResult {
  data: ScreenerResult | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  /** Re-run the scan: clears the server cache then re-fetches (the 每日扫描 button). */
  refresh: () => void
}

/**
 * Fetches the 新高战法 screener result from /api/screener. Error policy mirrors
 * useThemes: keep last-good data, surface `error`. The whole-market scan can
 * take ~10-30s on a cold cache, so the fetch timeout is generous.
 */
export function useScreener(): ScreenerHookResult {
  const [data, setData] = useState<ScreenerResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)

  const load = useCallback(async (rescan: boolean) => {
    if (rescan) {
      await fetch('/api/refresh?market=screener', { method: 'POST' }).catch(() => {})
    }
    const res = await fetchWithTimeout('/api/screener', 200_000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as ScreenerResult & { error?: string }
    if (json.error) throw new Error(json.error)
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
        if (!cancelled) setError('选股数据获取失败')
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
      setError('选股数据获取失败')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  return { data, loading, error, lastUpdated, refresh }
}
