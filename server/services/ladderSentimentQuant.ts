import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

export const LADDER_SENTIMENT_QUANT_VERSION = 'ladder-sentiment-quant-v1'

export type SentimentGateState = 'NORMAL' | 'HOT' | 'JOINT_CLIMAX' | 'UNAVAILABLE'
export type SentimentQuantStatus = 'complete' | 'partial' | 'unavailable'
export type SentimentMetricState = 'hot' | 'cold' | 'unavailable'

export interface BoardOutcomeMark {
  code: string
  changePct: number | null
  isLimitUp?: boolean | null
}

export interface SentimentMarketInput {
  limitUpCount: number | null
  ladderCount: number | null
  previousLadderCount: number | null
  down5Count: number | null
  advanceCount: number | null
  declineCount: number | null
  flatCount: number | null
  validTradeCount?: number | null
}

export interface CrowdingInput {
  currentMidAmount: number | null
  previousMidAmount: number | null
  currentCloseAmount: number | null
  previousCloseAmount: number | null
  historicalMidRatios?: number[]
  historicalCloseRatios?: number[]
}

export interface SentimentQuantInput {
  asof: string
  generatedAt?: string
  market: SentimentMarketInput
  previousFirstBoards?: BoardOutcomeMark[]
  previousLadderBoards?: BoardOutcomeMark[]
  currentMarks?: Record<string, BoardOutcomeMark>
  crowding?: CrowdingInput | null
  source?: string
  sourceStatus?: Record<string, 'ok' | 'degraded' | 'missing'>
}

export interface SentimentMetric {
  id: string
  label: string
  value: number | null
  threshold: string
  state: SentimentMetricState
  score: -2 | 2 | null
  denominator: number | null
  coverage: number | null
  evidence: string
}

export interface EmotionScore {
  score: number | null
  maxScore: number
  coverage: number
  metrics: SentimentMetric[]
  missingReasons: string[]
}

export interface CrowdingSnapshot {
  status: 'available' | 'unavailable'
  rMid: number | null
  rClose: number | null
  percentileMid: number | null
  percentileClose: number | null
  percentile: number | null
  level: 'low' | 'normal' | 'high' | 'extreme' | 'unavailable'
  evidence: string[]
  missingReasons: string[]
}

export interface LadderSentimentQuantSnapshot {
  schemaVersion: string
  asof: string
  generatedAt: string
  status: SentimentQuantStatus
  source: string
  sourceStatus: Record<string, 'ok' | 'degraded' | 'missing'>
  emotion: EmotionScore
  market: EmotionScore
  B: number | null
  M: number | null
  C: number | null
  crowding: CrowdingSnapshot
  gateState: SentimentGateState
  nextDayRelayWeight: 0 | 0.25 | 1 | null
  noNewRelay: boolean
  warnings: string[]
  evidence: string[]
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const LADDER_ROOT = join(__dirname, '..', '..', 'docs', 'ladder')
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const r2 = (value: number) => Math.round(value * 100) / 100
const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function ratio(numerator: number | null, denominator: number | null): number | null {
  return finite(numerator) && finite(denominator) && denominator > 0 ? numerator / denominator : null
}

function metric(args: {
  id: string
  label: string
  value: number | null
  threshold: string
  hot: boolean | null
  denominator?: number | null
  coverage?: number | null
  evidence: string
}): SentimentMetric {
  return {
    id: args.id,
    label: args.label,
    value: args.value == null ? null : r2(args.value),
    threshold: args.threshold,
    state: args.hot == null ? 'unavailable' : args.hot ? 'hot' : 'cold',
    score: args.hot == null ? null : args.hot ? 2 : -2,
    denominator: args.denominator ?? null,
    coverage: args.coverage == null ? null : r2(args.coverage * 100),
    evidence: args.evidence,
  }
}

function outcomeRatios(
  previous: BoardOutcomeMark[] | undefined,
  currentMarks: Record<string, BoardOutcomeMark> | undefined,
  kind: 'red' | 'big-face' | 'green-non-limit',
): { value: number | null; denominator: number; coverage: number | null; reason: string } {
  const rows = previous ?? []
  if (rows.length < 5) return { value: null, denominator: rows.length, coverage: 0, reason: '样本少于5只' }
  const current = rows.map((row) => currentMarks?.[row.code]).filter((row): row is BoardOutcomeMark => !!row && finite(row.changePct))
  const coverage = current.length / rows.length
  if (coverage < 0.95) return { value: null, denominator: rows.length, coverage, reason: `当前结果覆盖率${(coverage * 100).toFixed(1)}%<95%` }
  const matches = current.filter((row) => {
    if (kind === 'red') return (row.changePct ?? 0) > 0
    if (kind === 'big-face') return (row.changePct ?? 0) <= -5
    return row.isLimitUp !== true && (row.changePct ?? 0) < 0
  }).length
  return { value: matches / current.length, denominator: rows.length, coverage, reason: `${matches}/${current.length}` }
}

export function percentile(value: number | null, history: number[]): number | null {
  if (!finite(value)) return null
  const valid = history.filter(finite).sort((a, b) => a - b)
  if (valid.length < 20) return null
  const below = valid.filter((item) => item < value).length
  const equal = valid.filter((item) => item === value).length
  return r2(((below + Math.max(0, equal - 1) / 2) / Math.max(valid.length - 1, 1)) * 100)
}

export function computeEmotionScore(args: {
  previousFirstBoards?: BoardOutcomeMark[]
  previousLadderBoards?: BoardOutcomeMark[]
  currentMarks?: Record<string, BoardOutcomeMark>
  currentLadderCount: number | null
  previousLadderCount: number | null
}): EmotionScore {
  const firstRed = outcomeRatios(args.previousFirstBoards, args.currentMarks, 'red')
  const firstFace = outcomeRatios(args.previousFirstBoards, args.currentMarks, 'big-face')
  const ladderRed = outcomeRatios(args.previousLadderBoards, args.currentMarks, 'red')
  const ladderFace = outcomeRatios(args.previousLadderBoards, args.currentMarks, 'big-face')
  const ladderGreenNonLimit = outcomeRatios(args.previousLadderBoards, args.currentMarks, 'green-non-limit')
  const countRatio = ratio(args.currentLadderCount, args.previousLadderCount)
  const metrics = [
    metric({ id: 'first-red', label: '昨日首板今日红盘比', value: firstRed.value, threshold: '>60%', hot: firstRed.value == null ? null : firstRed.value > 0.6, denominator: firstRed.denominator, coverage: firstRed.coverage, evidence: firstRed.reason }),
    metric({ id: 'first-big-face', label: '昨日首板今日大面比', value: firstFace.value, threshold: '<=30%', hot: firstFace.value == null ? null : firstFace.value <= 0.3, denominator: firstFace.denominator, coverage: firstFace.coverage, evidence: firstFace.reason }),
    metric({ id: 'ladder-red', label: '昨日连板今日红盘比', value: ladderRed.value, threshold: '>60%', hot: ladderRed.value == null ? null : ladderRed.value > 0.6, denominator: ladderRed.denominator, coverage: ladderRed.coverage, evidence: ladderRed.reason }),
    metric({ id: 'ladder-count-ratio', label: '今日/昨日主板连板数', value: countRatio, threshold: '>1.00', hot: countRatio == null ? null : countRatio > 1, denominator: args.previousLadderCount, coverage: countRatio == null ? 0 : 1, evidence: countRatio == null ? '缺少前后连板数' : `${args.currentLadderCount}/${args.previousLadderCount}` }),
    metric({ id: 'ladder-big-face', label: '昨日连板今日大面比', value: ladderFace.value, threshold: '<=30%', hot: ladderFace.value == null ? null : ladderFace.value <= 0.3, denominator: ladderFace.denominator, coverage: ladderFace.coverage, evidence: ladderFace.reason }),
    metric({ id: 'ladder-green-non-limit', label: '昨日连板未涨停且收绿比例', value: ladderGreenNonLimit.value, threshold: '<=40%', hot: ladderGreenNonLimit.value == null ? null : ladderGreenNonLimit.value <= 0.4, denominator: ladderGreenNonLimit.denominator, coverage: ladderGreenNonLimit.coverage, evidence: ladderGreenNonLimit.reason }),
  ]
  const available = metrics.filter((item) => item.score != null)
  const coverage = available.length / metrics.length
  const missingReasons = metrics.filter((item) => item.score == null).map((item) => `${item.label}不可用：${item.evidence}`)
  return {
    score: coverage === 1 ? available.reduce((sum, item) => sum + (item.score ?? 0), 0) : null,
    maxScore: 12,
    coverage: r2(coverage),
    metrics,
    missingReasons,
  }
}

export function computeMarketScore(input: SentimentMarketInput): EmotionScore {
  const valid = input.validTradeCount ?? (
    finite(input.advanceCount) && finite(input.declineCount) && finite(input.flatCount)
      ? input.advanceCount + input.declineCount + input.flatCount
      : null
  )
  const upRate = ratio(input.advanceCount, valid)
  const lossEffect = ratio(input.down5Count, input.limitUpCount)
  const metrics = [
    metric({ id: 'limit-up-count', label: '涨停数', value: input.limitUpCount, threshold: '>=40', hot: input.limitUpCount == null ? null : input.limitUpCount >= 40, denominator: valid, coverage: input.limitUpCount == null ? 0 : 1, evidence: input.limitUpCount == null ? '缺少涨停数' : `${input.limitUpCount}` }),
    metric({ id: 'ladder-count', label: '连板股数', value: input.ladderCount, threshold: '>=11', hot: input.ladderCount == null ? null : input.ladderCount >= 11, denominator: input.ladderCount, coverage: input.ladderCount == null ? 0 : 1, evidence: input.ladderCount == null ? '缺少连板数' : `${input.ladderCount}` }),
    metric({ id: 'down-five-count', label: '跌幅低于-5%家数', value: input.down5Count, threshold: '<=100', hot: input.down5Count == null ? null : input.down5Count <= 100, denominator: valid, coverage: input.down5Count == null ? 0 : 1, evidence: input.down5Count == null ? '缺少-5%以下家数' : `${input.down5Count}` }),
    metric({ id: 'advance-rate', label: '上涨家数/有效交易家数', value: upRate, threshold: '>=40%', hot: upRate == null ? null : upRate >= 0.4, denominator: valid, coverage: upRate == null ? 0 : 1, evidence: upRate == null ? '缺少涨跌家数' : `${input.advanceCount}/${valid}` }),
    metric({ id: 'loss-effect', label: '亏钱效应比', value: lossEffect, threshold: '<=2.0', hot: lossEffect == null ? null : lossEffect <= 2, denominator: input.limitUpCount, coverage: lossEffect == null ? 0 : 1, evidence: lossEffect == null ? '缺少-5%家数或涨停数' : `${input.down5Count}/${input.limitUpCount}` }),
  ]
  const available = metrics.filter((item) => item.score != null)
  const coverage = available.length / metrics.length
  return {
    score: coverage === 1 ? available.reduce((sum, item) => sum + (item.score ?? 0), 0) : null,
    maxScore: 10,
    coverage: r2(coverage),
    metrics,
    missingReasons: metrics.filter((item) => item.score == null).map((item) => `${item.label}不可用：${item.evidence}`),
  }
}

export function computeCrowding(input: CrowdingInput | null | undefined): CrowdingSnapshot {
  if (!input) return { status: 'unavailable', rMid: null, rClose: null, percentileMid: null, percentileClose: null, percentile: null, level: 'unavailable', evidence: [], missingReasons: ['未采集午间/收盘触板池成交额'] }
  const rMid = ratio(input.currentMidAmount, input.previousMidAmount)
  const rClose = ratio(input.currentCloseAmount, input.previousCloseAmount)
  const percentileMid = percentile(rMid, input.historicalMidRatios ?? [])
  const percentileClose = percentile(rClose, input.historicalCloseRatios ?? [])
  const values = [percentileMid, percentileClose].filter(finite)
  if (values.length < 2) return { status: 'unavailable', rMid: rMid == null ? null : r2(rMid), rClose: rClose == null ? null : r2(rClose), percentileMid, percentileClose, percentile: null, level: 'unavailable', evidence: [], missingReasons: ['252日同刻基线不足，拥挤度只作实验性展示'] }
  const p = r2(values.reduce((sum, value) => sum + value, 0) / values.length)
  return { status: 'available', rMid: r2(rMid as number), rClose: r2(rClose as number), percentileMid, percentileClose, percentile: p, level: p >= 90 ? 'extreme' : p >= 75 ? 'high' : p <= 25 ? 'low' : 'normal', evidence: [`午间比${(rMid as number).toFixed(2)}x`, `收盘比${(rClose as number).toFixed(2)}x`, `252日拥挤分位P${p.toFixed(0)}`], missingReasons: [] }
}

export function buildLadderSentimentQuantSnapshot(input: SentimentQuantInput): LadderSentimentQuantSnapshot {
  const emotion = computeEmotionScore({
    previousFirstBoards: input.previousFirstBoards,
    previousLadderBoards: input.previousLadderBoards,
    currentMarks: input.currentMarks,
    currentLadderCount: input.market.ladderCount,
    previousLadderCount: input.market.previousLadderCount,
  })
  const market = computeMarketScore(input.market)
  const crowding = computeCrowding(input.crowding)
  const B = emotion.score
  const M = market.score
  const C = B != null && M != null ? B + M : null
  const gateState: SentimentGateState = B == null || M == null
    ? 'UNAVAILABLE'
    : B === 12 && M === 10
      ? 'JOINT_CLIMAX'
      : B >= 8 && M >= 6
        ? 'HOT'
        : 'NORMAL'
  const nextDayRelayWeight = gateState === 'JOINT_CLIMAX' ? 0 : gateState === 'HOT' ? 0.25 : gateState === 'NORMAL' ? 1 : null
  const warnings = [
    ...emotion.missingReasons,
    ...market.missingReasons,
    ...crowding.missingReasons,
  ]
  if (gateState === 'JOINT_CLIMAX') warnings.push('昨日主板情绪与大盘势能同时满分，次日全天NO_NEW_RELAY')
  if (gateState === 'UNAVAILABLE') warnings.push('关键情绪数据缺失，不按中性值放行')
  return {
    schemaVersion: LADDER_SENTIMENT_QUANT_VERSION,
    asof: input.asof,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: B == null || M == null ? 'unavailable' : crowding.status === 'unavailable' ? 'partial' : 'complete',
    source: input.source ?? 'derived',
    sourceStatus: input.sourceStatus ?? {},
    emotion,
    market,
    B,
    M,
    C,
    crowding,
    gateState,
    nextDayRelayWeight,
    noNewRelay: gateState === 'JOINT_CLIMAX',
    warnings: Array.from(new Set(warnings)),
    evidence: [
      `B=${B == null ? '--' : B}`,
      `M=${M == null ? '--' : M}`,
      `C=${C == null ? '--' : C}`,
      `次日接力权重=${nextDayRelayWeight == null ? '--' : nextDayRelayWeight}`,
    ],
  }
}

function archivePath(asof: string): string {
  const [year, month, day] = asof.split('-')
  return join(LADDER_ROOT, year, month, day, `${LADDER_SENTIMENT_QUANT_VERSION}.json`)
}

export function readLadderSentimentQuant(asof: string): LadderSentimentQuantSnapshot | null {
  try { return JSON.parse(readFileSync(archivePath(asof), 'utf8')) as LadderSentimentQuantSnapshot } catch { return null }
}

export function writeLadderSentimentQuant(snapshot: LadderSentimentQuantSnapshot): void {
  const path = archivePath(snapshot.asof)
  const existing = readLadderSentimentQuant(snapshot.asof)
  if (existing?.status === 'complete' && snapshot.status !== 'complete') return
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(snapshot, null, 2), 'utf8')
  renameSync(temp, path)
}

export function listLadderSentimentQuant(limit = 30, asof?: string): LadderSentimentQuantSnapshot[] {
  if (!existsSync(LADDER_ROOT)) return []
  const rows: LadderSentimentQuantSnapshot[] = []
  for (const year of readdirSync(LADDER_ROOT)) {
    if (!/^\d{4}$/.test(year)) continue
    for (const month of readdirSync(join(LADDER_ROOT, year))) {
      if (!/^\d{2}$/.test(month)) continue
      for (const day of readdirSync(join(LADDER_ROOT, year, month))) {
        const date = `${year}-${month}-${day}`
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (asof && date > asof)) continue
        const value = readLadderSentimentQuant(date)
        if (value) rows.push(value)
      }
    }
  }
  return rows.sort((a, b) => b.asof.localeCompare(a.asof)).slice(0, Math.max(1, limit))
}
