import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

const LADDER_SNAPSHOT_PREFIX = 'limit-ladder-snapshot-v6:'
const CURRENT_LADDER_RULE_VERSION = 'limit-ladder-v6'

async function fetchLadderJson<T>(url: string, timeoutMs: number): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, timeoutMs, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const json = (await response.json()) as T & { error?: string }
      if (!response.ok || json.error) {
        throw new Error(json.error ?? 'HTTP ' + response.status)
      }
      return json
    } catch (reason) {
      lastError = reason
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  if (lastError instanceof TypeError && lastError.message === 'Failed to fetch') {
    throw new Error('连板天梯服务不可达：请确认后端 3002 与 Vite 代理均已启动')
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to load ladder data')
}

function readLadderSnapshot(date: string): LimitLadderAnalysis | null {
  try {
    const raw = localStorage.getItem(`${LADDER_SNAPSHOT_PREFIX}${date}`)
    if (!raw) return null
    const value = JSON.parse(raw) as LimitLadderAnalysis
    if (!value.archived || value.asof !== date) return null
    const now = new Date()
    const shanghai = new Date(now.getTime() + now.getTimezoneOffset() * 60_000 + 8 * 3_600_000)
    const today = shanghai.toISOString().slice(0, 10)
    if (date === today && value.ruleVersion !== CURRENT_LADDER_RULE_VERSION) return null
    const afterLhb = shanghai.getHours() * 60 + shanghai.getMinutes() >= 16 * 60 + 30
    return afterLhb && value.quality.fundFlowComplete === false ? null : value
  } catch {
    return null
  }
}

function writeLadderSnapshot(value: LimitLadderAnalysis): void {
  if (!value.archived) return
  try {
    localStorage.setItem(`${LADDER_SNAPSHOT_PREFIX}${value.asof}`, JSON.stringify(value))
  } catch {
    // 浏览器禁用存储或配额不足时退化为服务端快照，不影响展示。
  }
}

export type LadderState = 'candidate' | 'waiting' | 'observe' | 'exclude'
export type NextDayState =
  | 'pending'
  | 'auction-qualified'
  | 'confirmed'
  | 'waiting'
  | 'blocked'
  | 'rejected'
export type MarketCyclePhase = 'ice' | 'repair' | 'climax' | 'ebb' | 'unavailable'
export type ThemeGrade = 'A' | 'B' | 'C' | 'D'
export type LadderRole =
  | 'space-leader'
  | 'theme-leader'
  | 'first-pioneer'
  | 'mid-ladder'
  | 'follower'
export type ShapeArchetype =
  | 'low-platform-breakout'
  | 'platform-breakout'
  | 'trend-platform'
  | 'low-oversold-reversal'
  | 'event-reversal'
  | 'high-new-high'
  | 'non-platform-breakout'
  | 'insufficient'

export type ExpectationPath =
  | 'tradable-acceleration'
  | 'divergence-reseal'
  | 'one-price-untradeable'
  | 'break-failure'

export interface BoardSequenceEvidence {
  code: string
  name: string
  latestThree: Array<{
    date: string
    boardType: string
    volumeRatio: number | null
    volumeLabel: string
    volumeIsDouble: boolean
    coverage: number
    dataQuality: 'full' | 'partial' | 'unavailable'
    missingReasons: string[]
  }>
  signature: string[]
  volumeRatios: Array<number | null>
  coverage: number
  dataQuality: 'full' | 'partial' | 'unavailable'
  qingshanPattern: boolean
  missingReasons: string[]
}

export interface RelayExpectation {
  status: 'research-score'
  modelStatus: 'shadow-heuristic' | 'shadow-logistic' | 'unavailable'
  modelVersion: string
  primaryPath: ExpectationPath | null
  probabilities: Record<ExpectationPath, number | null>
  heuristicScores?: Record<ExpectationPath, number | null>
  calibratedProbabilities?: Record<ExpectationPath, number> | null
  probabilityStatus?: 'unavailable' | 'research-score' | 'calibrated' | string
  confidence: number | null
  clearExpectation: boolean
  expectedOpenGapPct: [number, number] | null
  expectedTouchTime: [string, string] | null
  expectedMaxReopenCount: number | null
  allowedPaths: ExpectationPath[]
  prohibitedPaths: ExpectationPath[]
  sequence: BoardSequenceEvidence
  evidence: string[]
  missingReasons: string[]
}

export interface ExpectationMatch {
  status: 'met' | 'partial' | 'violated' | 'unavailable'
  fit: number | null
  componentScores: {
    openGap: number | null
    preSealAmount: number | null
    firstTouch: number | null
    reopen: number | null
    theme: number | null
  }
  matched: string[]
  unmet: string[]
  missingReasons: string[]
}

export type SentimentGateState = 'NORMAL' | 'HOT' | 'JOINT_CLIMAX' | 'UNAVAILABLE'
export type SentimentQuantStatus = 'complete' | 'partial' | 'unavailable'

export interface SentimentMetric {
  id: string
  label: string
  value: number | null
  threshold: string
  state: 'hot' | 'cold' | 'unavailable'
  score: -2 | 2 | null
  denominator: number | null
  coverage: number | null
  evidence: string
}

export interface LadderSentimentQuantSnapshot {
  schemaVersion: string
  asof: string
  generatedAt: string
  status: SentimentQuantStatus
  source: string
  sourceStatus: Record<string, 'ok' | 'degraded' | 'missing'>
  emotion: { score: number | null; maxScore: number; coverage: number; metrics: SentimentMetric[]; missingReasons: string[] }
  market: { score: number | null; maxScore: number; coverage: number; metrics: SentimentMetric[]; missingReasons: string[] }
  B: number | null
  M: number | null
  C: number | null
  crowding: {
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
  gateState: SentimentGateState
  nextDayRelayWeight: 0 | 0.25 | 1 | null
  noNewRelay: boolean
  warnings: string[]
  evidence: string[]
}

export type ThemeLadderRelation =
  | 'replenishment'
  | 'leader-driven'
  | 'follower'
  | 'isolated'
  | 'unavailable'

export interface ThemeLadderEvidence {
  relation: ThemeLadderRelation
  score: number | null
  bonus: number
  parentTheme: string
  leader: { code: string; name: string; consecutiveDays: number } | null
  lowerLadderCodes: string[]
  lowerLadderCount: number
  lowerLadderPositiveRate: number | null
  themeGrade: ThemeGrade | null
  themeBreadth: number | null
  themeContinuity: number | null
  themePromotionRate: number | null
  evidence: string[]
  missingReasons: string[]
  note: string
}

export interface LadderImportStock {
  code: string
  name?: string
  status?: string
  consecutiveDays?: number
  nDayBoards?: string
  themes?: string[]
  subtheme?: string
  role?: string
  reason?: string
  firstTime?: string
  lastTime?: string
  openCount?: number
  turnoverRate?: number
  amount?: number
  sealAmount?: number
  onePrice?: boolean
  vwapPct?: number | null
  vwapHold?: boolean | null
}

export interface LadderImportPayload {
  asof: string
  stocks: LadderImportStock[]
}

export type FirstBoardScanStatus = 'live' | 'closed' | 'unavailable'
export type FirstBoardScanBoardType = 'main' | 'twenty' | 'beijing'
export type FirstBoardLifecycle =
  | 'detected'
  | 'sealed'
  | 'opened'
  | 'resealed'
  | 'closed-limit'
  | 'failed'
export type FirstBoardScoreCategory = 'focus' | 'observe' | 'low-priority' | 'data-insufficient'
export type FirstBoardDimensionKey =
  | 'market'
  | 'theme'
  | 'seal'
  | 'structure'
  | 'price-volume'
  | 'wyckoff'
  | 'brooks'

export interface FirstBoardDimensionScore {
  key: FirstBoardDimensionKey
  score: number | null
  weight: number
  confidence: number
  asOf: string
  evidence: string[]
  unavailableReason?: string
}

export interface FirstBoardCompositeScore {
  moment: 'discovery' | 'settled'
  scoreVersion: string
  rawScore: number | null
  finalScore: number | null
  provisionalScore?: number | null
  effectiveCoverage?: number
  rankEligible?: boolean
  requiredGroupsComplete?: boolean
  pointInTimeCausal?: boolean
  settledFreshContractSatisfied?: boolean
  coverage: number
  missingDimensions?: FirstBoardDimensionKey[]
  manifest?: {
    version: string
    dimensions: Record<string, { weight: number; input: string }>
  }
  category: FirstBoardScoreCategory
  dimensions: FirstBoardDimensionScore[]
}

export interface FirstBoardScanCandidate {
  code: string
  name: string
  price: number
  changePct: number
  firstTime: string
  nDayBoards?: string
  firstSeenAt: string
  amount: number
  turnoverRate: number
  sealAmount: number
  primaryTheme: string
  boardType: FirstBoardScanBoardType
  onePrice: boolean
  tBoard: boolean
  reason: string
  eligibility: {
    status: 'eligible' | 'ineligible' | 'unknown'
    eligible: boolean
    statusEvidence: 'historical-master' | 'provider-field' | 'name-regex' | 'missing'
    confidence: 'high' | 'degraded' | 'unknown'
    reasons: string[]
  }
  tradability: {
    status: 'tradable' | 'not-tradable' | 'unknown'
    confidence: number
    reasons: string[]
  }
  lifecycle: FirstBoardLifecycle
  lifecycleHistory: Array<{ at: string; lifecycle: FirstBoardLifecycle; reason: string }>
  firstDetectedAt: string
  lastObservedAt: string
  providerFirstSealAt: string
  lastSealAt: string
  firstSeenSequence: number
  latestSequence: number
  openCount: number
  providerOpenCount?: number | null
  observedOpenCount?: number
  everDetected: boolean
  currentlySealed: boolean
  finalSealed: boolean | null
  rankEligible?: boolean
  initialPrice: number
  initialAmount: number
  initialTurnoverRate: number
  initialSealAmount: number
  source: string
  fromCache: boolean
  dataAsOf: string
  dataQuality: 'full' | 'degraded' | 'insufficient'
  evidenceStatus: 'live' | 'verified' | 'provisional' | 'unavailable'
  sourceConflict: string[]
  discoveryScore: FirstBoardCompositeScore
  discoverySnapshot?: {
    snapshotId: string
    observedAt: string
    decisionAt: string
    inputHash: string
    source: string
    providerAt: string | null
    dataQuality: 'full' | 'degraded' | 'insufficient'
    price: number
    amount: number
    turnoverRate: number
    sealAmount: number
    firstTime: string
    openCount: number
    score: FirstBoardCompositeScore
    selectionScore: number | null
  }
  liveSnapshot?: FirstBoardScanCandidate['discoverySnapshot']
  settlementSnapshot?: FirstBoardScanCandidate['discoverySnapshot'] | null
  liveScore?: FirstBoardCompositeScore
  discoverySnapshotRef?: string
  settlementSnapshotRef?: string | null
  settledScore: FirstBoardCompositeScore | null
  selectionScore?: number | null
  themeLadder?: {
    state: 'complete' | 'partial' | 'none' | 'unavailable'
    levels: number[]
    maxBoards: number
    higherBoardCount: number
    bonus: number
    evidence: string[]
  }
  wyckoffPhase: string | null
  wyckoffEvents: string[]
  brooksContext: string | null
  brooksEvents: string[]
  relayPathEvidence?: {
    coverage?: { overall?: number; missingReasons?: string[] }
    missingReasons?: string[]
    boardClass?: string
  }
  relayPathScore?: {
    pathResearchScore?: number | null
    pathCoverage?: number
    dataConfidence?: number
    failedConditions?: string[]
    probabilityStatus?: string
  }
}

export interface FirstBoardScanSnapshot {
  slot: number
  scannedAt: string
  newCount: number
  firstBoardCount: number
  excludedStCount: number
  accepted: boolean
  observationKey: string
  dataQuality: 'full' | 'degraded' | 'insufficient'
  rejectionReasons: string[]
}

export interface FirstBoardScanResponse {
  tradeDate: string
  generatedAt: string
  schemaVersion: string
  scoreVersion: string
  ruleVersion: string
  sourceVersion?: string
  rulesVersion?: string
  status: FirstBoardScanStatus
  window: {
    start: string
    end: string
    intervalMinutes: number
    intervalSeconds: number
  }
  lastScanAt: string | null
  nextScanAt: string | null
  scanCount: number
  rejectedObservationCount: number
  candidates: FirstBoardScanCandidate[]
  allCandidates?: FirstBoardScanCandidate[]
  everDetectedPool?: FirstBoardScanCandidate[]
  finalSealedPool?: FirstBoardScanCandidate[]
  rankEligiblePool?: FirstBoardScanCandidate[]
  displayPool?: FirstBoardScanCandidate[]
  hardEligiblePool?: FirstBoardScanCandidate[]
  rankedPool?: FirstBoardScanCandidate[]
  displayCandidates?: FirstBoardScanCandidate[]
  snapshots: FirstBoardScanSnapshot[]
  excludedStCount: number
  dataQuality: 'full' | 'degraded' | 'insufficient'
  dataAsOf: string | null
  source: string
  fromCache: boolean
  evidenceStatus: 'live' | 'verified' | 'provisional' | 'unavailable'
  warnings: string[]
}

export interface ThemeAnalysis {
  name: string
  grade: ThemeGrade
  score: number
  count: number
  firstBoardCount: number
  multiBoardCount: number
  maxBoards: number
  continuity: number
  promotionRate: number | null
  sealStability: number
  stockCodes: string[]
  anchorCount?: number
  complete?: boolean
  components?: Record<string, number | null>
}

export interface ThemeAnchor {
  code: string
  name: string
  themes: string[]
  source: 'current-high-board' | 'recent-high-anchor'
  priorMaxBoards: number
  recentLimitUps: number
  distanceFromFiveDayHighPct: number | null
  active: boolean
}

export interface PromotionLane {
  fromBoards: number
  toBoards: number
  label: string
  score: number
  supply: number
  promotionRate: number | null
  promoted: number
  promotionTotal: number
  themeCoverage: number
  upperAnchor: number
  sealStability: number
  dominant: boolean
  rawPromotionRate?: number | null
  adjustedPromotionRate?: number | null
  promotionConfidence?: 'low' | 'medium' | 'high'
  rollingValid?: number
  rollingPromoted?: number
}

export type MarketPositionRole = 'space-leader' | 'co-space-leader' | 'high-anchor' | 'normal'
export type ThemePositionRole =
  | 'theme-position-leader'
  | 'co-theme-position-leader'
  | 'core-assistant'
  | 'follower'
export type LadderHeightTier = 'high' | 'middle' | 'low'
export type LadderLifecycle =
  | 'acceleration'
  | 'consensus'
  | 'divergence'
  | 'broken-maintain'
  | 'repair-relaunch'
  | 'ebb'

export interface LadderRoleProfile {
  code: string
  name: string
  primaryTheme: string
  themes: string[]
  boards: number
  marketRole: MarketPositionRole
  themeRole: ThemePositionRole
  heightTier: LadderHeightTier
  lifecycle: LadderLifecycle
  onePrice: boolean
  positionDelta: number
  peerCodes: string[]
  leadingDays: number
  cardedCodes: string[]
  wasCardedBy: string[]
  followerCount: number
  confidence: number
  evidence: string[]
}

export interface LadderRoleMap {
  maxBoards: number
  spaceLeaderCodes: string[]
  profiles: LadderRoleProfile[]
  brokenAnchors: LadderRoleProfile[]
}

export interface LadderRiskEvent {
  id: string
  publishedAt: string
  source: string
  sourceUrl: string
  title: string
  summary: string
  codes: string[]
  themes: string[]
  scope: 'stock' | 'theme' | 'market'
  category: string
  direction: 'positive' | 'negative' | 'neutral'
  severity: 1 | 2 | 3 | 4 | 5
  confidence: 'official' | 'verified' | 'unverified'
  action: 'hard-block' | 'risk-cap' | 'theme-adjust' | 'informational'
  effectiveUntil: string
  evidence: string[]
}

export interface LadderEventGate {
  generatedAt: string
  coverage: number
  sourceStatus: Record<string, boolean>
  events: LadderRiskEvent[]
  hardBlockedCodes: string[]
  riskCappedCodes: string[]
  themeAdjustments: Record<string, number>
  marketRisk: 'normal' | 'elevated' | 'severe'
  warnings: string[]
}

export interface PromotionRateEstimate {
  rawRate: number | null
  adjustedRate: number | null
  promoted: number
  valid: number
  confidence: 'low' | 'medium' | 'high'
}

export interface PromotionWindowStatistics {
  day1: PromotionRateEstimate
  day5: PromotionRateEstimate
  day20: PromotionRateEstimate
  day60: PromotionRateEstimate
}

export interface PromotionStatistics {
  generatedAt: string
  priorStrength: number
  overall: PromotionWindowStatistics
  byLane: Record<string, PromotionWindowStatistics>
  byMarketCycle: Record<string, PromotionWindowStatistics>
  byRole: Record<string, PromotionWindowStatistics>
  byThemeState: Record<string, PromotionWindowStatistics>
  sampleDates: string[]
}

export interface TurnoverCapacity {
  circulatingMarketCap: number | null
  amountToFloatCapPct: number | null
  effectiveTurnoverPct: number | null
  score: number
  amountPercentile: number
  dataConsistent: boolean
  note: string
}

export interface LadderPopularity {
  score: number
  roleScore: number
  followScore: number
  hotRankScore: number | null
  fundFlowScore: number | null
  eastmoneyRank: number | null
  thsRank: number | null
  followerCount: number
  note: string
}

export interface TechnicalEvidence {
  available: boolean
  settled: boolean
  lastDate: string
  barCount: number
  ma20: number | null
  ma60: number | null
  ma120: number | null
  ma120Rising: boolean | null
  atr14Pct: number | null
  breakout20: boolean | null
  breakout60: boolean | null
  breakout120: boolean | null
  breakoutLine20: number | null
  pre20RangePct: number | null
  amountRatio20: number | null
  amountRatioSource: 'amount' | 'volume' | 'missing'
  prePosition120Pct: number | null
  episodeOnsetDate: string | null
  episodeReturnPct: number | null
  sessionsFromOnset: number | null
  recognitionLate: boolean
  onePrice: boolean
  onePriceStreak?: number
  shape: ShapeArchetype
  platformEdge: number | null
  onsetLow: number | null
}

export interface LadderStockAnalysis {
  rank: number
  code: string
  name: string
  price: number
  changePct: number
  boardType: 'main' | 'twenty' | 'beijing'
  consecutiveDays: number
  nDayBoards: string
  themes: string[]
  primaryTheme: string
  subtheme: string
  themeGrade: ThemeGrade
  themeScore: number
  themeLadder?: ThemeLadderEvidence
  boardSequence?: BoardSequenceEvidence
  expectation?: RelayExpectation
  relayPathEvidence?: {
    schemaVersion?: string
    boardClass?: string
    quality?: string
    missingReasons?: string[]
    coverage?: { overall?: number; byField?: Record<string, number>; missingReasons?: string[] }
  }
  relayPathScore?: {
    model?: string
    pathResearchScore?: number | null
    pathCoverage?: number
    dataConfidence?: number
    probabilityStatus?: 'research-score' | 'calibrated' | 'unavailable' | string
    failedConditions?: string[]
  }
  role: LadderRole
  roleProfile?: LadderRoleProfile
  reason: string
  firstTime: string
  lastTime: string
  openCount: number
  turnoverRate: number
  amount: number
  circulatingMarketCap?: number | null
  sealAmount: number | null
  onePrice: boolean
  tBoard: boolean
  isMarginEligible: boolean
  reasonSource: 'kaipanla' | 'import' | 'none'
  state: LadderState
  score: number
  promotionLane?: string
  promotionScore?: number
  tradabilityScore?: number
  baseScore?: number
  candidateRank?: number | null
  turnoverCapacity?: TurnoverCapacity
  popularity?: LadderPopularity
  dragonIdentity?: {
    score: number
    verdict: 'true-dragon' | 'core' | 'follower' | 'insufficient-data'
    dimensions: {
      drive: { score: number; note: string }
      leadership: { score: number; note: string }
      antiDrop: { score: number; note: string }
      liquidity: { score: number; note: string }
      absorption: { score: number; note: string }
    }
    hardGate: { passed: boolean; failed: string[] }
    evidence: string[]
  }
  v2?: {
    promotion: number | null
    tradability: number | null
    base: number
    promotionCoverage?: number
    tradabilityCoverage?: number
    missingReasons?: string[]
    promotionDimensions: Record<string, { score: number; note: string }>
    tradabilityDimensions: Record<string, { score: number; note: string }>
  }
  technical: TechnicalEvidence
  dimensions: Record<
    'market' | 'theme' | 'ladder' | 'technical' | 'fundFlow' | 'seal',
    { score: number; note: string }
  >
  fundFlow: {
    available: boolean
    score: number | null
    net: number
    instNet: number
    hotNet: number
    lhasaNet: number
    note: string
    source: 'eastmoney-lhb' | 'unavailable' | 'missing-neutral'
  }
  penalties: string[]
  warnings: string[]
  eventGate?: LadderRiskEvent['action'] | 'none'
  gateReasons?: string[]
  trigger: string
  invalidation: string
  mainRisk: string
}

export interface LimitLadderAnalysis {
  asof: string
  generatedAt: string
  ruleVersion: string
  archived: boolean
  market: {
    cycle: {
      phase: MarketCyclePhase
      score: number | null
      rawScore?: number | null
      coverage?: number
      missingReasons?: string[]
      directionAvailable: boolean
      reasons: string[]
      current: {
        temperature: number | null
        limitUp: number | null
        limitDown: number | null
        breakRate: number | null
        promotionRate: number | null
        yestLimitPerf: number | null
        advance: number | null
        decline: number | null
        maxBoards: number
        ladderContinuity: number
      }
      previousTemperature?: number
    }
    limitUp: number | null
    limitDown: number | null
    breakRate: number | null
    promotionRate: number | null
    advance: number | null
    decline: number | null
    maxBoards: number
  }
  sentimentQuant?: LadderSentimentQuantSnapshot | null
  themes: ThemeAnalysis[]
  promotionLanes?: PromotionLane[]
  promotionStatistics?: PromotionStatistics
  dominantLane?: string | null
  themeAnchors?: ThemeAnchor[]
  roleMap?: LadderRoleMap
  riskEvents?: LadderRiskEvent[]
  eventGate?: LadderEventGate
  nextDayCandidates?: LadderStockAnalysis[]
  levels: Array<{ boards: number; stocks: LadderStockAnalysis[] }>
  firstBoards: LadderStockAnalysis[]
  stocks: LadderStockAnalysis[]
  quality: {
    source: 'kaipanla' | 'eastmoney' | 'sina' | 'import' | 'mixed'
    sourceDate: string
    sentimentSource: 'kaipanla' | 'derived' | 'mock'
    sentimentStatus?: 'full' | 'degraded' | 'stale' | 'unavailable'
    limitFieldsComplete: boolean
    klineComplete: number
    klineTotal: number
    degraded: boolean
    fundFlowComplete?: boolean
    providerAt?: string | null
    receivedAt?: string | null
    adjustment?: 'raw' | 'qfq' | 'hfq' | 'none' | 'unknown' | null
    settled?: boolean
    warnings: string[]
  }
  warnings: string[]
  strategyStatus?: 'research'
  revision?: number
  supersedes?: string | null
}

export type NextDayManualReviewStatus = 'unreviewed' | 'partial' | 'reviewed'

export interface NextDayManualReviewInput {
  signalDate: string
  code: string
  name?: string
  source?: string
  sourceRef?: string
  capturedAt?: string
  personality?: {
    historySampleCount1y?: number | null
    limitUpSuccessCount1y?: number | null
    limitUpSuccessRateNonOnePct1y?: number | null
    blastedCount1y?: number | null
    sealSuccessRateNonOnePct1y?: number | null
    nextDayOpenHighRate1y?: number | null
    nextDayAvgOpenGapPct1y?: number | null
    nextDayPositiveCloseRate1y?: number | null
    nextDayAvgOpenClosePct1y?: number | null
    lastLimitTouchDate?: string | null
    lastLimitTouchStatus?: 'sealed' | 'blasted' | 'unknown' | null
  }
  current?: {
    currentSingleOrderAmountWan?: number | null
    maxSingleOrderAmountWan?: number | null
    sealToVolumePct?: number | null
    sealToFloatPct?: number | null
    limitUpTurnoverAmountYi?: number | null
  }
  capital?: {
    mainNetInflowWan?: number | null
    mainNetInflowPct?: number | null
    inflowRank?: number | null
    retailNetInflowWan?: number | null
  }
  divergence?: {
    themePositiveRatePct?: number | null
    sameLevelPositiveRatePct?: number | null
    coreVwapHold?: boolean | null
    assistantCount?: number | null
  }
  note?: string
}

export interface NextDayManualReviewComponent {
  score: number | null
  weight: number
  coveragePct: number
  evidence: string[]
}

export interface NextDayManualReviewAssessment {
  version: 'next-day-manual-review-v1'
  status: NextDayManualReviewStatus
  finalScore: number | null
  provisionalScore: number | null
  coveragePct: number
  source: string
  sourceRef?: string
  capturedAt?: string
  updatedAt: string
  missingReasons: string[]
  components: {
    automatic: NextDayManualReviewComponent
    personality: NextDayManualReviewComponent
    sealAndTurnover: NextDayManualReviewComponent
    capital: NextDayManualReviewComponent
    divergence: NextDayManualReviewComponent
    themeLadder: NextDayManualReviewComponent
  }
  evidence: NextDayManualReviewInput
}

export interface NextDayManualReviewPayload {
  signalDate: string
  reviews: NextDayManualReviewInput[]
}

export interface NextDayCandidateConfirmation {
  code: string
  name: string
  baseState: LadderState
  promotionLane: string
  baseScore: number
  promotionScore: number
  tradabilityScore: number
  themeLadder?: ThemeLadderEvidence
  expectation?: RelayExpectation
  expectationMatch?: ExpectationMatch
  auctionScore: number | null
  finalAuctionScore?: number | null
  processScore?: number | null
  themeDirectionScore?: number | null
  marketStyleScore?: number | null
  sizeBucket?: LadderSizeBucket
  liquidityStyleAdjustment?: number
  styleGateReasons?: string[]
  openScore: number | null
  liveScore: number | null
  environmentAdjustment?: number
  openingGapAdjustment?: number
  auctionTailBonus?: number
  decisionScore?: number | null
  marketGateState?: MarketGateState | null
  themePermission?: ThemePermission | null
  state: NextDayState
  openingPullUpConfirmed?: boolean | null
  openingReboundConfirmed?: boolean | null
  auctionTailBuyConfirmed?: boolean | null
  openingConfirmationGate?: 'not-required' | 'passed' | 'blocked' | 'unavailable'
  tradeDate: string
  quoteTime: string
  openGapPct: number | null
  auctionAmount: number | null
  currentAmount: number | null
  currentPrice: number | null
  vwap: number | null
  inaccessible: boolean
  warnings: string[]
  gateReasons?: string[]
  researchConfirmed?: boolean
  executionEligible?: boolean
  executionEligibility?: {
    eligible: boolean
    reasons: string[]
    evaluatedAt: string
  }
  manualReview?: NextDayManualReviewAssessment
}

export type AuctionStyle =
  | 'technology'
  | 'consumer'
  | 'medicine'
  | 'finance'
  | 'cyclical'
  | 'small-cap'
  | 'mixed'
export type LadderSizeBucket = 'small' | 'mid' | 'large' | 'unknown'

export interface AuctionMarketStock {
  code: string
  name: string
  industry: string
  style: AuctionStyle
  price: number
  changePct: number
  amount: number
  marketCap: number | null
  tradeDate: string
  quoteTime: string
  source: 'eastmoney'
}

export interface AuctionMarketStyle {
  style: AuctionStyle
  label: string
  score: number | null
  confidence: number
  topFiveConcentrationPct: number | null
  weightedSharePct: number | null
  largeCapAmountSharePct?: number | null
  evidence: string[]
}

export interface AuctionThemeDirection {
  theme: string
  score: number | null
  state: 'leading' | 'resonant' | 'isolated-one-price' | 'weak' | 'unavailable'
  positiveRate: number | null
  weightedGapPct: number | null
  amountSharePct: number | null
  coreCode: string | null
  coreName: string
  coreOnePrice: boolean
  assistantCodes: string[]
  assistantCount: number
  coverage: number
}

export interface AuctionCandidateProcess {
  code: string
  sampleCount: number
  strengtheningScore: number | null
  cancellationStabilityScore: number | null
  processScore: number | null
  startGapPct: number | null
  finalGapPct: number | null
  finalUnmatchedSide: 'buy' | 'sell' | 'balanced' | null
}

export interface LadderAuctionContext {
  capturedAt: string
  snapshotCount: number
  coverage: number
  lowConfidence: boolean
  sources: string[]
  marketStyle: AuctionMarketStyle | null
  topAmount: AuctionMarketStock[]
  themes: AuctionThemeDirection[]
  candidateProcesses: AuctionCandidateProcess[]
  warnings: string[]
}

export type LadderOutcomePopulation = 'formal' | 'wait-open'
export type LadderOutcomeStatus = 'promoted' | 'failed' | 'unresolved'

export interface LadderOutcomeRow {
  code: string
  name: string
  candidateRank: number | null
  population: LadderOutcomePopulation
  promotionLane: string
  fromBoards: number
  targetBoards: number
  resultStatus: LadderOutcomeStatus
  promoted: boolean | null
  tradable: boolean | null
  unresolvedReason: string
  nextDayOpenToCloseMark?: number | null
  markPositive?: boolean | null
  realizedNetReturnPct?: number | null
  /** @deprecated use nextDayOpenToCloseMark. */
  openToClosePct: number | null
  mfePct: number | null
  maePct: number | null
  marketCycle?: MarketCyclePhase
  marketRole?: MarketPositionRole
  themeState?: string
  riskAppetiteState?: RiskAppetiteState | null
  eventStatus?: LadderStockAnalysis['eventGate']
  marketGateState?: MarketGateState | null
  themePermissionState?: ThemePermissionState | null
  externalRiskScore?: number | null
  domesticRiskScore?: number | null
  repairState?: MarketRepairState | null
  sizeBucket?: LadderSizeBucket
  heightTier?: LadderHeightTier
  liquidityStyleAdjustment?: number
  gateReasons?: string[]
}

export interface LadderPromotionRateSummary {
  total: number
  valid: number
  promoted: number
  failed: number
  unresolved: number
  promotionRate: number | null
  coverage: number
}

export interface LadderOutcomeSummary {
  formal: LadderPromotionRateSummary
  byLane: Array<LadderPromotionRateSummary & { promotionLane: string; fromBoards: number }>
  waitOpen: LadderPromotionRateSummary
  byRepairState?: Array<
    LadderPromotionRateSummary & { repairState: MarketRepairState }
  >
  bySizeBucket?: Array<
    LadderPromotionRateSummary & { sizeBucket: LadderSizeBucket }
  >
  byHeightTier?: Array<
    LadderPromotionRateSummary & { heightTier: LadderHeightTier }
  >
}

export interface LadderOutcomeArchive {
  signalDate: string
  tradeDate: string
  generatedAt: string
  ruleVersion: string
  summary: LadderOutcomeSummary
  rows: LadderOutcomeRow[]
}

export type RelayRole =
  | 'relay-candidate'
  | 'theme-core-observer'
  | 'emotion-anchor'
  | 'fallback-observer'
export type RelayFeedbackStatus = 'supportive' | 'mixed' | 'negative' | 'unavailable'
export type RelayPlanStage = 'pending' | 'auction' | 'open' | 'settled'
export type RelayFeedbackSource =
  | 'settled-analysis'
  | 'auction-process'
  | 'open-confirmation'
  | 'unavailable'

export interface NextDayRelayRelatedStock {
  code: string
  name: string
  boards: number
  theme: string
  relation: string
  changePct?: number | null
  gapPct?: number | null
  onePrice?: boolean
  vwapPct?: number | null
  vwapHold?: boolean | null
}

export interface NextDayRelayFeedback {
  status: RelayFeedbackStatus
  stage: RelayPlanStage
  signalDate: string
  tradeDate: string
  source: RelayFeedbackSource
  related: NextDayRelayRelatedStock[]
  metrics: Record<string, number | string | boolean | null>
  evidence: string[]
  warnings: string[]
}

export interface NextDayRelayItem {
  code: string
  name: string
  boards: number
  promotionLane: string
  primaryTheme: string
  researchTheme: string
  baseState: LadderState
  relayRole: RelayRole
  researchPriority: number
  executionEligible: boolean
  executionGateReasons: string[]
  researchReasons: string[]
  confirmationConditions: string[]
  invalidationReasons: string[]
  noChaseReasons: string[]
  themeFeedback: NextDayRelayFeedback
  sameLevelFeedback: NextDayRelayFeedback
}

export interface NextDayRelayPopulationRow {
  code: string
  name: string
  promotionLane: string
  fullLanePool: boolean
  hardEligible: boolean
  ranked: boolean
  quotaSelected: boolean
  confirmed: boolean | null
  filled: boolean | null
}

export interface NextDayRelayPlan {
  status: 'research-score'
  signalDate: string
  tradeDate: string
  generatedAt: string
  stage: RelayPlanStage
  items: NextDayRelayItem[]
  population?: NextDayRelayPopulationRow[]
  warnings: string[]
}
export interface LimitLadderNextDay {
  signalDate: string
  tradeDate: string
  generatedAt: string
  ruleVersion: string
  stage: 'pending' | 'auction' | 'open' | 'settled'
  sentimentQuant?: LadderSentimentQuantSnapshot | null
  auctionSnapshotAvailable: boolean
  confirmationSnapshotAvailable?: boolean
  auctionContext?: LadderAuctionContext | null
  highBoardContext?: HighBoardRiskContext | null
  themeRiskAppetite?: ThemeRiskAppetite[]
  eventReaction?: LadderEventReaction | null
  marketGate?: MarketRiskGate | null
  themePermissions?: ThemePermission[]
  outcome?: LadderOutcomeArchive | null
  candidates: NextDayCandidateConfirmation[]
  warnings: string[]
  relayPlan?: NextDayRelayPlan | null
  strategyStatus?: 'research'
}

export type RiskAppetiteState = 'expansion' | 'divergence' | 'contraction' | 'panic'

export interface HighBoardRiskMetrics {
  sampleSize: number
  positiveRate: number | null
  nuclearRate: number | null
  onePriceRetentionRate: number | null
  weightedGapPct: number | null
  processStrength: number | null
  vwapHoldRate: number | null
  waterfallRate: number | null
  resealRate: number | null
}

export interface HighBoardMemberFeedback {
  code: string
  name: string
  theme: string
  boards: number
  marketRole: MarketPositionRole
  heightTier: LadderHeightTier
  gapPct: number | null
  changePct: number | null
  processScore: number | null
  aboveVwap: boolean | null
  priorOnePrice: boolean
  onePriceRetained: boolean | null
  resealed: boolean
  nuclear: boolean
}

export interface ThemeRiskAppetite {
  theme: string
  score: number
  state: RiskAppetiteState
  confidence: number
  sampleSize: number
  highLowSwitch: boolean
}

export interface HighBoardRiskContext {
  capturedAt: string
  phase: 'auction' | 'open'
  score: number
  state: RiskAppetiteState
  confidence: number
  metrics: HighBoardRiskMetrics
  members: HighBoardMemberFeedback[]
  themes: ThemeRiskAppetite[]
  warnings: string[]
}

export interface LadderEventReaction {
  state: 'absorbed' | 'neutral' | 'amplified' | 'unavailable'
  score: number | null
  affectedCodes: string[]
  positiveCodes: string[]
  negativeCodes: string[]
  evidence: string[]
}

export type ExternalRiskState = 'risk-on' | 'mixed' | 'risk-off' | 'panic' | 'unavailable'
export type MarketGateState = 'normal' | 'cautious' | 'restricted' | 'frozen' | 'unavailable'
export type MarketRepairState =
  | 'unconfirmed'
  | 'broad-repair'
  | 'weight-led-repair'
  | 'small-cap-repair'
  | 'mixed'
  | 'risk-continuation'
export type ThemePermissionState = 'allowed' | 'conditional' | 'blocked'
export type ThemeRiskClass = 'high-beta' | 'defensive' | 'cyclical' | 'neutral'

export interface MarketRiskQuote {
  code: string
  name: string
  changePct: number
  price: number
}

export interface MarketRiskMacro {
  id: string
  value: number
  previousClose: number
  changePct: number
  deltaBps: number | null
}

export interface PremarketRiskSnapshot {
  signalDate: string
  tradeDate: string
  capturedAt: string
  frozenAt: string
  late: boolean
  state: ExternalRiskState
  riskScore: number | null
  usRiskScore?: number | null
  asiaRiskScore?: number | null
  coverage: number
  us: MarketRiskQuote[]
  asia: MarketRiskQuote[]
  macro: MarketRiskMacro[]
  headlines: Array<{
    time: string
    source: string
    title: string
    severity: number
    direction: 'risk' | 'support'
  }>
  sources: string[]
  reasons: string[]
  warnings: string[]
}

export interface DomesticMarketSnapshot {
  capturedAt: string
  indices: MarketRiskQuote[]
  styleIndices?: MarketRiskQuote[]
  advance: number | null
  decline: number | null
  flat: number | null
  limitUp: number | null
  limitDown: number | null
  indexRiskScore: number | null
  breadthRiskScore: number | null
  highBoardRiskScore: number | null
  riskScore: number | null
  coverage: number
  reasons: string[]
  warnings: string[]
}

export interface MarketRepairContext {
  state: MarketRepairState
  capturedAt: string
  applicable: boolean
  confidence: number
  largeCapChangePct: number | null
  smallCapChangePct: number | null
  sizeSpreadPct: number | null
  advanceRate: number | null
  largeCapAuctionAmountSharePct: number | null
  highBoardState: RiskAppetiteState | null
  reasons: string[]
  warnings: string[]
}

export interface ThemePermission {
  theme: string
  riskClass: ThemeRiskClass
  state: ThemePermissionState
  score: number
  independentStrength: boolean
  directionScore: number | null
  positiveRate: number | null
  assistantCount: number
  environmentAdjustment: number
  reasons: string[]
}

export interface MarketRiskGate {
  signalDate: string
  tradeDate: string
  generatedAt: string
  phase: 'premarket' | 'auction' | 'open'
  state: MarketGateState
  riskScore: number | null
  externalRiskScore: number | null
  domesticRiskScore: number | null
  domesticConfirmed: boolean
  premarket: PremarketRiskSnapshot | null
  domestic: DomesticMarketSnapshot | null
  repairContext?: MarketRepairContext
  themePermissions: ThemePermission[]
  reasons: string[]
  warnings: string[]
}

export type AuctionBriefPhase = 'auction-final' | 'open-confirmation'
export type AuctionBriefVerdict = 'accept' | 'observe' | 'reject'
export type NotificationDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'disabled'
  | 'not-configured'

export interface AuctionBriefCandidate {
  code: string
  name: string
  population: 'formal' | 'wait-open' | 'observation'
  boardType: LadderStockAnalysis['boardType']
  promotionLane: string
  theme: string
  verdict: AuctionBriefVerdict
  score: number | null
  reasons: string[]
}

export interface AuctionBrief {
  id: string
  signalDate: string
  tradeDate: string
  generatedAt: string
  ruleVersion: string
  phase: AuctionBriefPhase
  title: string
  summary: string
  deterministicSummary: string
  generationMode: 'rules' | 'rules-ai-polished'
  strengthScore: number | null
  strengthLabel: string
  confidence: number
  degraded: boolean
  marketGateState?: MarketGateState | null
  marketRiskScore?: number | null
  marketRepairState?: MarketRepairState | null
  repairConfidence?: number | null
  marketStyle: AuctionMarketStyle | null
  primaryDirection: string
  topAmount: AuctionMarketStock[]
  themes: AuctionThemeDirection[]
  candidates: AuctionBriefCandidate[]
  observations: AuctionBriefCandidate[]
  coverage: {
    auctionPct: number
    confirmationPct: number | null
    sourceCount: number
  }
  warnings: string[]
  renderedText: string
  overnightContext?: OvernightContext
  newsCatalysts?: NewsCatalyst[]
  expectedDirections?: string[]
  auctionConfirmedDirections?: string[]
  openConfirmedDirections?: string[]
}

export interface RelatedStock {
  code: string
  name: string
  relationType: string
  relationReason: string
  relationScore: number
  marketScore: number
  confidence: number
  validationState: '强化' | '未验证' | '背离'
  riskNote: string
  changePct?: number
  auctionAmount?: number
  firstBoard?: boolean
}

export interface NewsCatalyst {
  id: string
  time: string
  title: string
  summary: string
  source: string
  url?: string
  category: string
  verification: string
  importanceScore: number
  direction: string
  impactPath: string
  themes: string[]
  relatedStocks: RelatedStock[]
  warnings: string[]
}

export interface OvernightContext {
  windowStart: string
  windowEnd: string
  asof: string
  sourceCoverage: {
    fetched: string[]
    succeeded: string[]
    itemCount: number
    windowItemCount: number
    coveragePct: number
    warnings: string[]
  }
  newsCatalysts: NewsCatalyst[]
  expectedDirections: string[]
  auctionConfirmedDirections: string[]
  openConfirmedDirections: string[]
  warnings: string[]
}

export type CrossMarketPhase = 'premarket' | 'auction' | 'open'
export type CrossMarketProbabilityStatus = 'unavailable' | 'research-score' | 'calibrated'
export type LiquidityRegimeState = 'stock-crowding' | 'incremental-broad' | 'balanced' | 'unavailable'
export type CapitalLaneId = 'hard-tech' | 'innovative-drug' | 'small-theme' | 'index-weight'

export interface LiquidityRegimeSnapshot {
  phase: CrossMarketPhase
  cutoffAt: string
  source: 'full-market-clist' | 'unavailable'
  totalAmount: number | null
  baselineSessions: number
  sameTimeTurnoverRatio: number | null
  turnoverZ: number | null
  advanceRatePct: number | null
  top50AmountSharePct: number | null
  concentrationDeltaPct: number | null
  largeSmallSpreadPct: number | null
  state: LiquidityRegimeState
  confidence: number
  warnings: string[]
}

export interface CapitalSeesawLane {
  id: CapitalLaneId
  label: string
  externalShock: number
  domesticCycle: number
  auctionConfirmation: number
  openConfirmation: number
  liquidityAdjustment: number
  interactionAdjustment: number
  netResearchScore: number
  state: '强化' | '分化' | '背离' | '观察' | '不可用'
  reasons: string[]
  warnings: string[]
}

export interface CapitalTransfer {
  from: CapitalLaneId
  to: CapitalLaneId
  strength: number
  label: '统计关联' | '资金偏移'
  reasons: string[]
}

export interface CapitalSeesawMatrix {
  phase: CrossMarketPhase
  generatedAt: string
  status: CrossMarketProbabilityStatus
  lanes: CapitalSeesawLane[]
  transfers: CapitalTransfer[]
  warnings: string[]
}

export interface CrossMarketSnapshot {
  tradeDate: string
  scheduledCutoffAt: string
  capturedAt: string
  captureStatus: 'on-time' | 'late-live' | 'unavailable'
  cutoffAt: string
  generatedAt: string
  phase: CrossMarketPhase
  modelVersion: string
  graphVersion: string
  probabilityStatus: CrossMarketProbabilityStatus
  researchStatus: 'rejected' | 'research' | 'paper-trade' | 'eligible'
  dataQuality: {
    status: 'full' | 'degraded' | 'unavailable'
    sourceCoveragePct: number
    staleSources: string[]
    missingSources: string[]
    warnings: string[]
  }
  liquidityRegime?: LiquidityRegimeSnapshot
  capitalSeesaw?: CapitalSeesawMatrix
  sourceShocks: Array<Record<string, unknown>>
  themePredictions: Array<Record<string, unknown>>
  stockPredictions: Array<Record<string, unknown>>
  rejectedMappings: Array<{ edgeId: string; reason: string }>
  warnings: string[]
}
export interface NotificationDeliveryRecord {
  idempotencyKey: string
  signalDate: string
  tradeDate: string
  phase: AuctionBriefPhase | 'test'
  provider: 'serverchan'
  status: NotificationDeliveryStatus
  attempts: number
  createdAt: string
  updatedAt: string
  sentAt: string | null
  responseTimeMs: number | null
  statusCode: number | null
  providerCode: number | string | null
  providerMessage: string
  pushId: string | null
  error: string
}

export interface AuctionBriefState {
  signalDate: string
  tradeDate: string
  ruleVersion: string
  notification: {
    provider: 'serverchan'
    enabled: boolean
    configured: boolean
  }
  briefs: AuctionBrief[]
  deliveries: NotificationDeliveryRecord[]
}

export interface LadderReasonDetail {
  code: string
  date: string
  reason: string
  explanation: string
  marketRole: string
  hotReason: string
  source: 'kaipanla'
}

export function useLadderReason(code: string, date: string) {
  const requestKey = `${date}:${code}`
  const [result, setResult] = useState<{
    key: string
    detail: LadderReasonDetail | null
    error: string | null
  }>({ key: '', detail: null, error: null })

  useEffect(() => {
    let cancelled = false
    if (!code) return

    fetchWithTimeout(
      `/api/ladder/reason?code=${encodeURIComponent(code)}&date=${encodeURIComponent(date)}`,
      15_000,
    )
      .then(async (response) => {
        const json = (await response.json()) as {
          detail?: LadderReasonDetail | null
          error?: string
        }
        if (!response.ok || json.error) throw new Error(json.error ?? `HTTP ${response.status}`)
        if (!cancelled) {
          setResult({ key: requestKey, detail: json.detail ?? null, error: null })
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setResult({
            key: requestKey,
            detail: null,
            error: reason instanceof Error ? reason.message : 'Failed to load limit-up reason',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [code, date, requestKey])

  if (result.key !== requestKey) {
    return { detail: null, loading: !!code, error: null }
  }
  return { detail: result.detail, loading: false, error: result.error }
}

export function useLadderAnalysis(date: string) {
  const [data, setData] = useState<LimitLadderAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetching = useRef(false)
  const activeDate = useRef(date)

  useEffect(() => {
    activeDate.current = date
  }, [date])

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) {
        await fetch('/api/refresh?market=ladder', {
          method: 'POST',
          cache: 'no-store',
        }).catch(() => {})
      }
      const json = await fetchLadderJson<LimitLadderAnalysis>(
        '/api/ladder/analysis?date=' + encodeURIComponent(date),
        120_000,
      )
      writeLadderSnapshot(json)
      if (activeDate.current === date) {
        setData(json)
        setError(null)
      }
      return json
    },
    [date],
  )

  useEffect(() => {
    let cancelled = false
    if (fetching.current) return
    const snapshot = readLadderSnapshot(date)
    if (snapshot) {
      setData(snapshot)
      setError(null)
      setLoading(false)
      return
    }
    // A date change must not keep rendering the previous date's archive while
    // the new request is pending or unavailable.
    setData(null)
    setError(null)
    fetching.current = true
    setLoading(true)
    load()
      .catch((err) => {
        if (!cancelled && activeDate.current === date) {
          setData(null)
          setError(err instanceof Error ? err.message : 'Failed to load ladder')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          fetching.current = false
        }
      })
    return () => {
      cancelled = true
      fetching.current = false
    }
  }, [date, load])

  const refresh = useCallback(async () => {
    if (fetching.current) return false
    fetching.current = true
    setLoading(true)
    setError(null)
    try {
      await load(true)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ladder')
      return false
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [load])

  const importData = useCallback(async (payload: LadderImportPayload) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchWithTimeout('/api/ladder/import', 120_000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json()) as LimitLadderAnalysis & { error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
      setData(json)
      writeLadderSnapshot(json)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return { data, loading, error, refresh, importData }
}

/** Dates with an actual ladder analysis archive, not merely a market session. */
export function useLadderArchiveDates(limit = 30): { dates: Set<string>; loading: boolean } {
  const [dates, setDates] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchLadderJson<{ dates: string[] }>(
      '/api/ladder/archive-dates?limit=' + encodeURIComponent(String(limit)),
      10_000,
    )
      .then((json) => {
        if (!cancelled) setDates(new Set(json.dates.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))))
      })
      .catch(() => {
        if (!cancelled) setDates(new Set())
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [limit])

  return { dates, loading }
}

export function useLadderNextDay(signalDate: string, enabled = true, refreshKey = 0) {
  const requestKey = enabled && signalDate ? signalDate : ''
  const [result, setResult] = useState<{
    key: string
    data: LimitLadderNextDay | null
    error: string | null
  }>({ key: '', data: null, error: null })

  const saveManualReviews = useCallback(async (payload: NextDayManualReviewPayload) => {
    const response = await fetchWithTimeout('/api/ladder/next-day/manual-review', 30_000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = (await response.json()) as LimitLadderNextDay & { error?: string }
    if (!response.ok || json.error) throw new Error(json.error ?? `HTTP ${response.status}`)
    if (payload.signalDate === signalDate) setResult({ key: requestKey, data: json, error: null })
    return true
  }, [requestKey, signalDate])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!requestKey) return
      try {
        const json = await fetchLadderJson<LimitLadderNextDay>(
          '/api/ladder/next-day?signalDate=' + encodeURIComponent(signalDate),
          30_000,
        )
        if (!cancelled) {
          setResult({ key: requestKey, data: json, error: null })
        }
      } catch (reason) {
        if (!cancelled) {
          setResult({
            key: requestKey,
            data: null,
            error:
              reason instanceof Error ? reason.message : 'Failed to load next-day confirmation',
          })
        }
      }
    }
    void load()
    const timer = setInterval(() => void load(), 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refreshKey, requestKey, signalDate])

  return result.key === requestKey
    ? { data: result.data, error: result.error, saveManualReviews }
    : { data: null, error: null, saveManualReviews }
}

export function useFirstBoardScan(tradeDate: string, enabled = true, refreshKey = 0) {
  const requestKey = enabled && /^\d{4}-\d{2}-\d{2}$/.test(tradeDate)
    ? `first-board-scan:${tradeDate}`
    : ''
  const [result, setResult] = useState<{
    key: string
    data: FirstBoardScanResponse | null
    error: string | null
  }>({ key: '', data: null, error: null })

  useEffect(() => {
    let cancelled = false
    if (!requestKey) return
    const load = async () => {
      try {
        const json = await fetchLadderJson<FirstBoardScanResponse>(
          `/api/ladder/first-board-scan?tradeDate=${encodeURIComponent(tradeDate)}`,
          15_000,
        )
        if (!cancelled) setResult({ key: requestKey, data: json, error: null })
      } catch (reason) {
        if (!cancelled) {
          setResult({
            key: requestKey,
            data: null,
            error: reason instanceof Error ? reason.message : 'Failed to load first-board scan',
          })
        }
      }
    }
    void load()
    // The backend owns the exact 60-second scan slots; this shorter poll only
    // makes the ladder panel reflect a completed slot without a manual refresh.
    const timer = setInterval(() => void load(), 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refreshKey, requestKey, tradeDate])

  return result.key === requestKey
    ? { data: result.data, error: result.error }
    : { data: null, error: null }
}

export function useCrossMarketSnapshot(
  tradeDate: string,
  phase: CrossMarketPhase,
  enabled = true,
  refreshKey = 0,
) {
  const requestKey = enabled && tradeDate ? tradeDate + ':' + phase : ''
  const [result, setResult] = useState<{
    key: string
    data: CrossMarketSnapshot | null
    error: string | null
  }>({ key: '', data: null, error: null })

  useEffect(() => {
    let cancelled = false
    if (!requestKey) return
    const load = async () => {
      try {
        const json = await fetchLadderJson<CrossMarketSnapshot>(
          '/api/ladder/cross-market?tradeDate=' +
            encodeURIComponent(tradeDate) +
            '&phase=' +
            encodeURIComponent(phase),
          30_000,
        )
        if (!cancelled) setResult({ key: requestKey, data: json, error: null })
      } catch (reason) {
        if (!cancelled) {
          setResult({
            key: requestKey,
            data: null,
            error: reason instanceof Error ? reason.message : 'Failed to load cross-market snapshot',
          })
        }
      }
    }
    void load()
    const timer = setInterval(() => void load(), 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [phase, refreshKey, requestKey, tradeDate])

  return result.key === requestKey
    ? { data: result.data, error: result.error }
    : { data: null, error: null }
}
export function useAuctionBriefs(signalDate: string, enabled = true, refreshKey = 0) {
  const requestKey = enabled && signalDate ? signalDate : ''
  const [result, setResult] = useState<{
    key: string
    data: AuctionBriefState | null
    error: string | null
  }>({ key: '', data: null, error: null })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!requestKey) return
      try {
        const json = await fetchLadderJson<AuctionBriefState>(
          '/api/ladder/auction-brief?signalDate=' + encodeURIComponent(signalDate),
          15_000,
        )
        if (!cancelled) {
          setResult({ key: requestKey, data: json, error: null })
        }
      } catch (reason) {
        if (!cancelled) {
          setResult({
            key: requestKey,
            data: null,
            error: reason instanceof Error ? reason.message : 'Failed to load auction briefs',
          })
        }
      }
    }
    void load()
    const timer = setInterval(() => void load(), 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refreshKey, requestKey, signalDate])

  return result.key === requestKey
    ? { data: result.data, error: result.error }
    : { data: null, error: null }
}
