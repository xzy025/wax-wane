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

/** 技术分析组合(Wyckoff+道氏+AlBrooks 量价)· 全战法整体评分因子(server technicalScore 镜像)。 */
export interface TechnicalCombo {
  score01: number // 0..1(0.5 中性);<0.5 供给、>0.5 需求
  bias: 'demand' | 'supply' | 'neutral'
  distribution: boolean // 强派发(大族式出货)→ 降档 + ⚠
  wyckoffPhase: string
  tags: string[]
  note: string
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
  firstBreakout?: boolean // 突破组:今日首次站上前高→「今日首次突破」;false=已突破仍在区内;缺失=旧快照
  watchReason?: string // 临界观察组:距触发还差什么
  distToPivotPct: number
  dist52Pct: number
  score: number
  pivots?: Pivots
  signals: { trendOk: boolean; volDry: boolean; atrContract: boolean; breakoutVol: boolean; pattern: string }
  lhbInst?: LhbConfluence
  board?: BoardConfluence
  appearStreak?: number // 连续出现天数(含今天,缺失=旧缓存快照)
  ta?: TechnicalCombo // 技术分析组合(Wyckoff+道氏+AlBrooks);全战法整体评分因子
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
  appearStreak?: number // 连续出现天数(含今天,缺失=旧缓存快照)
  ta?: TechnicalCombo // 技术分析组合(Wyckoff+道氏+AlBrooks);全战法整体评分因子
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
  appearStreak?: number // 连续出现天数(含今天,缺失=旧缓存快照)
  ta?: TechnicalCombo // 技术分析组合(Wyckoff+道氏+AlBrooks);全战法整体评分因子
}

/** Mirror of server VolBreakScreenerCandidate (放量新高·资金驱动突破). */
export interface VolBreakScreenerCandidate {
  group: 'volbreak'
  code: string
  name: string
  price: number
  changePct: number
  ma5: number
  ma21: number
  baseVol: number // 放量启动前基准均量
  volBurstDays: number // 近窗口放量达标天数
  volAvgRatio: number // 近均量 / 基准
  priorHigh: number // 被突破的 52 周前高
  dist52Pct: number
  entry: number
  stop: number
  target: number
  riskReward: number
  positionHint: string
  tier: number
  score: number
  reason: string
  riskNote?: string
  lhbInst?: LhbConfluence
  appearStreak?: number // 连续出现天数(含今天,缺失=旧缓存快照)
  ta?: TechnicalCombo // 技术分析组合(Wyckoff+道氏+AlBrooks);全战法整体评分因子
}

/** 资金流信息(实盘 live)。成交量排名免费(prefilter);主力净流入/排名/资金共振为未回测实盘加成。 */
export interface FundFlowInfo {
  netInflow?: number // 主力净流入额(元;买1/买2 档主动成交净额) —— 门控关/失败时缺
  netInflowPct?: number // 主力净流入占比%
  turnoverRank?: number // 成交量(成交额)排名
  inflowRank?: number // 主力净流入排名(仅 top200 内)
  resonance: boolean // 净流入∩成交量 双 top200(图里「资金共振」)
}

/** Mirror of server FundResScreenerCandidate (资金流共振·机构调研). */
export interface FundResScreenerCandidate {
  group: 'fundres'
  code: string
  name: string
  price: number
  changePct: number
  ma5: number
  ma20: number
  volRatio: number // 今量/近5日均量(成交量因子)
  mom: number // 近20日动量%
  surveyOrgs: number // 近 N 日调研机构家数
  gapUp: boolean // 今日是否高开
  gapPct: number // 高开幅度%
  entry: number
  stop: number
  target: number
  riskReward: number
  holdHint: number // 建议持股交易日数(≈3)
  positionHint: string
  tier: number
  score: number
  reason: string
  riskNote?: string
  fundFlow?: FundFlowInfo // 资金共振(实盘加成,无则不在双榜交集/门控关闭)
  lhbInst?: LhbConfluence
  appearStreak?: number
  ta?: TechnicalCombo // 技术分析组合(Wyckoff+道氏+AlBrooks);全战法整体评分因子
}

/** Mirror of server BHoldScreenerCandidate (突破整理·延续). */
export interface BHoldScreenerCandidate {
  group: 'bhold'
  code: string
  name: string
  price: number
  changePct: number
  consolDays: number // 整理小K线根数(1~2)
  poleBodyPct: number // pole 大阳线实体涨幅%
  poleVolRatio: number // pole 放量倍数
  poleClose: number
  priorHigh: number // pole 突破的前高
  higherHigh: boolean
  higherLow: boolean
  trigger: number // 确认入场位(次日突破此位介入)
  consolLow: number // 整理段最低(跌破放弃)
  entry: number // 收盘介入参考
  stop: number
  target: number
  riskReward: number
  positionHint: string
  tier: number
  score: number
  reason: string
  riskNote?: string
  lhbInst?: LhbConfluence
  appearStreak?: number
  ta?: TechnicalCombo // 技术分析组合(Wyckoff+道氏+AlBrooks);全战法整体评分因子
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
  volbreak?: VolBreakScreenerCandidate[] // 第五组:放量新高·资金驱动突破(可选,兼容旧快照)
  fundres?: FundResScreenerCandidate[] // 第六组:资金流共振·机构调研(可选,兼容旧快照)
  bhold?: BHoldScreenerCandidate[] // 第七组:突破整理·延续(可选,兼容旧快照)
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
