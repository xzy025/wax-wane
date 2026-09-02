import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { shanghaiClock } from '../lib/cache'
import { activeTradingCalendar, isTradingDayAt, shanghaiClockAt } from './tradingCalendar'
import { EM_HEADERS } from '../lib/emHeaders'
import { emFetch } from '../lib/emFetch'
import { todayShanghai } from '../lib/time'
import { SCREENER } from '../config/screener'
import {
  fetchAShareData,
  fetchStockKline,
  mapLimit,
  type AShareData,
  type KlineBar,
  type LimitStock,
} from './ashare'
import { fetchSentiment, type SentimentData } from './kaipanla'
import {
  clearKplLadderCache,
  fetchKplRealtimeLadder,
  type KplRealtimeLadder,
  type KplRealtimeStock,
} from './kaipanlaLadder'
import { isLimitUpDay } from './divergenceRules'
import { buildLhbIndex, type LhbDay } from './lhbHistory'
import { fetchHotList, type HotListData } from './hotlist'
import {
  fetchSinaBatchQuotes,
  fetchTencentBatchQuotes,
} from './screenerLiveQuotes'
import type { ScreenerLiveQuote } from './screenerScan'
import { fetchTradingDates } from './moneyflow'
import {
  auctionBriefPhaseForMinutes,
  generateAndDispatchAuctionBrief,
} from './auctionBrief'
import {
  applyEventReactionToRiskContext,
  buildEventReaction,
  buildHighBoardRiskContext,
  buildLadderRoleMap,
  buildPromotionStatistics,
  fetchLadderEventGate,
  type HighBoardRiskContext,
  type LadderEventGate,
  type LadderEventReaction,
  type LadderRiskEvent,
  type LadderRoleMap,
  type LadderRoleProfile,
  type PromotionObservation,
  type PromotionStatistics,
  type ThemeRiskAppetite,
} from './ladderV4'
import { buildNextDayRelayPlan } from './limitLadderRelay'
import { evaluateExecutionEligibility } from './executionEligibility'
import type { NextDayManualReviewAssessment } from './nextDayManualReview'
import {
  scoreThemeLadderRelation,
  type ThemeLadderEvidence,
} from './themeLadderRelation'
import {
  buildMarketRiskGate,
  fetchDomesticMarketSnapshot,
  fetchPremarketRiskSnapshot,
  type DomesticMarketSnapshot,
  type MarketGateArchive,
  type MarketRepairContext,
  type MarketRepairState,
  type MarketRiskGate,
  type ThemePermission,
} from './ladderMarketGate'
import {
  buildBoardDayObservation,
  buildBoardSequenceEvidence,
  buildRelayExpectation,
  classifyObservedRelayPath,
  matchRelayExpectation,
  type BoardDayObservation,
  type BoardSequenceEvidence,
  type ExpectationMatch,
  type RelayExpectation,
} from './ladderExpectation'
import { buildRelayPathEvidence } from './relayPathFeatures'
import { scoreFirstBoardPath, scoreStreakPath, type RelayPathScore } from './relayPathScoring'
import type { RelayPathEvidence } from './relayPathTypes'
import { aggregateLimitEventDay, type LimitEventArchive } from '../market-data/limitEventStore'
import {
  buildLadderSentimentQuantSnapshot,
  listLadderSentimentQuant,
  readLadderSentimentQuant,
  writeLadderSentimentQuant,
  type LadderSentimentQuantSnapshot,
} from './ladderSentimentQuant'

export const LIMIT_LADDER_RULE_VERSION = 'limit-ladder-v6'
const COMPATIBLE_LADDER_RULE_VERSIONS = [
  LIMIT_LADDER_RULE_VERSION,
  'limit-ladder-v5',
  'limit-ladder-v4',
  'limit-ladder-v3',
  'limit-ladder-v2',
  'limit-ladder-v1',
] as const
const CACHE_MS = 120_000
const KLINE_COUNT = 250
const MIN_LADDER_AMOUNT = 100_000_000
const MAX_NEXT_DAY_CANDIDATES = 10
const MAX_CANDIDATES_PER_LANE = 3
const MAX_CANDIDATES_PER_THEME = 2

const __dirname = dirname(fileURLToPath(import.meta.url))
const LADDER_ROOT = join(__dirname, '..', '..', 'docs', 'ladder')

/** 连板天梯只有收盘后才定盘；15:00 前只允许内存预览，不写快照。 */
export function isLadderSettledWindow(
  clock: { day: number; minutes: number } = shanghaiClock(),
): boolean {
  return clock.day >= 1 && clock.day <= 5 && clock.minutes >= 15 * 60
}

export function isLadderOutcomeWindow(
  clock: { day: number; minutes: number } = shanghaiClock(),
): boolean {
  return clock.day >= 1 && clock.day <= 5 && clock.minutes >= 15 * 60 + 10
}

export function isLhbPublicationWindow(
  clock: { day: number; minutes: number } = shanghaiClock(),
): boolean {
  return clock.day >= 1 && clock.day <= 5 && clock.minutes >= 16 * 60 + 30
}

export function isPremarketGateCaptureWindow(
  clock: { day: number; minutes: number } = shanghaiClock(),
): boolean {
  return (
    clock.day >= 1 &&
    clock.day <= 5 &&
    clock.minutes >= 8 * 60 + 50 &&
    clock.minutes < 9 * 60 + 15
  )
}

export const MISSING_PREMARKET_GATE_WARNING =
  '08:50盘前外盘快照缺失，外部风险不参与排序且禁止事后回填'

export function shouldWarnMissingPremarketGate(args: {
  tradeDate: string | null
  nowDate: string
  clockMinutes: number
  hasPremarketSnapshot: boolean
}): boolean {
  if (!args.tradeDate || args.hasPremarketSnapshot) return false
  if (args.nowDate > args.tradeDate) return true
  return (
    args.nowDate === args.tradeDate &&
    args.clockMinutes >= 9 * 60 + 15
  )
}

export type LadderState = 'candidate' | 'waiting' | 'observe' | 'exclude'
export type NextDayState =
  | 'pending'
  | 'auction-qualified'
  | 'confirmed'
  | 'waiting'
  | 'blocked'
  | 'rejected'
export type LadderSizeBucket = 'small' | 'mid' | 'large' | 'unknown'
export type MarketCyclePhase = 'ice' | 'repair' | 'climax' | 'ebb' | 'unavailable'
export type ThemeGrade = 'A' | 'B' | 'C' | 'D'
export type LadderRole = 'space-leader' | 'theme-leader' | 'first-pioneer' | 'mid-ladder' | 'follower'
export type ShapeArchetype =
  | 'low-platform-breakout'
  | 'platform-breakout'
  | 'trend-platform'
  | 'low-oversold-reversal'
  | 'event-reversal'
  | 'high-new-high'
  | 'non-platform-breakout'
  | 'insufficient'

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

export interface MarketCycleInput {
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

export interface MarketCycle {
  phase: MarketCyclePhase
  score: number | null
  rawScore?: number | null
  coverage?: number
  missingReasons?: string[]
  directionAvailable: boolean
  reasons: string[]
  current: MarketCycleInput
  previousTemperature?: number
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
  components?: Record<
    'continuity' | 'anchor' | 'depth' | 'replenishment' | 'promotion' | 'breadth' | 'seal',
    number | null
  >
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

export interface LadderV2Scores {
  promotion: number | null
  tradability: number | null
  base: number
  promotionCoverage?: number
  tradabilityCoverage?: number
  missingReasons?: string[]
  promotionDimensions: Record<
    'market' | 'lane' | 'theme' | 'popularity' | 'seal' | 'technical',
    LadderDimension
  >
  tradabilityDimensions: Record<
    'accessibility' | 'turnoverCapacity' | 'liquidity' | 'structure' | 'reopen',
    LadderDimension
  >
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

export interface LadderDimension {
  score: number
  note: string
}

export type DragonVerdict = 'true-dragon' | 'core' | 'follower' | 'insufficient-data'

export interface DragonIdentity {
  score: number
  verdict: DragonVerdict
  dimensions: {
    drive: LadderDimension
    leadership: LadderDimension
    antiDrop: LadderDimension
    liquidity: LadderDimension
    absorption: LadderDimension
  }
  hardGate: {
    passed: boolean
    failed: string[]
  }
  evidence: string[]
}

export interface LadderFundFlow {
  available: boolean
  score: number | null
  net: number
  instNet: number
  hotNet: number
  lhasaNet: number
  note: string
  source: 'eastmoney-lhb' | 'unavailable' | 'missing-neutral'
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
  /** 最近三板的板型×量价序列；模型通过样本外验收前仅作 shadow 展示。 */
  boardSequence?: BoardSequenceEvidence
  expectation?: RelayExpectation
  /** Unified path evidence shared with the first-board route; research-only. */
  relayPathEvidence?: RelayPathEvidence
  relayPathScore?: RelayPathScore
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
  scoreCoverage?: {
    promotion: number
    tradability: number
    missingReasons: string[]
  }
  candidateRank?: number | null
  /** Signal-day population funnel; shadow metadata only. */
  fullLanePool?: boolean
  hardEligible?: boolean
  quotaSelected?: boolean
  turnoverCapacity?: TurnoverCapacity
  popularity?: LadderPopularity
  dragonIdentity?: DragonIdentity
  v2?: LadderV2Scores
  technical: TechnicalEvidence
  dimensions: {
    market: LadderDimension
    theme: LadderDimension
    ladder: LadderDimension
    technical: LadderDimension
    fundFlow: LadderDimension
    seal: LadderDimension
  }
  fundFlow: LadderFundFlow
  penalties: string[]
  warnings: string[]
  eventGate?: LadderRiskEvent['action'] | 'none'
  gateReasons?: string[]
  trigger: string
  invalidation: string
  mainRisk: string
}

export interface LadderLevel {
  boards: number
  stocks: LadderStockAnalysis[]
}

export interface LadderDataQuality {
  source: 'kaipanla' | 'eastmoney' | 'sina' | 'import' | 'mixed'
  sourceDate: string
  sentimentSource: SentimentData['source']
  sentimentStatus: SentimentData['status']
  limitFieldsComplete: boolean
  klineComplete: number
  klineTotal: number
  degraded: boolean
  fundFlowComplete: boolean
  providerAt?: string | null
  receivedAt?: string | null
  adjustment?: KlineBar['adjustment'] | null
  settled?: boolean
  warnings: string[]
}

export interface LimitLadderAnalysis {
  asof: string
  generatedAt: string
  ruleVersion: string
  archived: boolean
  market: {
    cycle: MarketCycle
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
  levels: LadderLevel[]
  firstBoards: LadderStockAnalysis[]
  stocks: LadderStockAnalysis[]
  quality: LadderDataQuality
  warnings: string[]
  /** 研究层输出；没有逐笔/盘口成交证据时不得解释为交易建议。 */
  strategyStatus?: 'research'
  revision?: number
  supersedes?: string | null
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
  /** 09:35 分钟K量价翻红代理；低开/平开候选需要通过。 */
  openingPullUpConfirmed?: boolean | null
  openingReboundConfirmed?: boolean | null
  auctionTailBuyConfirmed?: boolean | null
  openingConfirmationGate?: 'not-required' | 'passed' | 'blocked' | 'unavailable'
  liveScore: number | null
  environmentAdjustment?: number
  openingGapAdjustment?: number
  auctionTailBonus?: number
  decisionScore?: number | null
  marketGateState?: MarketRiskGate['state'] | null
  themePermission?: ThemePermission | null
  state: NextDayState
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
  executionEligibility?: LadderExecutionEligibility
  /** Screenshot/manual evidence assessment; does not alter execution eligibility. */
  manualReview?: NextDayManualReviewAssessment
}

export interface LadderExecutionEligibility {
  eligible: boolean
  reasons: string[]
  evaluatedAt: string
}

export interface LadderExecutionEligibilityInput {
  stage: 'pending' | 'auction' | 'open' | 'settled'
  tradeDate: string
  quote?: Pick<ScreenerLiveQuote, 'tradeDate' | 'volume' | 'amount'> | null
  confirmationState: NextDayState | null
  inaccessible: boolean
  marketGateState: MarketRiskGate['state'] | null | undefined
  themePermissionState: ThemePermission['state'] | null | undefined
  auctionSnapshotAvailable: boolean
  openSnapshotAvailable: boolean
  openingConfirmationGate?: NextDayCandidateConfirmation['openingConfirmationGate']
  technicalAvailable?: boolean
  riskBudgetAvailable?: boolean
  relayGateState?: 'NORMAL' | 'HOT' | 'JOINT_CLIMAX' | 'UNAVAILABLE'
}

/** Single fail-closed execution vocabulary shared by API, archive and relay. */
export function evaluateLadderExecutionEligibility(
  input: LadderExecutionEligibilityInput,
  evaluatedAt = new Date().toISOString(),
): LadderExecutionEligibility {
  return evaluateExecutionEligibility(input, evaluatedAt)
}

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

export type AuctionStyle =
  | 'technology'
  | 'consumer'
  | 'medicine'
  | 'finance'
  | 'cyclical'
  | 'small-cap'
  | 'mixed'

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
  finalUnmatchedSide: ScreenerLiveQuote['unmatchedSide']
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
  /** Diagnostic price mark; does not imply a fill. */
  nextDayOpenToCloseMark?: number | null
  markPositive?: boolean | null
  realizedNetReturnPct?: number | null
  /** @deprecated use nextDayOpenToCloseMark. */
  openToClosePct: number | null
  mfePct: number | null
  maePct: number | null
  marketCycle?: MarketCyclePhase
  marketRole?: LadderRoleProfile['marketRole']
  themeState?: string
  riskAppetiteState?: HighBoardRiskContext['state'] | null
  eventStatus?: LadderStockAnalysis['eventGate']
  marketGateState?: MarketRiskGate['state'] | null
  themePermissionState?: ThemePermission['state'] | null
  externalRiskScore?: number | null
  domesticRiskScore?: number | null
  repairState?: MarketRepairState | null
  sizeBucket?: LadderSizeBucket
  heightTier?: LadderRoleProfile['heightTier']
  liquidityStyleAdjustment?: number
  gateReasons?: string[]
  /** Full-lane funnel flags. Null means the later stage was not observed. */
  fullLanePool?: boolean
  hardEligible?: boolean
  quotaSelected?: boolean
  confirmed?: boolean | null
  filled?: boolean | null
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
    LadderPromotionRateSummary & {
      heightTier: LadderRoleProfile['heightTier']
    }
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
  population: NextDayRelayPopulationRow[]
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

export interface NormalizedStock {
  code: string
  name: string
  price: number
  changePct: number
  turnoverRate: number
  amount: number
  circulatingMarketCap: number | null
  firstTime: string
  lastTime: string
  openCount: number
  consecutiveDays: number
  industry: string
  nDayBoards: string
  themes: string[]
  subtheme: string
  importedRole: string
  reason: string
  reasonSource: LadderStockAnalysis['reasonSource']
  sealAmount: number | null
  importedOnePrice: boolean | null
  patternHintAvailable: boolean
  onePriceHint: boolean
  tBoardHint: boolean
  isMarginEligible: boolean
  warnings: string[]
}

interface TechnicalResult {
  evidence: TechnicalEvidence
  bars: KlineBar[]
  rawBars?: KlineBar[]
  provider?: string
  adjustment?: KlineBar['adjustment']
  providerAt?: string | null
  receivedAt?: string
}

interface LadderMarketProfile {
  circulatingMarketCap: number | null
}

interface HotRankEvidence {
  eastmoneyRank: number | null
  thsRank: number | null
}

interface EvidenceArchive {
  asof: string
  generatedAt: string
  ruleVersion: string
  qualityRank: number
  revision?: number
  supersedes?: string | null
  providerAt?: string | null
  receivedAt?: string | null
  adjustment?: KlineBar['adjustment'] | null
  settled?: boolean
  ashare: Pick<
    AShareData,
    | 'limitUpCount'
    | 'limitDownCount'
    | 'advance'
    | 'decline'
    | 'flat'
    | 'promotionRate'
    | 'promotedCount'
    | 'promotionTotal'
  >
  sentiment: SentimentData
  kplLadder: KplRealtimeLadder | null
  limitUpStocks: LimitStock[] | null
  imported: LadderImportPayload | null
  klines: Record<string, KlineBar[]>
  rawKlines?: Record<string, KlineBar[]>
  marketProfiles?: Record<string, { circulatingMarketCap: number | null }>
  hotList?: Pick<HotListData, 'eastmoney' | 'ths'>
  promotionLanes?: PromotionLane[]
  themeAnchors?: ThemeAnchor[]
  roleMap?: LadderRoleMap
  eventGate?: LadderEventGate
  promotionStatistics?: PromotionStatistics
}

const importsByDate = new Map<string, LadderImportPayload>()
const analysisCache = new Map<string, { at: number; value: LimitLadderAnalysis }>()
const forcedRecomputeDates = new Set<string>()

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n))
const r2 = (n: number) => Math.round(n * 100) / 100
const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

function weightedAvailable(
  values: Array<{ value: number | null | undefined; weight: number }>,
  fallback = 50,
): number {
  const available = values.filter(
    (item): item is { value: number; weight: number } =>
      typeof item.value === 'number' && Number.isFinite(item.value),
  )
  const totalWeight = available.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight <= 0) return fallback
  return r2(available.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight)
}

export function crossSectionPercentile(value: number, values: number[]): number {
  const valid = values.filter((item) => Number.isFinite(item)).sort((a, b) => a - b)
  if (!valid.length) return 50
  if (valid.length < 5) return 50
  const below = valid.filter((item) => item < value).length
  const equal = valid.filter((item) => item === value).length
  return r2(((below + Math.max(0, equal - 1) / 2) / (valid.length - 1)) * 100)
}

function normalizePercent(value: number, fullAt: number): number {
  return clamp((value / Math.max(fullAt, 1)) * 100)
}

function mainBoardCode(code: string): boolean {
  return /^(000|001|002|003|600|601|603|605)/.test(code)
}

function themeNames(stock: Pick<NormalizedStock, 'themes' | 'industry'>): string[] {
  return stock.themes.length ? stock.themes : [stock.industry || '其他']
}

function safeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function normalizeCode(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.slice(-6).padStart(6, '0')
}

function normalizeTime(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits || digits === '0') return ''
  return digits.padStart(6, '0').slice(-6)
}

function boardType(code: string): LadderStockAnalysis['boardType'] {
  if (/^(4|8|920|43|83|87)/.test(code)) return 'beijing'
  if (code.startsWith('300') || code.startsWith('301') || code.startsWith('688')) return 'twenty'
  return 'main'
}

function archiveDir(asof: string): string {
  const [year, month, day] = asof.split('-')
  return join(LADDER_ROOT, year, month, day)
}

function evidencePath(asof: string, version = LIMIT_LADDER_RULE_VERSION): string {
  return join(archiveDir(asof), `evidence-${version}.json`)
}

function analysisPath(asof: string, version = LIMIT_LADDER_RULE_VERSION): string {
  return join(archiveDir(asof), `analysis-${version}.json`)
}

function revisionArchivePath(basePath: string, revision: number): string {
  if (revision <= 1) return basePath
  return basePath.replace(/\.json$/, `-r${revision}.json`)
}

function latestRevisionedArchivePath(
  asof: string,
  version: string,
  kind: 'analysis' | 'evidence',
): string | null {
  const dir = archiveDir(asof)
  if (!existsSync(dir)) return null
  const baseName = `${kind}-${version}.json`
  const revisionPattern = new RegExp(`^${kind}-${version}-r(\\d+)\\.json$`)
  const paths = readdirSync(dir)
    .filter((name) => name === baseName || revisionPattern.test(name))
    .map((name) => ({
      name,
      revision: name === baseName ? 1 : Number(name.match(revisionPattern)?.[1] ?? 0),
    }))
    .filter((item) => item.revision > 0)
    .sort((a, b) => b.revision - a.revision)
  return paths.length ? join(dir, paths[0].name) : null
}

function archiveWritePath(basePath: string, revision: number): string {
  return revisionArchivePath(basePath, revision)
}

function eventGatePath(asof: string, version = LIMIT_LADDER_RULE_VERSION): string {
  return join(archiveDir(asof), `events-${version}.json`)
}

function archivedAnalysisPath(asof: string): string | null {
  for (const version of COMPATIBLE_LADDER_RULE_VERSIONS) {
    const path = latestRevisionedArchivePath(asof, version, 'analysis')
    if (path && existsSync(path)) return path
  }
  return null
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(temp, path)
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function archivedAnalysisDates(asof: string): string[] {
  if (!existsSync(LADDER_ROOT)) return []
  const dates: string[] = []
  for (const year of readdirSync(LADDER_ROOT)) {
    const yearPath = join(LADDER_ROOT, year)
    if (!/^\d{4}$/.test(year)) continue
    for (const month of readdirSync(yearPath)) {
      const monthPath = join(yearPath, month)
      if (!/^\d{2}$/.test(month)) continue
      for (const day of readdirSync(monthPath)) {
        const date = `${year}-${month}-${day}`
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < asof && archivedAnalysisPath(date)) dates.push(date)
      }
    }
  }
  return dates.sort()
}

function allArchivedAnalysisDates(): string[] {
  return archivedAnalysisDates('9999-12-31')
}

/** 仅返回存在连板天梯 analysis 归档的日期，供前端日期选择器使用。 */
export function listLimitLadderArchiveDates(limit = 30): string[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 30
  return allArchivedAnalysisDates()
    .sort((a, b) => b.localeCompare(a))
    .slice(0, safeLimit)
}

function recentArchivedAnalyses(asof: string, limit = 5): LimitLadderAnalysis[] {
  return archivedAnalysisDates(asof)
    .slice(-limit)
    .map((date) => {
      const path = archivedAnalysisPath(date)
      return path ? readJson<LimitLadderAnalysis>(path) : null
    })
    .filter((value): value is LimitLadderAnalysis => !!value)
}

function previousArchivedAnalysis(asof: string): LimitLadderAnalysis | null {
  return recentArchivedAnalyses(asof, 1).at(-1) ?? null
}

function archivedPromotionObservations(asof: string): PromotionObservation[] {
  return archivedAnalysisDates(asof)
    .slice(-60)
    .flatMap((signalDate) => {
      const path = existingOutcomePath(signalDate)
      const archive = path
        ? readJson<{ rows?: Array<Partial<LadderOutcomeRow>> }>(path)
        : null
      return (archive?.rows ?? [])
        .filter(
          (row) =>
            row.fullLanePool !== false &&
            typeof row.promoted === 'boolean' &&
            typeof row.fromBoards === 'number',
        )
        .map(
          (row): PromotionObservation => ({
            signalDate,
            lane:
              row.promotionLane ??
              `${row.fromBoards as number}进${(row.fromBoards as number) + 1}`,
            promoted: row.promoted as boolean,
            marketCycle: row.marketCycle,
            marketRole: row.marketRole,
            themeState: row.themeState,
          }),
        )
    })
}

export function normalizeLadderImport(input: unknown): LadderImportPayload {
  if (typeof input !== 'object' || input === null) throw new Error('导入内容必须是 JSON 对象')
  const raw = input as Record<string, unknown>
  const asof = String(raw.asof ?? '')
  if (!safeDate(asof)) throw new Error('asof 必须是 YYYY-MM-DD')
  if (!Array.isArray(raw.stocks)) throw new Error('stocks 必须是数组')

  const byCode = new Map<string, LadderImportStock>()
  for (const item of raw.stocks) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const code = normalizeCode(row.code)
    if (!/^\d{6}$/.test(code) || code === '000000') continue
    const themes = Array.isArray(row.themes)
      ? row.themes.map(String).map((x) => x.trim()).filter(Boolean)
      : String(row.themes ?? '')
          .split('|')
          .map((x) => x.trim())
          .filter(Boolean)
    const current = byCode.get(code)
    const next: LadderImportStock = {
      code,
      name: String(row.name ?? current?.name ?? '').trim() || undefined,
      status: String(row.status ?? current?.status ?? '').trim() || undefined,
      consecutiveDays: Number.isFinite(Number(row.consecutiveDays))
        ? Math.max(0, Number(row.consecutiveDays))
        : current?.consecutiveDays,
      nDayBoards: String(row.nDayBoards ?? current?.nDayBoards ?? '').trim() || undefined,
      themes: Array.from(new Set([...(current?.themes ?? []), ...themes])),
      subtheme: String(row.subtheme ?? current?.subtheme ?? '').trim() || undefined,
      role: String(row.role ?? current?.role ?? '').trim() || undefined,
      reason: String(row.reason ?? current?.reason ?? '').trim() || undefined,
      firstTime: normalizeTime(row.firstTime ?? current?.firstTime),
      lastTime: normalizeTime(row.lastTime ?? current?.lastTime),
      openCount: Number.isFinite(Number(row.openCount)) ? Math.max(0, Number(row.openCount)) : current?.openCount,
      turnoverRate: Number.isFinite(Number(row.turnoverRate)) ? Number(row.turnoverRate) : current?.turnoverRate,
      amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : current?.amount,
      sealAmount: Number.isFinite(Number(row.sealAmount)) ? Number(row.sealAmount) : current?.sealAmount,
      onePrice: typeof row.onePrice === 'boolean' ? row.onePrice : current?.onePrice,
    }
    byCode.set(code, next)
  }
  if (byCode.size === 0) throw new Error('导入内容没有有效股票代码')
  return { asof, stocks: Array.from(byCode.values()) }
}

export function classifyMarketCycle(
  current: MarketCycleInput,
  previous?: Pick<MarketCycle, 'phase' | 'current'>,
): MarketCycle {
  const coverageInputs = [
    { value: current.temperature, weight: 0.2, label: '情绪温度' },
    { value: current.limitUp, weight: 0.1, label: '涨停家数' },
    { value: current.limitDown, weight: 0.1, label: '跌停家数' },
    { value: current.breakRate, weight: 0.1, label: '破板率' },
    { value: current.promotionRate, weight: 0.15, label: '晋级率' },
    { value: current.yestLimitPerf, weight: 0.1, label: '昨日涨停表现' },
    { value: current.advance, weight: 0.125, label: '上涨家数' },
    { value: current.decline, weight: 0.125, label: '下跌家数' },
  ]
  const coverage = r2(
    coverageInputs
      .filter((item) => item.value != null && Number.isFinite(item.value))
      .reduce((sum, item) => sum + item.weight, 0),
  )
  const missingReasons = coverageInputs
    .filter((item) => item.value == null || !Number.isFinite(item.value))
    .map((item) => `${item.label}不可用`)
  const reasons: string[] = []
  const previousTemperature = previous?.current.temperature ?? null
  const directionAvailable =
    previous?.phase !== 'unavailable' &&
    current.temperature != null &&
    previousTemperature != null
  const delta = directionAvailable ? current.temperature! - previousTemperature : null

  if (coverage < 0.5) {
    return {
      phase: 'unavailable',
      score: null,
      rawScore: null,
      coverage,
      missingReasons,
      directionAvailable: false,
      reasons: ['市场情绪数据覆盖不足，周期不可判定'],
      current,
      previousTemperature: previousTemperature ?? undefined,
    }
  }

  let phase: Exclude<MarketCyclePhase, 'unavailable'>

  const ebb =
    directionAvailable &&
    !!previous &&
    (previous.phase === 'repair' || previous.phase === 'climax') &&
    ((delta != null && delta <= -8) ||
      (current.breakRate != null && current.breakRate >= 35) ||
      (current.yestLimitPerf != null && current.yestLimitPerf < 0))
  const ice =
    (current.temperature != null && current.temperature <= 35) ||
    (current.limitDown != null &&
      current.limitUp != null &&
      current.yestLimitPerf != null &&
      current.limitDown >= current.limitUp &&
      current.yestLimitPerf < 0) ||
    (current.maxBoards <= 2 && current.promotionRate != null && current.promotionRate < 15)
  const climax =
    current.temperature != null &&
    current.promotionRate != null &&
    current.breakRate != null &&
    current.temperature >= 70 &&
    current.promotionRate >= 35 &&
    current.breakRate <= 25 &&
    current.maxBoards >= 4

  if (ebb) {
    phase = 'ebb'
    reasons.push('情绪较前日明显转弱')
  } else if (ice) {
    phase = 'ice'
    reasons.push('涨停宽度、晋级或赚钱效应处于低位')
  } else if (climax) {
    phase = 'climax'
    reasons.push('高温度、高晋级、低破板且空间高度打开')
  } else {
    phase = 'repair'
    reasons.push('情绪未达高潮，梯队处于修复或发酵')
  }
  if (!directionAvailable) {
    missingReasons.push('缺少可比前日情绪温度')
    reasons.push('缺少前日归档或可比温度，周期方向仅按当日水平判断')
  }

  const scoreByPhase: Record<Exclude<MarketCyclePhase, 'unavailable'>, number> = {
    ice: 30,
    repair: 75,
    climax: 65,
    ebb: 35,
  }
  return {
    phase,
    score: directionAvailable ? scoreByPhase[phase] : null,
    rawScore: directionAvailable ? scoreByPhase[phase] : null,
    coverage,
    missingReasons,
    directionAvailable,
    reasons,
    current,
    previousTemperature: previousTemperature ?? undefined,
  }
}

function levelContinuity(stocks: Array<{ consecutiveDays: number }>): number {
  const levels = new Set(stocks.map((stock) => stock.consecutiveDays).filter((n) => n > 0))
  const max = Math.max(0, ...levels)
  if (max === 0) return 0
  let present = 0
  for (let level = 1; level <= max; level++) if (levels.has(level)) present++
  return present / max
}

export function scoreThemes(
  stocks: NormalizedStock[],
  globalPromotionRate: number | null,
  previousStocks: Array<Pick<LadderStockAnalysis, 'code' | 'consecutiveDays' | 'themes' | 'primaryTheme'>> = [],
  anchors: ThemeAnchor[] = [],
): ThemeAnalysis[] {
  void globalPromotionRate
  const grouped = new Map<string, NormalizedStock[]>()
  for (const stock of stocks.filter((item) => mainBoardCode(item.code))) {
    const names = themeNames(stock)
    for (const name of names) {
      const group = grouped.get(name) ?? []
      group.push(stock)
      grouped.set(name, group)
    }
  }

  return Array.from(grouped.entries())
    .map(([name, group]) => {
      const count = group.length
      const firstBoardCount = group.filter((stock) => stock.consecutiveDays === 1).length
      const multiBoardCount = group.filter((stock) => stock.consecutiveDays >= 2).length
      const maxBoards = Math.max(...group.map((stock) => stock.consecutiveDays))
      const continuity = levelContinuity(group)
      const sealStability = mean(group.map((stock) => clamp(100 - stock.openCount * 25)))
      const themeAnchors = anchors.filter((anchor) => anchor.active && anchor.themes.includes(name))
      const anchorCount = new Set([
        ...themeAnchors.map((anchor) => anchor.code),
        ...group.filter((stock) => stock.consecutiveDays >= 4).map((stock) => stock.code),
      ]).size
      const previousGroup = previousStocks.filter(
        (stock) => stock.primaryTheme === name || stock.themes.includes(name),
      )
      const currentMap = new Map(group.map((stock) => [stock.code, stock]))
      const promoted = previousGroup.filter((stock) => {
        const current = currentMap.get(stock.code)
        return !!current && current.consecutiveDays > stock.consecutiveDays
      }).length
      const promotionRate =
        previousGroup.length > 0 ? r2((promoted / previousGroup.length) * 100) : null
      const components: ThemeAnalysis['components'] = {
        continuity: r2(continuity * Math.min(1, maxBoards / 3) * 100),
        anchor: anchorCount > 0 ? 100 : maxBoards >= 3 ? 75 : maxBoards === 2 ? 35 : 0,
        depth: normalizePercent(multiBoardCount, 3),
        replenishment: normalizePercent(firstBoardCount, 3),
        promotion: promotionRate,
        breadth: normalizePercent(count, 5),
        seal: r2(sealStability),
      }
      const score = weightedAvailable([
        { value: components.continuity, weight: 0.2 },
        { value: components.anchor, weight: 0.15 },
        { value: components.depth, weight: 0.15 },
        { value: components.replenishment, weight: 0.15 },
        { value: components.promotion, weight: 0.15 },
        { value: components.breadth, weight: 0.1 },
        { value: components.seal, weight: 0.1 },
      ])
      const grade: ThemeGrade = score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D'
      const complete =
        anchorCount > 0 &&
        multiBoardCount >= 1 &&
        firstBoardCount >= 2 &&
        continuity >= 0.999
      return {
        name,
        grade,
        score,
        count,
        firstBoardCount,
        multiBoardCount,
        maxBoards,
        continuity: r2(continuity * 100),
        promotionRate,
        sealStability: r2(sealStability),
        stockCodes: group.map((stock) => stock.code),
        anchorCount,
        complete,
        components,
      }
    })
    .sort((a, b) => b.score - a.score || b.maxBoards - a.maxBoards || b.count - a.count)
}

function applyThemeEventGate(
  themes: ThemeAnalysis[],
  gate: LadderEventGate,
): ThemeAnalysis[] {
  return themes
    .map((theme) => {
      const adjustment = Object.entries(gate.themeAdjustments)
        .filter(
          ([eventTheme]) =>
            eventTheme === theme.name ||
            eventTheme.includes(theme.name) ||
            theme.name.includes(eventTheme),
        )
        .reduce((sum, [, value]) => sum + value, 0)
      if (adjustment === 0) return theme
      const score = r2(clamp(theme.score + clamp(adjustment, -15, 15)))
      const grade: ThemeGrade =
        score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D'
      return { ...theme, score, grade }
    })
    .sort((a, b) => b.score - a.score || b.maxBoards - a.maxBoards || b.count - a.count)
}

export function computePromotionLanes(
  stocks: NormalizedStock[],
  themes: ThemeAnalysis[],
  previousStocks: Array<Pick<LadderStockAnalysis, 'code' | 'consecutiveDays'>> = [],
  anchors: ThemeAnchor[] = [],
  statistics?: PromotionStatistics,
): PromotionLane[] {
  const themeMap = new Map(themes.map((theme) => [theme.name, theme]))
  const currentMap = new Map(stocks.map((stock) => [stock.code, stock]))
  const lanes = [1, 2, 3].map((fromBoards): PromotionLane => {
    const supply = stocks.filter(
      (stock) => mainBoardCode(stock.code) && stock.consecutiveDays === fromBoards,
    )
    const previous = previousStocks.filter(
      (stock) => mainBoardCode(stock.code) && stock.consecutiveDays === fromBoards,
    )
    const promoted = previous.filter((stock) => {
      const current = currentMap.get(stock.code)
      return !!current && current.consecutiveDays > fromBoards
    }).length
    const dailyPromotionRate =
      previous.length > 0 ? r2((promoted / previous.length) * 100) : null
    const estimate = statistics?.byLane[`${fromBoards}进${fromBoards + 1}`]?.day20
    const promotionRate = estimate?.adjustedRate ?? dailyPromotionRate
    const themeBacked = supply.filter((stock) =>
      themeNames(stock).some((name) => {
        const theme = themeMap.get(name)
        return theme?.grade === 'A' || theme?.grade === 'B'
      }),
    ).length
    const themeCoverage = supply.length > 0 ? r2((themeBacked / supply.length) * 100) : 0
    const upperAnchor =
      stocks.some((stock) => stock.consecutiveDays > fromBoards) ||
      anchors.some((anchor) => anchor.active)
        ? 100
        : 0
    const sealStability =
      supply.length > 0
        ? r2(mean(supply.map((stock) => clamp(100 - stock.openCount * 25))))
        : 0
    const score = weightedAvailable([
      { value: promotionRate, weight: 0.35 },
      { value: normalizePercent(supply.length, 3), weight: 0.25 },
      { value: themeCoverage, weight: 0.2 },
      { value: upperAnchor, weight: 0.1 },
      { value: sealStability, weight: 0.1 },
    ])
    return {
      fromBoards,
      toBoards: fromBoards + 1,
      label: `${fromBoards}进${fromBoards + 1}`,
      score,
      supply: supply.length,
      promotionRate,
      promoted,
      promotionTotal: previous.length,
      themeCoverage,
      upperAnchor,
      sealStability,
      dominant: false,
      rawPromotionRate: estimate?.rawRate ?? dailyPromotionRate,
      adjustedPromotionRate: estimate?.adjustedRate ?? dailyPromotionRate,
      promotionConfidence: estimate?.confidence ?? 'low',
      rollingValid: estimate?.valid ?? previous.length,
      rollingPromoted: estimate?.promoted ?? promoted,
    }
  })
  const dominant = [...lanes]
    .filter((lane) => lane.supply > 0)
    .sort((a, b) => b.score - a.score || b.fromBoards - a.fromBoards)[0]
  return lanes.map((lane) => ({ ...lane, dominant: lane.fromBoards === dominant?.fromBoards }))
}

function turnoverSweetSpot(boards: number): [number, number] {
  if (boards <= 1) return [5, 20]
  if (boards === 2) return [8, 25]
  return [10, 30]
}

function bandScore(value: number, lower: number, upper: number): number {
  if (value >= lower && value <= upper) return 100
  if (value < lower) return clamp((value / Math.max(lower, 1)) * 100)
  return clamp(100 - ((value - upper) / Math.max(45 - upper, 1)) * 100)
}

export function scoreTurnoverCapacity(args: {
  turnoverRate: number
  amount: number
  circulatingMarketCap?: number | null
  boards: number
  laneAmounts?: number[]
}): TurnoverCapacity {
  const circulatingMarketCap =
    typeof args.circulatingMarketCap === 'number' && args.circulatingMarketCap > 0
      ? args.circulatingMarketCap
      : null
  const amountToFloatCapPct =
    circulatingMarketCap && args.amount > 0
      ? r2((args.amount / circulatingMarketCap) * 100)
      : null
  const validTurnover = args.turnoverRate > 0 ? args.turnoverRate : null
  const effectiveTurnoverPct =
    validTurnover != null && amountToFloatCapPct != null
      ? r2((validTurnover + amountToFloatCapPct) / 2)
      : validTurnover ?? amountToFloatCapPct
  const [lower, upper] = turnoverSweetSpot(args.boards)
  const turnoverScore =
    effectiveTurnoverPct == null ? null : bandScore(effectiveTurnoverPct, lower, upper)
  const amountPercentile = crossSectionPercentile(args.amount, args.laneAmounts ?? [args.amount])
  const dataConsistent =
    validTurnover == null ||
    amountToFloatCapPct == null ||
    Math.abs(validTurnover - amountToFloatCapPct) /
      Math.max(validTurnover, amountToFloatCapPct, 0.01) <=
      0.3
  // 成交额分位只归属绝对流动性支柱，避免和有效换手重复计分。
  const score = weightedAvailable([{ value: turnoverScore, weight: 1 }])
  return {
    circulatingMarketCap,
    amountToFloatCapPct,
    effectiveTurnoverPct,
    score,
    amountPercentile,
    dataConsistent,
    note:
      effectiveTurnoverPct == null
        ? '换手容量缺失'
        : `有效换手${effectiveTurnoverPct}%·同层成交额P${Math.round(amountPercentile)}`,
  }
}

function rollingMean(values: number[], endExclusive: number, window: number): number | null {
  const start = endExclusive - window
  if (start < 0) return null
  const slice = values.slice(start, endExclusive)
  return slice.length === window ? mean(slice) : null
}

function rollingNullableMean(
  values: Array<number | null>,
  endExclusive: number,
  window: number,
): number | null {
  const start = endExclusive - window
  if (start < 0) return null
  const slice = values.slice(start, endExclusive)
  if (slice.length !== window || slice.some((value) => value == null || !Number.isFinite(value))) {
    return null
  }
  return mean(slice as number[])
}

function rollingHigh(bars: KlineBar[], endExclusive: number, window: number): number | null {
  const start = endExclusive - window
  if (start < 0) return null
  return Math.max(...bars.slice(start, endExclusive).map((bar) => bar.high))
}

function rollingLow(bars: KlineBar[], endExclusive: number, window: number): number | null {
  const start = endExclusive - window
  if (start < 0) return null
  return Math.min(...bars.slice(start, endExclusive).map((bar) => bar.low))
}

function trueRange(bars: KlineBar[], index: number): number {
  const bar = bars[index]
  if (index === 0) return bar.high - bar.low
  const prevClose = bars[index - 1].close
  return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose))
}

function amountRatioAt(bars: KlineBar[], index: number): { value: number | null; source: TechnicalEvidence['amountRatioSource'] } {
  const amountBase = rollingNullableMean(
    bars.map((bar) => bar.turnover),
    index,
    20,
  )
  const turnover = bars[index].turnover
  if (amountBase && amountBase > 0 && turnover != null && turnover > 0) {
    return { value: turnover / amountBase, source: 'amount' }
  }
  const volumeBase = rollingMean(
    bars.map((bar) => bar.volume),
    index,
    20,
  )
  if (volumeBase && volumeBase > 0 && bars[index].volume > 0) {
    return { value: bars[index].volume / volumeBase, source: 'volume' }
  }
  return { value: null, source: 'missing' }
}

function breakoutAt(bars: KlineBar[], index: number, window: number): boolean | null {
  const high = rollingHigh(bars, index, window)
  return high == null ? null : bars[index].close > high
}

function findEpisodeOnset(bars: KlineBar[], eventIndex: number, code: string): number {
  const start = Math.max(1, eventIndex - 40)
  let anchor = start
  for (let i = start + 1; i <= eventIndex; i++) {
    if (bars[i].low < bars[anchor].low) anchor = i
  }
  for (let i = Math.min(anchor + 1, eventIndex); i <= eventIndex; i++) {
    const prevClose = bars[i - 1]?.close ?? 0
    const ret = prevClose > 0 ? bars[i].close / prevClose - 1 : 0
    const volume = amountRatioAt(bars, i).value
    if (isLimitUpDay(bars[i], prevClose, code) || (breakoutAt(bars, i, 20) && ret >= 0.03 && (volume ?? 0) >= 1.15)) {
      return i
    }
  }
  return eventIndex
}

function emptyTechnical(lastDate = '', barCount = 0): TechnicalEvidence {
  return {
    available: false,
    settled: false,
    lastDate,
    barCount,
    ma20: null,
    ma60: null,
    ma120: null,
    ma120Rising: null,
    atr14Pct: null,
    breakout20: null,
    breakout60: null,
    breakout120: null,
    breakoutLine20: null,
    pre20RangePct: null,
    amountRatio20: null,
    amountRatioSource: 'missing',
    prePosition120Pct: null,
    episodeOnsetDate: null,
    episodeReturnPct: null,
    sessionsFromOnset: null,
    recognitionLate: false,
    onePrice: false,
    onePriceStreak: 0,
    shape: 'insufficient',
    platformEdge: null,
    onsetLow: null,
  }
}

export function analyzeTechnical(
  barsInput: KlineBar[],
  code: string,
  asof: string,
  sessionSettled = true,
): TechnicalEvidence {
  const bars = barsInput.filter((bar) => bar.date <= asof).sort((a, b) => a.date.localeCompare(b.date))
  if (bars.length < 21) return emptyTechnical(bars.at(-1)?.date ?? '', bars.length)
  const index = bars.length - 1
  const today = bars[index]
  const settled = today.date === asof && sessionSettled
  const closes = bars.map((bar) => bar.close)
  const ma20 = rollingMean(closes, bars.length, 20)
  const ma60 = rollingMean(closes, bars.length, 60)
  const ma120 = rollingMean(closes, bars.length, 120)
  const ma120Past = bars.length >= 130 ? rollingMean(closes, bars.length - 10, 120) : null
  const prior20High = rollingHigh(bars, index, 20)
  const prior20Low = rollingLow(bars, index, 20)
  const prior60High = rollingHigh(bars, index, 60)
  const prior120High = rollingHigh(bars, index, 120)
  const prior120Low = rollingLow(bars, index, 120)
  const pre20RangePct = prior20High != null && prior20Low != null && prior20Low > 0 ? (prior20High / prior20Low - 1) * 100 : null
  const prePosition120Pct =
    prior120High != null && prior120Low != null && prior120High > prior120Low
      ? ((bars[index - 1].close - prior120Low) / (prior120High - prior120Low)) * 100
      : null
  const amountRatio = amountRatioAt(bars, index)
  const atrValues = Array.from({ length: Math.min(14, bars.length - 1) }, (_, offset) => trueRange(bars, index - offset))
  const atr14Pct = today.close > 0 ? (mean(atrValues) / today.close) * 100 : null
  const breakout20 = prior20High == null ? null : today.close > prior20High
  const breakout60 = prior60High == null ? null : today.close > prior60High
  const breakout120 = prior120High == null ? null : today.close > prior120High
  const prevClose = bars[index - 1].close
  const strongDay = isLimitUpDay(today, prevClose, code) || today.changePct >= 7
  const platform = (pre20RangePct ?? Infinity) <= 25
  const lowPosition = (prePosition120Pct ?? Infinity) <= 35
  const highPosition = (prePosition120Pct ?? -Infinity) >= 80
  const bullishMa = ma20 != null && ma60 != null && ma20 > ma60
  const fallingMa = ma20 != null && ma60 != null && ma20 < ma60
  let shape: ShapeArchetype
  if (breakout60 && platform && lowPosition) shape = 'low-platform-breakout'
  else if (breakout20 && platform && bullishMa && !highPosition) shape = 'trend-platform'
  else if (breakout60 && highPosition && bullishMa) shape = 'high-new-high'
  else if (strongDay && lowPosition && fallingMa) shape = 'low-oversold-reversal'
  else if (breakout20 && platform) shape = 'platform-breakout'
  else if (breakout20) shape = 'non-platform-breakout'
  else if (strongDay) shape = 'event-reversal'
  else shape = 'insufficient'

  const onsetIndex = findEpisodeOnset(bars, index, code)
  const onsetBase = bars[Math.max(0, onsetIndex - 1)].close
  const episodeReturnPct = onsetBase > 0 ? (today.close / onsetBase - 1) * 100 : null
  const recognitionLate = (episodeReturnPct ?? 0) > 50 && !platform
  let onePriceStreak = 0
  for (let cursor = index; cursor > 0; cursor--) {
    const bar = bars[cursor]
    const previousClose = bars[cursor - 1].close
    const onePrice =
      Math.abs(bar.high - bar.low) < 0.005 && isLimitUpDay(bar, previousClose, code)
    if (!onePrice) break
    onePriceStreak++
  }

  return {
    available: true,
    settled,
    lastDate: today.date,
    barCount: bars.length,
    ma20: ma20 == null ? null : r2(ma20),
    ma60: ma60 == null ? null : r2(ma60),
    ma120: ma120 == null ? null : r2(ma120),
    ma120Rising: ma120 == null || ma120Past == null ? null : ma120 > ma120Past,
    atr14Pct: atr14Pct == null ? null : r2(atr14Pct),
    breakout20,
    breakout60,
    breakout120,
    breakoutLine20: prior20High == null ? null : r2(prior20High),
    pre20RangePct: pre20RangePct == null ? null : r2(pre20RangePct),
    amountRatio20: amountRatio.value == null ? null : r2(amountRatio.value),
    amountRatioSource: amountRatio.source,
    prePosition120Pct: prePosition120Pct == null ? null : r2(prePosition120Pct),
    episodeOnsetDate: bars[onsetIndex]?.date ?? null,
    episodeReturnPct: episodeReturnPct == null ? null : r2(episodeReturnPct),
    sessionsFromOnset: index - onsetIndex,
    recognitionLate,
    onePrice: Math.abs(today.high - today.low) < 0.005 && isLimitUpDay(today, prevClose, code),
    onePriceStreak,
    shape,
    platformEdge: prior20High == null ? null : r2(prior20High),
    onsetLow: bars[onsetIndex]?.low == null ? null : r2(bars[onsetIndex].low),
  }
}

function technicalScore(shape: ShapeArchetype): number {
  const scores: Record<ShapeArchetype, number> = {
    'low-platform-breakout': 95,
    'trend-platform': 90,
    'platform-breakout': 85,
    'low-oversold-reversal': 80,
    'non-platform-breakout': 70,
    'event-reversal': 65,
    'high-new-high': 55,
    insufficient: 35,
  }
  return scores[shape]
}

function ladderRoleScore(role: LadderRole): number {
  return {
    'space-leader': 100,
    'theme-leader': 85,
    'first-pioneer': 80,
    'mid-ladder': 60,
    follower: 40,
  }[role]
}

export function scoreLadderFundFlow(day?: LhbDay): LadderFundFlow {
  const moneyMagnitude = (value: number, cap: number) =>
    clamp(Math.log10(1 + Math.abs(value) / 1e6) / Math.log10(301) * cap, 0, cap)
  if (!day) {
    return {
      available: false,
      score: null,
      net: 0,
      instNet: 0,
      hotNet: 0,
      lhasaNet: 0,
      note: '资金流不可用；不以中性分伪装证据',
      source: 'unavailable',
    }
  }
  let score = 50
  score += Math.sign(day.instNet) * moneyMagnitude(day.instNet, 25)
  score += Math.sign(day.hotNet) * moneyMagnitude(day.hotNet, 15)
  score -= Math.max(0, moneyMagnitude(day.lhasaNet ?? 0, 20))
  score += Math.sign(day.net) * moneyMagnitude(day.net, 10)
  score = clamp(r2(score))
  return {
    available: true,
    score,
    net: day.net,
    instNet: day.instNet,
    hotNet: day.hotNet,
    lhasaNet: day.lhasaNet ?? 0,
    note: `机构${r2(day.instNet / 1e4)}万·游资${r2(day.hotNet / 1e4)}万·拉萨${r2((day.lhasaNet ?? 0) / 1e4)}万`,
    source: 'eastmoney-lhb',
  }
}

function timeMinutes(value: string): number | null {
  if (!value) return null
  const digits = value.padStart(6, '0')
  const hour = Number(digits.slice(0, 2))
  const minute = Number(digits.slice(2, 4))
  return Number.isFinite(hour + minute) ? hour * 60 + minute : null
}

function sealScore(stock: NormalizedStock, onePrice: boolean): number {
  let score = 70
  const minutes = timeMinutes(stock.firstTime)
  if (minutes == null) score -= 10
  else if (minutes <= 9 * 60 + 45) score += 20
  else if (minutes <= 10 * 60 + 30) score += 10
  score -= stock.openCount * 15
  if (onePrice) score -= 5
  return clamp(score)
}

function importedRole(value: string): LadderRole | null {
  const lower = value.toLowerCase()
  if (lower.includes('空间') || lower.includes('space')) return 'space-leader'
  if (lower.includes('题材龙') || lower.includes('theme')) return 'theme-leader'
  if (lower.includes('先锋') || lower.includes('pioneer')) return 'first-pioneer'
  if (lower.includes('中位') || lower.includes('mid')) return 'mid-ladder'
  if (lower.includes('后排') || lower.includes('follower')) return 'follower'
  return null
}

function determineRole(
  stock: NormalizedStock,
  maxBoards: number,
  theme: ThemeAnalysis,
): LadderRole {
  const imported = importedRole(stock.importedRole)
  if (imported) return imported
  if (stock.consecutiveDays === maxBoards && maxBoards >= 2) return 'space-leader'
  if (stock.consecutiveDays === theme.maxBoards && theme.maxBoards >= 2) return 'theme-leader'
  if (stock.consecutiveDays === 1 && (timeMinutes(stock.firstTime) ?? Infinity) <= 10 * 60) return 'first-pioneer'
  if (stock.consecutiveDays >= 2) return 'mid-ladder'
  return 'follower'
}

function dragonDimension(score: number, note: string): LadderDimension {
  return { score: r2(clamp(score)), note }
}

/**
 * Identify the already-emerging leader inside one primary-theme cohort.
 * This is deliberately a recognition score, not a return forecast.  The
 * current ladder feed has reliable close/board/seal data but not a complete
 * cross-sectional 1-minute cache, so drive/anti-drop use explicit proxies.
 */
export function scoreDragonIdentity(args: {
  stock: NormalizedStock
  theme: ThemeAnalysis
  peers: NormalizedStock[]
  role: LadderRole
  evidence: TechnicalEvidence
  market: MarketCycle
  turnover: TurnoverCapacity
  followerCount: number
  onePrice: boolean
}): DragonIdentity {
  const { stock, theme, peers, role, evidence, market, turnover, followerCount, onePrice } = args
  const validPeers = peers.length ? peers : [stock]
  const firstTimes = validPeers
    .map((item) => timeMinutes(item.firstTime))
    .filter((value): value is number => value != null)
  const first = timeMinutes(stock.firstTime)
  const early = first == null || firstTimes.length < 2
    ? 50
    : clamp(100 - ((firstTimes.filter((value) => value < first).length / Math.max(firstTimes.length - 1, 1)) * 100))
  const peerFollowerMax = Math.max(3, ...validPeers.map((item) =>
    validPeers.filter((other) => other.code !== item.code && other.firstTime && item.firstTime && other.firstTime > item.firstTime).length,
  ))
  const resonance = weightedAvailable([
    { value: normalizePercent(theme.count, 8), weight: 0.35 },
    { value: theme.score, weight: 0.4 },
    { value: normalizePercent(followerCount, peerFollowerMax), weight: 0.25 },
  ])
  const drive = weightedAvailable([
    { value: early, weight: 0.4 },
    { value: resonance, weight: 0.6 },
  ])

  const maxBoards = Math.max(...validPeers.map((item) => item.consecutiveDays), stock.consecutiveDays)
  const boardScore = clamp(100 - (maxBoards - stock.consecutiveDays) * 15)
  const returns = validPeers.map((item) => item.consecutiveDays * 10 + item.changePct)
  const returnProxy = stock.consecutiveDays * 10 + stock.changePct
  const returnScore = crossSectionPercentile(returnProxy, returns)
  const leadership = weightedAvailable([
    { value: boardScore, weight: 0.6 },
    { value: returnScore, weight: 0.4 },
  ])

  const antiBase = market.phase === 'repair' ? 75 : market.phase === 'ebb' ? 45 : market.phase === 'climax' ? 55 : 60
  const shapeAdjustment = evidence.shape === 'low-platform-breakout' || evidence.shape === 'trend-platform' ? 10
    : evidence.shape === 'high-new-high' ? -20 : 0
  const antiDrop = clamp(antiBase + shapeAdjustment)

  const sealBase = sealScore(stock, onePrice)
  const sealRatio = stock.sealAmount != null && stock.amount > 0
    ? clamp((stock.sealAmount / stock.amount / 0.2) * 100)
    : null
  const sealQuality = weightedAvailable([
    { value: sealBase, weight: 0.6 },
    { value: sealRatio, weight: 0.4 },
  ])
  const liquidity = weightedAvailable([
    { value: turnover.score, weight: 0.5 },
    { value: sealQuality, weight: 0.5 },
  ])

  const absorption = weightedAvailable([
    { value: theme.score, weight: 0.5 },
    { value: theme.promotionRate, weight: 0.3 },
    { value: normalizePercent(theme.count, 10), weight: 0.2 },
  ])

  const dimensions = {
    drive: dragonDimension(drive, first == null ? '首封时间缺失，带动性为代理分' : `首封${stock.firstTime}·题材内时间序`),
    leadership: dragonDimension(leadership, `${stock.consecutiveDays}板·题材最高${maxBoards}板·涨幅代理P${Math.round(returnScore)}`),
    antiDrop: dragonDimension(antiDrop, `市场${market.phase}·${evidence.shape}·分时抗跌数据未接入`),
    liquidity: dragonDimension(liquidity, `换手${turnover.effectiveTurnoverPct ?? '--'}%·封板${stock.openCount}次`),
    absorption: dragonDimension(absorption, `${theme.name}·${theme.count}只·晋级${theme.promotionRate ?? '--'}%`),
  }
  const failed: string[] = []
  if (dimensions.drive.score < 40) failed.push('带动性<40')
  if (dimensions.leadership.score < 40) failed.push('领涨性<40')
  if (dimensions.antiDrop.score < 35) failed.push('抗跌性<35')
  if (dimensions.liquidity.score < 35) failed.push('流动性<35')
  const score = weightedAvailable([
    { value: dimensions.drive.score, weight: 0.3 },
    { value: dimensions.leadership.score, weight: 0.25 },
    { value: dimensions.antiDrop.score, weight: 0.15 },
    { value: dimensions.liquidity.score, weight: 0.2 },
    { value: dimensions.absorption.score, weight: 0.1 },
  ])
  const insufficient = !stock.firstTime && !evidence.available && stock.amount <= 0
  const verdict: DragonVerdict = insufficient
    ? 'insufficient-data'
    : failed.length
      ? 'follower'
      : score >= 75 && (role === 'space-leader' || role === 'theme-leader') && dimensions.drive.score >= 60
        ? 'true-dragon'
        : score >= 60 ? 'core' : 'follower'
  return {
    score,
    verdict,
    dimensions,
    hardGate: { passed: failed.length === 0, failed },
    evidence: [
      '题材内横向比较',
      '带动性与抗跌性当前使用盘后可得字段代理，未接入完整1分钟因果时序',
      onePrice ? '一字板不扣龙头强度分，实际可交易性仍单独处理' : '换手板可交易性独立处理',
    ],
  }
}

function statePriority(state: LadderState): number {
  return { candidate: 0, waiting: 1, observe: 2, exclude: 3 }[state]
}

function buildTrigger(stock: NormalizedStock, technical: TechnicalEvidence): string {
  const atr = technical.atr14Pct == null ? '1 ATR' : `${technical.atr14Pct.toFixed(1)}%`
  if (stock.consecutiveDays >= 4) return '只观察首次有效分歧：不崩、重新站回均价或突破分歧日高点'
  if (boardType(stock.code) === 'twenty') return '缩量回踩20日突破线不破，随后重新突破信号日高点'
  return `次日跳空不超过${atr}，守住涨停价或平台边缘后重新转强`
}

function buildInvalidation(technical: TechnicalEvidence): string {
  const levels = [technical.platformEdge, technical.onsetLow].filter((n): n is number => n != null)
  if (!levels.length) return '跌破启动日结构低点，或题材梯队明显退潮'
  return `收盘跌破${Math.max(...levels).toFixed(2)}附近结构位，或题材梯队明显退潮`
}

async function fetchLadderMarketProfiles(
  codes: string[],
): Promise<Map<string, LadderMarketProfile>> {
  const out = new Map<string, LadderMarketProfile>()
  const hosts = ['push2.eastmoney.com', 'push2delay.eastmoney.com']
  const unique = Array.from(new Set(codes.filter((code) => /^\d{6}$/.test(code))))
  for (let index = 0; index < unique.length; index += 50) {
    const chunk = unique.slice(index, index + 50)
    const secids = chunk
      .map((code) => `${code.startsWith('6') ? '1' : '0'}.${code}`)
      .join(',')
    for (const host of hosts) {
      try {
        const url =
          `https://${host}/api/qt/ulist.np/get?fltt=2&invt=2&secids=${secids}` +
          '&fields=f12,f21'
        const response = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 6_000 })
        if (!response.ok) continue
        const json = (await response.json()) as {
          data?: { diff?: Array<{ f12?: string; f21?: number }> }
        }
        const rows = json.data?.diff ?? []
        for (const row of rows) {
          const code = normalizeCode(row.f12)
          if (!code) continue
          const value = Number(row.f21)
          out.set(code, {
            circulatingMarketCap: Number.isFinite(value) && value > 0 ? value : null,
          })
        }
        if (rows.length > 0) break
      } catch {
        // Try the delayed quote mirror before degrading this factor.
      }
    }
  }
  return out
}

function buildHotRankMap(hotList?: HotListData): Map<string, HotRankEvidence> {
  const out = new Map<string, HotRankEvidence>()
  for (const row of hotList?.eastmoney ?? []) {
    out.set(row.code, {
      eastmoneyRank: row.rank,
      thsRank: out.get(row.code)?.thsRank ?? null,
    })
  }
  for (const row of hotList?.ths ?? []) {
    out.set(row.code, {
      eastmoneyRank: out.get(row.code)?.eastmoneyRank ?? null,
      thsRank: row.rank,
    })
  }
  return out
}

async function buildThemeAnchors(
  current: NormalizedStock[],
  histories: LimitLadderAnalysis[],
  asof: string,
): Promise<ThemeAnchor[]> {
  const anchors = new Map<string, ThemeAnchor>()
  for (const stock of current.filter(
    (item) => mainBoardCode(item.code) && item.consecutiveDays >= 4,
  )) {
    anchors.set(stock.code, {
      code: stock.code,
      name: stock.name,
      themes: themeNames(stock),
      source: 'current-high-board',
      priorMaxBoards: stock.consecutiveDays,
      recentLimitUps: 1,
      distanceFromFiveDayHighPct: 0,
      active: true,
    })
  }

  const currentCodes = new Set(
    current.filter((stock) => mainBoardCode(stock.code)).map((stock) => stock.code),
  )
  const recent = new Map<
    string,
    {
      code: string
      name: string
      themes: string[]
      priorMaxBoards: number
      recentLimitUps: number
    }
  >()
  for (const analysis of histories) {
    for (const stock of analysis.stocks) {
      if (stock.boardType !== 'main') continue
      if (currentCodes.has(stock.code)) continue
      const prior = recent.get(stock.code)
      recent.set(stock.code, {
        code: stock.code,
        name: stock.name,
        themes: Array.from(new Set([...(prior?.themes ?? []), ...stock.themes])),
        priorMaxBoards: Math.max(prior?.priorMaxBoards ?? 0, stock.consecutiveDays),
        recentLimitUps: (prior?.recentLimitUps ?? 0) + 1,
      })
    }
  }
  const candidates = Array.from(recent.values()).filter(
    (stock) => stock.priorMaxBoards >= 3 || stock.recentLimitUps >= 3,
  )
  const enriched = await mapLimit(candidates, 6, async (stock): Promise<ThemeAnchor> => {
    try {
      const { klines } = await fetchStockKline(stock.code, 101, 12)
      const bars = klines.filter((bar) => bar.date <= asof).slice(-5)
      const latest = bars.at(-1)
      const high = Math.max(0, ...bars.map((bar) => bar.high))
      const distance =
        latest && high > 0 ? r2(((high - latest.close) / high) * 100) : null
      return {
        ...stock,
        source: 'recent-high-anchor',
        distanceFromFiveDayHighPct: distance,
        active:
          !!latest &&
          latest.date === asof &&
          latest.changePct > -9.5 &&
          distance != null &&
          distance <= 10,
      }
    } catch {
      return {
        ...stock,
        source: 'recent-high-anchor',
        distanceFromFiveDayHighPct: null,
        active: false,
      }
    }
  })
  for (const anchor of enriched) if (anchor.active) anchors.set(anchor.code, anchor)
  return Array.from(anchors.values())
}

function mergeStocks(
  auto: LimitStock[],
  kplStocks: KplRealtimeStock[],
  imported: LadderImportPayload | null,
  profiles: Map<string, LadderMarketProfile> = new Map(),
): NormalizedStock[] {
  const importedMap = new Map((imported?.stocks ?? []).map((stock) => [normalizeCode(stock.code), stock]))
  const autoMap = new Map(auto.map((stock) => [normalizeCode(stock.code), stock]))
  const kplMap = new Map(kplStocks.map((stock) => [normalizeCode(stock.code), stock]))
  const codes = new Set([
    ...autoMap.keys(),
    ...kplMap.keys(),
    ...importedMap.keys(),
  ])
  const merged: NormalizedStock[] = []

  for (const code of codes) {
    const market = autoMap.get(code)
    const kpl = kplMap.get(code)
    const extra = importedMap.get(code)
    const importedSealed = ['sealed', 'limit-up', '涨停'].includes(extra?.status?.trim() ?? '')
    if (!market && !kpl && (auto.length > 0 || kplStocks.length > 0) && !importedSealed) continue
    const warnings: string[] = []
    if (
      market &&
      market.consecutiveDays > 0 &&
      kpl &&
      market.consecutiveDays !== kpl.consecutiveDays
    ) {
      warnings.push(`东财板数${market.consecutiveDays}与开盘啦板数${kpl.consecutiveDays}冲突，采用开盘啦实时值`)
    }
    const sourceBoards = kpl?.consecutiveDays || market?.consecutiveDays || 0
    if (extra?.consecutiveDays != null && sourceBoards > 0 && extra.consecutiveDays !== sourceBoards) {
      warnings.push(`导入板数${extra.consecutiveDays}与实时板数${sourceBoards}冲突，采用实时值`)
    }
    const consecutiveDays = Math.max(1, sourceBoards || extra?.consecutiveDays || 1)
    const industry = market?.industry || kpl?.primaryTheme || ''
    const themes = Array.from(
      new Set([
        ...(kpl?.themes ?? []),
        ...(extra?.themes ?? []),
        ...(industry ? [industry] : []),
      ]),
    )
    if (themes.length === 0) themes.push('其他')
    const reason = extra?.reason || kpl?.primaryTheme || ''
    merged.push({
      code,
      name: kpl?.name || market?.name || extra?.name || code,
      price: market?.price || kpl?.price || 0,
      changePct: market?.changePct || kpl?.changePct || 0,
      turnoverRate: market?.turnoverRate || kpl?.turnoverRate || extra?.turnoverRate || 0,
      amount: market?.amount || kpl?.amount || extra?.amount || 0,
      circulatingMarketCap: profiles.get(code)?.circulatingMarketCap ?? null,
      firstTime: kpl?.firstTime || market?.firstTime || normalizeTime(extra?.firstTime),
      lastTime: market?.lastTime || normalizeTime(extra?.lastTime),
      openCount: market?.openCount ?? extra?.openCount ?? 0,
      consecutiveDays,
      industry,
      nDayBoards: kpl?.nDayBoards || extra?.nDayBoards || `${consecutiveDays}板`,
      themes,
      subtheme: extra?.subtheme || kpl?.primaryTheme || '',
      importedRole: extra?.role || '',
      reason,
      reasonSource: extra?.reason ? 'import' : kpl ? 'kaipanla' : 'none',
      sealAmount: extra?.sealAmount ?? kpl?.sealAmount ?? null,
      importedOnePrice: extra?.onePrice ?? null,
      patternHintAvailable: !!kpl,
      onePriceHint: kpl?.onePriceHint ?? false,
      tBoardHint: kpl?.tBoardHint ?? false,
      isMarginEligible: kpl?.isMarginEligible ?? false,
      warnings,
    })
  }
  return merged
}

export function rankAndClassifyStocks(args: {
  stocks: NormalizedStock[]
  themes: ThemeAnalysis[]
  technical: Map<string, TechnicalEvidence>
  market: MarketCycle
  degraded: boolean
  lhb?: Map<string, LhbDay>
  lanes?: PromotionLane[]
  hotRanks?: Map<string, HotRankEvidence>
  hotListAvailable?: boolean
  roleMap?: LadderRoleMap
  eventGate?: LadderEventGate
  expectations?: Map<string, {
    sequence: BoardSequenceEvidence
    expectation: RelayExpectation
    relayPathEvidence?: RelayPathEvidence
    relayPathScore?: RelayPathScore
  }>
}): LadderStockAnalysis[] {
  const {
    stocks,
    themes,
    technical,
    market,
    degraded,
    lhb = new Map(),
    lanes = [],
    hotRanks = new Map(),
    hotListAvailable = false,
    roleMap,
    eventGate,
    expectations,
  } = args
  const themeMap = new Map(themes.map((theme) => [theme.name, theme]))
  const maxBoards = Math.max(1, ...stocks.map((stock) => stock.consecutiveDays))
  const laneMap = new Map(lanes.map((lane) => [lane.fromBoards, lane]))
  const roleProfileMap = new Map(
    (roleMap?.profiles ?? []).map((profile) => [profile.code, profile]),
  )
  const amountByLane = new Map<number, number[]>()
  for (const stock of stocks) {
    amountByLane.set(stock.consecutiveDays, [
      ...(amountByLane.get(stock.consecutiveDays) ?? []),
      stock.amount,
    ])
  }
  const rows: LadderStockAnalysis[] = stocks.map((stock) => {
    const primaryTheme =
      stock.themes
        .map((name) => themeMap.get(name))
        .filter((theme): theme is ThemeAnalysis => !!theme)
        .sort((a, b) => b.score - a.score)[0] ?? {
        name: stock.industry || '其他',
        grade: 'D' as ThemeGrade,
        score: 0,
        maxBoards: 1,
      }
    const evidence = technical.get(stock.code) ?? emptyTechnical()
    const roleProfile = roleProfileMap.get(stock.code)
    const role = roleProfile?.marketRole === 'space-leader' ||
      roleProfile?.marketRole === 'co-space-leader'
      ? 'space-leader'
      : roleProfile?.themeRole === 'theme-position-leader' ||
          roleProfile?.themeRole === 'co-theme-position-leader'
        ? 'theme-leader'
        : determineRole(stock, maxBoards, primaryTheme as ThemeAnalysis)
    const stockEvents =
      eventGate?.events.filter((event) => event.codes.includes(stock.code)) ?? []
    const stockEventAction: LadderStockAnalysis['eventGate'] =
      stockEvents.some((event) => event.action === 'hard-block')
        ? 'hard-block'
        : stockEvents.some((event) => event.action === 'risk-cap')
          ? 'risk-cap'
          : 'none'
    const gateReasons = stockEvents
      .filter((event) => event.action !== 'informational')
      .map((event) => `${event.source}：${event.title}`)
    const onePrice =
      stock.importedOnePrice ??
      (stock.patternHintAvailable ? stock.onePriceHint : evidence.onePrice)
    const tBoard = !onePrice && stock.patternHintAvailable && stock.tBoardHint
    const themeLadder = scoreThemeLadderRelation({
      stock: {
        code: stock.code,
        name: stock.name,
        consecutiveDays: stock.consecutiveDays,
        themes: themeNames(stock),
        primaryTheme: primaryTheme.name,
        score: stock.amount,
        changePct: stock.changePct,
        onePrice,
      },
      peers: stocks.map((peer) => {
        const peerTheme =
          peer.themes
            .map((name) => themeMap.get(name))
            .filter((theme): theme is ThemeAnalysis => !!theme)
            .sort((a, b) => b.score - a.score)[0]
        return {
          code: peer.code,
          name: peer.name,
          consecutiveDays: peer.consecutiveDays,
          themes: themeNames(peer),
          primaryTheme: peerTheme?.name ?? (peer.industry || '其他'),
          score: peer.amount,
          changePct: peer.changePct,
          onePrice: peer.importedOnePrice ?? peer.onePriceHint,
        }
      }),
      theme: themeMap.get(primaryTheme.name),
    })
    const fundFlow = scoreLadderFundFlow(lhb.get(stock.code))
    const lane = laneMap.get(stock.consecutiveDays)
    const laneScore = lane?.score ?? null
    const turnoverCapacity = scoreTurnoverCapacity({
      turnoverRate: stock.turnoverRate,
      amount: stock.amount,
      circulatingMarketCap: stock.circulatingMarketCap,
      boards: stock.consecutiveDays,
      laneAmounts: amountByLane.get(stock.consecutiveDays),
    })
    const followerCount = stocks.filter((other) => {
      if (other.code === stock.code) return false
      if (!other.firstTime || !stock.firstTime || other.firstTime <= stock.firstTime) return false
      return themeNames(other).some((name) => themeNames(stock).includes(name))
    }).length
    const hot = hotRanks.get(stock.code)
    const eastmoneyScore =
      hot?.eastmoneyRank != null ? clamp(110 - hot.eastmoneyRank * 10) : null
    const thsScore = hot?.thsRank != null ? clamp(110 - hot.thsRank * 10) : null
    const hotRankScore =
      hotListAvailable && (eastmoneyScore != null || thsScore != null)
        ? weightedAvailable([
            { value: eastmoneyScore, weight: 0.5 },
            { value: thsScore, weight: 0.5 },
          ])
        : null
    const popularity: LadderPopularity = {
      score: weightedAvailable([
        { value: ladderRoleScore(role), weight: 0.4 },
        { value: normalizePercent(followerCount, 3), weight: 0.25 },
        { value: hotRankScore, weight: 0.2 },
        { value: fundFlow.available ? fundFlow.score : null, weight: 0.15 },
      ]),
      roleScore: ladderRoleScore(role),
      followScore: normalizePercent(followerCount, 3),
      hotRankScore,
      fundFlowScore: fundFlow.available ? fundFlow.score : null,
      eastmoneyRank: hot?.eastmoneyRank ?? null,
      thsRank: hot?.thsRank ?? null,
      followerCount,
      note: `${role}·带动${followerCount}只${hotRankScore == null ? '' : `·热榜${Math.round(hotRankScore)}`}`,
    }
    const sealBase = sealScore(stock, onePrice)
    const sealRatio =
      stock.sealAmount != null && stock.amount > 0
        ? clamp((stock.sealAmount / stock.amount / 0.2) * 100)
        : null
    const promotionSeal = weightedAvailable([
      { value: sealBase, weight: 0.7 },
      { value: sealRatio, weight: 0.3 },
    ])
    const accessibility = onePrice
      ? (evidence.onePriceStreak ?? 0) >= 2
        ? 20
        : 45
      : tBoard
        ? 90
        : 100
    const liquidity =
      stock.amount < MIN_LADDER_AMOUNT
        ? clamp((stock.amount / MIN_LADDER_AMOUNT) * 40)
        : Math.max(60, turnoverCapacity.amountPercentile)
    const reopen = clamp(sealBase + (tBoard ? 10 : 0) - (onePrice ? 15 : 0))
    const promotionDimensions: LadderV2Scores['promotionDimensions'] = {
      market: { score: market.score ?? 0, note: market.reasons.join('；') },
      lane: {
        score: laneScore ?? 0,
        note: lane ? `${lane.label}${lane.dominant ? '·主攻' : ''}` : `${stock.consecutiveDays}进${stock.consecutiveDays + 1}·历史缺失`,
      },
      theme: {
        score: primaryTheme.score,
        note: `${primaryTheme.grade}级 ${primaryTheme.name}${primaryTheme.complete ? '·完整梯队' : ''}·${themeLadder.note}`,
      },
      popularity: { score: popularity.score, note: popularity.note },
      seal: {
        score: promotionSeal,
        note: stock.firstTime ? `首封${stock.firstTime}·开板${stock.openCount}` : '封板时间缺失',
      },
      technical: { score: technicalScore(evidence.shape), note: evidence.shape },
    }
    const tradabilityDimensions: LadderV2Scores['tradabilityDimensions'] = {
      accessibility: {
        score: accessibility,
        note: onePrice ? `一字${evidence.onePriceStreak ?? 1}日` : tBoard ? 'T字换手' : '可达换手板',
      },
      turnoverCapacity: {
        score: turnoverCapacity.score,
        note: turnoverCapacity.note,
      },
      liquidity: {
        score: liquidity,
        note: `成交额${r2(stock.amount / 1e8)}亿·同层P${Math.round(turnoverCapacity.amountPercentile)}`,
      },
      structure: {
        score: technicalScore(evidence.shape),
        note: evidence.shape,
      },
      reopen: {
        score: reopen,
        note: `首封${stock.firstTime || '缺失'}·开板${stock.openCount}`,
      },
    }
    const dragonIdentity = scoreDragonIdentity({
      stock,
      theme: primaryTheme as ThemeAnalysis,
      peers: stocks.filter((other) => themeNames(other).includes(primaryTheme.name)),
      role,
      evidence,
      market,
      turnover: turnoverCapacity,
      followerCount,
      onePrice,
    })
    const promotionInputs = [
      { value: market.score, weight: 0.15 },
      // 梯队与题材共享部分封板/连续性信息，合计贡献由45%压到40%。
      { value: laneScore, weight: 0.175 },
      { value: promotionDimensions.theme.score, weight: 0.225 },
      { value: promotionDimensions.popularity.score, weight: 0.15 },
      { value: promotionDimensions.seal.score, weight: 0.15 },
      { value: promotionDimensions.technical.score, weight: 0.15 },
    ]
    const tradabilityInputs = [
      { value: tradabilityDimensions.accessibility.score, weight: 0.3 },
      { value: tradabilityDimensions.turnoverCapacity.score, weight: 0.3 },
      { value: tradabilityDimensions.liquidity.score, weight: 0.15 },
      { value: tradabilityDimensions.structure.score, weight: 0.15 },
      { value: tradabilityDimensions.reopen.score, weight: 0.1 },
    ]
    let promotionScore = weightedAvailable(promotionInputs)
    let tradabilityScore = weightedAvailable(tradabilityInputs)
    promotionScore = clamp(r2(promotionScore + themeLadder.bonus))
    const promotionCoverage = promotionInputs
      .filter((item) => item.value != null)
      .reduce((sum, item) => sum + item.weight, 0)
    const tradabilityCoverage = tradabilityInputs
      .filter((item) => item.value != null)
      .reduce((sum, item) => sum + item.weight, 0)
    const scoreMissingReasons = [
      market.score == null ? '缺少前一交易日市场方向' : '',
      laneScore == null ? '缺少梯队历史晋级证据' : '',
      !stock.firstTime ? '缺少正式封板时间' : '',
      !evidence.available || !evidence.settled ? '缺少已结算K线' : '',
      !fundFlow.available ? '资金流不可用' : '',
    ].filter(Boolean)
    const dimensions = {
      market: { score: market.score ?? 0, note: market.reasons.join('；') },
      theme: { score: primaryTheme.score, note: `${primaryTheme.grade}级 ${primaryTheme.name}` },
      ladder: { score: laneScore ?? 0, note: `${stock.consecutiveDays}板 · ${role}` },
      technical: { score: technicalScore(evidence.shape), note: evidence.shape },
      fundFlow: { score: fundFlow.score ?? 0, note: fundFlow.note },
      seal: { score: promotionSeal, note: stock.firstTime ? `首封${stock.firstTime}` : '封板时间缺失' },
    }
    const penalties: string[] = []
    if (evidence.recognitionLate) {
      promotionScore -= 15
      tradabilityScore -= 10
      penalties.push('识别过晚 -15')
    }
    if (evidence.shape === 'high-new-high') {
      promotionScore -= 10
      tradabilityScore -= 10
      penalties.push('高位加速 -10')
    }
    if (stock.consecutiveDays >= 4 && (evidence.pre20RangePct ?? Infinity) > 25) {
      promotionScore -= 10
      tradabilityScore -= 10
      penalties.push('四板以上且无新平台 -10')
    }
    if (stock.openCount >= 3) {
      promotionScore -= 10
      penalties.push('炸板三次以上 -10')
    }
    if (primaryTheme.grade === 'D') {
      promotionScore -= 15
      penalties.push('孤立题材 -15')
    }
    if (onePrice) {
      promotionScore += 5
      tradabilityScore -= 20
      penalties.push('一字强度 +5 / 可交易 -20')
      if ((evidence.onePriceStreak ?? 0) >= 2) {
        tradabilityScore -= 10
        penalties.push('连续一字可交易 -10')
      }
    }
    promotionScore = clamp(r2(promotionScore))
    tradabilityScore = clamp(r2(tradabilityScore))
    const score = r2(promotionScore * 0.6 + tradabilityScore * 0.4)

    const hardFailure =
      /ST|\*ST/i.test(stock.name) ||
      /^(N|C)/i.test(stock.name) ||
      (evidence.available && !evidence.settled) ||
      stockEventAction === 'hard-block'
    let state: LadderState
    if (hardFailure || score < 40) state = 'exclude'
    else if (stockEventAction === 'risk-cap') state = 'observe'
    else if (
      market.score == null ||
      laneScore == null ||
      !stock.firstTime ||
      !evidence.available ||
      !evidence.settled ||
      degraded ||
      !evidence.available ||
      !mainBoardCode(stock.code) ||
      primaryTheme.grade === 'C' ||
      primaryTheme.grade === 'D' ||
      stock.amount < MIN_LADDER_AMOUNT
    ) state = 'observe'
    else if (
      score >= 68 &&
      promotionScore >= 65 &&
      tradabilityScore >= 55 &&
      !onePrice &&
      stock.consecutiveDays >= 1 &&
      stock.consecutiveDays <= 3 &&
      (primaryTheme.grade === 'A' || primaryTheme.grade === 'B')
    ) {
      state = 'candidate'
    } else if (
      score >= 55 ||
      (onePrice && promotionScore >= 65) ||
      stock.consecutiveDays >= 4 ||
      dragonIdentity.verdict === 'core'
    ) state = 'waiting'
    else state = 'observe'

    const warnings = [...stock.warnings]
    if (!stock.firstTime) warnings.push('封板时间缺失')
    warnings.push(...scoreMissingReasons)
    if (!evidence.available) warnings.push('K线不足')
    if (evidence.available && !evidence.settled) warnings.push(`K线截止${evidence.lastDate}，与分析日不一致`)
    if (onePrice) warnings.push('一字涨停，当日不可执行')
    if (!turnoverCapacity.dataConsistent) warnings.push('换手率与成交流通比偏差超过30%')
    if (stock.circulatingMarketCap == null) warnings.push('流通市值缺失，容量分按换手率降级')
    if (!mainBoardCode(stock.code)) warnings.push('非主板10cm，仅列观察')
    if (stock.consecutiveDays >= 4) warnings.push('四板以上仅作情绪锚，不列新开仓候选')
    if (stock.amount < MIN_LADDER_AMOUNT) warnings.push('成交额不足1亿元，降级观察')
    if (degraded) warnings.push('数据源降级，状态最高为观察')
    if (stockEventAction === 'hard-block') warnings.push('消息闸门硬否决，排除候选')
    if (stockEventAction === 'risk-cap') warnings.push('监管或事件风险上限，状态最高为观察')

    const mainRisk =
      warnings[0] ??
      penalties[0] ??
      (market.phase === 'ebb' ? '市场处于退潮阶段' : evidence.shape === 'high-new-high' ? '高位加速回撤风险' : '次日不确认')

    return {
      rank: 0,
      code: stock.code,
      name: stock.name,
      price: stock.price,
      changePct: stock.changePct,
      boardType: boardType(stock.code),
      consecutiveDays: stock.consecutiveDays,
      nDayBoards: stock.nDayBoards,
      themes: stock.themes,
      primaryTheme: primaryTheme.name,
      subtheme: stock.subtheme,
      themeGrade: primaryTheme.grade,
      themeScore: primaryTheme.score,
      themeLadder,
      boardSequence: expectations?.get(stock.code)?.sequence,
      expectation: expectations?.get(stock.code)?.expectation,
      relayPathEvidence: expectations?.get(stock.code)?.relayPathEvidence,
      relayPathScore: expectations?.get(stock.code)?.relayPathScore,
      role,
      roleProfile,
      reason: stock.reason,
      firstTime: stock.firstTime,
      lastTime: stock.lastTime,
      openCount: stock.openCount,
      turnoverRate: stock.turnoverRate,
      amount: stock.amount,
      circulatingMarketCap: stock.circulatingMarketCap,
      sealAmount: stock.sealAmount,
      onePrice,
      tBoard,
      isMarginEligible: stock.isMarginEligible,
      reasonSource: stock.reasonSource,
      state,
      score,
      promotionLane: lane?.label ?? `${stock.consecutiveDays}进${stock.consecutiveDays + 1}`,
      promotionScore,
      tradabilityScore,
      baseScore: score,
      candidateRank: null,
      turnoverCapacity,
      popularity,
      dragonIdentity,
      v2: {
        promotion: promotionScore,
        tradability: tradabilityScore,
        base: score,
        promotionCoverage,
        tradabilityCoverage,
        missingReasons: scoreMissingReasons,
        promotionDimensions,
        tradabilityDimensions,
      },
      scoreCoverage: {
        promotion: r2(promotionCoverage),
        tradability: r2(tradabilityCoverage),
        missingReasons: scoreMissingReasons,
      },
      technical: evidence,
      dimensions,
      fundFlow,
      penalties,
      warnings,
      eventGate: stockEventAction,
      gateReasons,
      trigger: buildTrigger(stock, evidence),
      invalidation: buildInvalidation(evidence),
      mainRisk,
    } satisfies LadderStockAnalysis
  })

  const prelim = rows
    .sort(
      (a, b) =>
        statePriority(a.state) - statePriority(b.state) ||
        b.score - a.score ||
        b.consecutiveDays - a.consecutiveDays ||
        (a.firstTime || '999999').localeCompare(b.firstTime || '999999'),
    )
  for (const row of prelim) {
    row.fullLanePool = true
    row.hardEligible = row.state === 'candidate'
    row.quotaSelected = false
  }
  const selectedCodes = new Set<string>()
  const laneCounts = new Map<string, number>()
  const themeCounts = new Map<string, number>()
  for (const row of prelim.filter((item) => item.state === 'candidate')) {
    const lane = row.promotionLane ?? ''
    const laneCount = laneCounts.get(lane) ?? 0
    const themeCount = themeCounts.get(row.primaryTheme) ?? 0
    if (
      selectedCodes.size >= MAX_NEXT_DAY_CANDIDATES ||
      laneCount >= MAX_CANDIDATES_PER_LANE ||
      themeCount >= MAX_CANDIDATES_PER_THEME
    ) {
      row.state = 'waiting'
      row.warnings.push('候选限额外，转入等待确认')
      continue
    }
    selectedCodes.add(row.code)
    row.quotaSelected = true
    laneCounts.set(lane, laneCount + 1)
    themeCounts.set(row.primaryTheme, themeCount + 1)
  }

  let candidateRank = 0
  return prelim
    .sort(
      (a, b) =>
        statePriority(a.state) - statePriority(b.state) ||
        b.score - a.score ||
        b.consecutiveDays - a.consecutiveDays ||
        (a.firstTime || '999999').localeCompare(b.firstTime || '999999'),
    )
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      candidateRank: row.state === 'candidate' ? ++candidateRank : null,
    }))
}

function qualityRank(quality: LadderDataQuality): number {
  if (quality.sentimentStatus === 'unavailable' || quality.klineTotal === 0) return 0
  const sourceRank =
    !quality.degraded &&
    (quality.source === 'kaipanla' ||
      quality.source === 'eastmoney' ||
      quality.source === 'mixed')
      ? 2
      : 1
  const klineCoverage = Math.round(
    (quality.klineComplete / Math.max(quality.klineTotal, 1)) * 100,
  )
  return sourceRank * 1_000 + klineCoverage
}

export interface LadderArchiveEligibility {
  eligible: boolean
  reasons: string[]
}

/**
 * 归档只接受同一交易日、收盘后、来源可追溯且所有候选已结算的数据。
 * 这条门槛是 fail-closed：缺少 providerAt、接收时间、原始调整口径或资金流，
 * 都只能留在研究快照，不能冒充已确认的历史样本。
 */
export function canFinalizeLadderArchive(
  analysis: LimitLadderAnalysis,
  evidence: EvidenceArchive,
  nowMs = Date.now(),
): LadderArchiveEligibility {
  const reasons: string[] = []
  if (!isTradingDayAt(nowMs)) reasons.push('当前日期不是交易日')
  if (!isLadderSettledWindow(shanghaiClockAt(nowMs))) reasons.push('尚未进入收盘定盘窗口')
  if (analysis.asof !== todayShanghai(nowMs)) reasons.push('只允许归档当前交易日')
  if (evidence.asof !== analysis.asof) reasons.push('证据日期与分析日期不一致')
  if (analysis.stocks.length === 0) reasons.push('涨停池为空')
  if (analysis.quality.sentimentStatus !== 'full') {
    reasons.push(`情绪数据状态为${analysis.quality.sentimentStatus}`)
  }
  if (analysis.quality.sourceDate !== analysis.asof) reasons.push('主数据源不是分析日')
  if (!analysis.quality.limitFieldsComplete) reasons.push('封板时间或板数不完整')
  if (analysis.quality.klineTotal <= 0) reasons.push('没有K线证据')
  if (analysis.quality.klineComplete !== analysis.quality.klineTotal) {
    reasons.push('K线覆盖不完整')
  }
  if (analysis.quality.degraded) reasons.push('数据质量已降级')
  if (!analysis.quality.fundFlowComplete) reasons.push('资金流证据未发布或不完整')
  if (analysis.quality.settled !== true) reasons.push('K线尚未标记为已结算')
  if (!analysis.quality.providerAt) reasons.push('缺少K线providerAt')
  if (!analysis.quality.receivedAt) reasons.push('缺少K线receivedAt')
  if (!analysis.quality.adjustment || analysis.quality.adjustment === 'unknown') {
    reasons.push('缺少明确K线复权口径')
  }
  if (!evidence.providerAt) reasons.push('归档证据缺少providerAt')
  if (!evidence.receivedAt) reasons.push('归档证据缺少receivedAt')
  if (!evidence.adjustment || evidence.adjustment === 'unknown') reasons.push('归档证据缺少明确K线复权口径')
  if (!evidence.settled) reasons.push('归档证据未标记为已结算')
  if (Object.keys(evidence.klines).length !== analysis.quality.klineTotal) {
    reasons.push('归档K线股票数与候选池不一致')
  }
  return { eligible: reasons.length === 0, reasons: Array.from(new Set(reasons)) }
}

function buildBoardSequenceForStock(args: {
  stock: NormalizedStock
  rawBars: KlineBar[]
  asof: string
  sessionSettled: boolean
}): { sequence: BoardSequenceEvidence; observations: BoardDayObservation[] } {
  const bars = args.rawBars
    .filter((bar) => bar.date <= args.asof)
    .sort((a, b) => a.date.localeCompare(b.date))
  const observations: BoardDayObservation[] = bars.map((bar, index) => {
    const previous = bars[index - 1]
    const previousSession = previous ? (() => {
      const cursor = new Date(`${bar.date.slice(0, 10)}T00:00:00Z`)
      for (let step = 0; step < 370; step += 1) {
        cursor.setUTCDate(cursor.getUTCDate() - 1)
        const date = cursor.toISOString().slice(0, 10)
        if (activeTradingCalendar().isTradingDay(date)) return date
      }
      return ''
    })() : ''
    const hasPreviousSession = !!previous && previous.date.slice(0, 10) === previousSession
    const isLimitUp = hasPreviousSession
      ? isLimitUpDay(bar, previous.raw?.close ?? previous.close, args.stock.code)
      : null
    const current = bar.date === args.asof
    return buildBoardDayObservation({
      date: bar.date,
      code: args.stock.code,
      name: args.stock.name,
      open: bar.raw?.open ?? bar.open,
      high: bar.raw?.high ?? bar.high,
      low: bar.raw?.low ?? bar.low,
      close: bar.raw?.close ?? bar.close,
      previousClose: previous?.raw?.close ?? previous?.close ?? null,
      volume: bar.volume,
      previousVolume: previous?.volume ?? null,
      amount: bar.turnover,
      turnoverRate: current ? args.stock.turnoverRate : null,
      firstSealTime: current ? args.stock.firstTime || null : null,
      lastSealTime: current ? args.stock.lastTime || null : null,
      reopenCount: current ? args.stock.openCount : null,
      sealAmount: current ? args.stock.sealAmount : null,
      limitPrice: isLimitUp ? (bar.raw?.close ?? bar.close) : null,
      isLimitUp,
      adjustment: bar.adjustment ?? null,
      source: bar.provider ?? 'unknown',
      settled: current ? args.sessionSettled : bar.settled === true,
    })
  })
  return {
    sequence: buildBoardSequenceEvidence({
      code: args.stock.code,
      name: args.stock.name,
      observations,
      signalDate: args.asof,
      declaredBoards: args.stock.consecutiveDays,
    }),
    observations,
  }
}

function buildRelayExpectations(args: {
  stocks: NormalizedStock[]
  technicalResults: Array<[string, TechnicalResult]>
  asof: string
  sessionSettled: boolean
}): Map<string, { sequence: BoardSequenceEvidence; expectation: RelayExpectation; relayPathEvidence: RelayPathEvidence; relayPathScore: RelayPathScore }> {
  const technicalMap = new Map(args.technicalResults)
  const eventArchive = readJson<LimitEventArchive>(join(LADDER_ROOT, 'limit-event-history.json'))
  return new Map(args.stocks.map((stock) => {
    const result = technicalMap.get(stock.code)
    const boardResult = buildBoardSequenceForStock({
      stock,
      rawBars: result?.rawBars ?? [],
      asof: args.asof,
      sessionSettled: args.sessionSettled,
    })
    const eventDays = Object.fromEntries(
      (boardResult.sequence.episodeDates ?? []).map((date) => [
        date,
        aggregateLimitEventDay({
          code: stock.code,
          date,
          events: eventArchive?.events ?? [],
        }),
      ]),
    )
    const relayPathEvidence = buildRelayPathEvidence({
      code: stock.code,
      signalDate: args.asof,
      signalCutoffAt: `${args.asof}T15:10:00+08:00`,
      lane: `${stock.consecutiveDays}进${stock.consecutiveDays + 1}`,
      declaredBoards: stock.consecutiveDays,
      rawBars: result?.rawBars ?? [],
      adjustedBars: result?.bars ?? [],
      observations: boardResult.observations,
      provider: result?.provider ?? 'unknown',
      providerAt: result?.providerAt ?? null,
      receivedAt: result?.receivedAt ?? null,
      sourceRefs: [
        result?.provider ?? 'unknown',
        ...(eventArchive ? ['limit-event-history.json'] : []),
      ],
      eventDays,
      environmentPath: {
        lanePromotionUniverse: null,
        missingReasons: ['统一路径证据暂未接入历史lane完整池'],
      },
    })
    const relayPathScore = stock.consecutiveDays === 1
      ? scoreFirstBoardPath(relayPathEvidence)
      : scoreStreakPath(relayPathEvidence)
    return [stock.code, {
      sequence: boardResult.sequence,
      expectation: buildRelayExpectation(boardResult.sequence),
      relayPathEvidence,
      relayPathScore,
    }]
  }))
}

function maybeArchive(
  analysis: LimitLadderAnalysis,
  evidence: EvidenceArchive,
): boolean {
  const eligibility = canFinalizeLadderArchive(analysis, evidence)
  if (!eligibility.eligible) return false
  const existingPath = latestRevisionedArchivePath(
    analysis.asof,
    LIMIT_LADDER_RULE_VERSION,
    'evidence',
  )
  const existing = existingPath ? readJson<EvidenceArchive>(existingPath) : null
  if (existing && existing.qualityRank >= evidence.qualityRank) return false
  const previousAnalysisPath = latestRevisionedArchivePath(
    analysis.asof,
    LIMIT_LADDER_RULE_VERSION,
    'analysis',
  )
  const revision = existing ? Math.max(1, existing.revision ?? 1) + 1 : 1
  const nextEvidencePath = archiveWritePath(evidencePath(analysis.asof), revision)
  const nextAnalysisPath = archiveWritePath(analysisPath(analysis.asof), revision)
  writeJsonAtomic(nextEvidencePath, {
    ...evidence,
    revision,
    supersedes: existingPath,
  })
  writeJsonAtomic(nextAnalysisPath, {
    ...analysis,
    archived: true,
    revision,
    supersedes: previousAnalysisPath,
  })
  if (analysis.eventGate) {
    writeJsonAtomic(eventGatePath(analysis.asof), analysis.eventGate)
  }
  return true
}

async function computeCurrentAnalysis(asof: string): Promise<LimitLadderAnalysis> {
  const sessionSettled = isLadderSettledWindow()
  const imported = importsByDate.get(asof) ?? null
  const [ashare, sentiment, kplResult] = await Promise.all([
    fetchAShareData(),
    fetchSentiment(),
    fetchKplRealtimeLadder()
      .then((value) => ({ value, error: '' }))
      .catch((error: unknown) => ({
        value: null,
        error: error instanceof Error ? error.message : String(error),
      })),
  ])
  const kplLadder = kplResult.value
  const ashareLimitUpStocks = ashare.limitUpStocks ?? []
  const profileCodes = Array.from(
    new Set([
      ...ashareLimitUpStocks.map((stock) => stock.code),
      ...(kplLadder?.stocks ?? []).map((stock) => stock.code),
      ...(imported?.stocks ?? []).map((stock) => stock.code),
    ]),
  )
  const profiles = await fetchLadderMarketProfiles(profileCodes)
  const merged = mergeStocks(
    ashareLimitUpStocks,
    kplLadder?.stocks ?? [],
    imported,
    profiles,
  )
  if (merged.length === 0) throw new Error('涨停池为空，拒绝生成连板天梯')

  const formalDataUniverse = merged.filter(
    (stock) =>
      mainBoardCode(stock.code) &&
      !/ST|\*ST/i.test(stock.name) &&
      !/^(N|C)/i.test(stock.name),
  )
  const limitFieldsComplete = formalDataUniverse.every(
    (stock) => stock.firstTime && stock.consecutiveDays > 0,
  )
  const observationLimitFieldsMissing = merged.filter(
    (stock) => !stock.firstTime || stock.consecutiveDays <= 0,
  ).length
  const unresolvedKplTiers =
    kplLadder?.missingTiers.filter(
      (tier) => !merged.some((stock) => stock.consecutiveDays === tier),
    ) ?? []
  const source: LadderDataQuality['source'] = imported
    ? ashareLimitUpStocks.length || kplLadder?.stocks.length
      ? 'mixed'
      : 'import'
    : kplLadder?.stocks.length && ashareLimitUpStocks.length
      ? 'mixed'
      : kplLadder?.stocks.length
        ? 'kaipanla'
    : limitFieldsComplete
      ? 'eastmoney'
      : 'sina'
  const maxBoards = Math.max(1, ...merged.map((stock) => stock.consecutiveDays))
  const continuity = levelContinuity(merged)
  const previous = previousArchivedAnalysis(asof)
  const histories = recentArchivedAnalyses(asof, 5)
  const previousMap = new Map(previous?.stocks.map((stock) => [stock.code, stock]) ?? [])
  const derivedPromoted = merged.filter((stock) => {
    const prior = previousMap.get(stock.code)
    return !!prior && stock.consecutiveDays > prior.consecutiveDays
  }).length
  const derivedPromotionRate =
    previous && previous.stocks.length > 0
      ? r2((derivedPromoted / previous.stocks.length) * 100)
      : null
  const marketInput: MarketCycleInput = {
    temperature: sentiment.temperature,
    limitUp: ashare.limitUpCount,
    limitDown: ashare.limitDownCount,
    breakRate: sentiment.breakRate,
    promotionRate: derivedPromotionRate ?? ashare.promotionRate,
    yestLimitPerf: sentiment.yestLimitPerf,
    advance: ashare.advance,
    decline: ashare.decline,
    maxBoards,
    ladderContinuity: r2(continuity * 100),
  }
  const cycle = classifyMarketCycle(
    marketInput,
    previous ? { phase: previous.market.cycle.phase, current: previous.market.cycle.current } : undefined,
  )
  const eventInputs = merged.map((stock) => ({
    code: stock.code,
    name: stock.name,
    consecutiveDays: stock.consecutiveDays,
    primaryTheme: themeNames(stock)[0] ?? '其他',
    themes: themeNames(stock),
    firstTime: stock.firstTime,
    openCount: stock.openCount,
    onePrice: stock.importedOnePrice ?? stock.onePriceHint,
  }))
  const frozenEventGate = readJson<LadderEventGate>(eventGatePath(asof))
  const [themeAnchors, technicalResults, lhbIndex, hotList, eventGate] = await Promise.all([
    buildThemeAnchors(merged, histories, asof),
    mapLimit(merged, 10, async (stock): Promise<[string, TechnicalResult]> => {
      try {
        const [result, rawResult] = await Promise.all([
          fetchStockKline(stock.code, 101, KLINE_COUNT, { adjustment: 'qfq' }),
          fetchStockKline(stock.code, 101, KLINE_COUNT, { adjustment: 'raw' }).catch(() => null),
        ])
        const { klines } = result
        return [
          stock.code,
          {
            evidence: analyzeTechnical(klines, stock.code, asof, sessionSettled),
            bars: klines.filter((bar) => bar.date <= asof),
            rawBars: rawResult?.klines.filter((bar) => bar.date <= asof),
            provider: result.provider,
            adjustment: result.adjustment,
            providerAt: result.providerAt,
            receivedAt: result.receivedAt,
          },
        ]
      } catch {
        return [stock.code, { evidence: emptyTechnical(), bars: [] }]
      }
    }),
    buildLhbIndex([asof], { institutional: true, concurrency: 1 }),
    fetchHotList().catch(() => null),
    frozenEventGate
      ? Promise.resolve(frozenEventGate)
      : fetchLadderEventGate({
          asof,
          stocks: eventInputs,
          knownAt: new Date().toISOString(),
        }).catch(
          (error: unknown): LadderEventGate => ({
            generatedAt: new Date().toISOString(),
            coverage: 0,
            sourceStatus: {},
            events: [],
            hardBlockedCodes: [],
            riskCappedCodes: [],
            themeAdjustments: {},
            marketRisk: 'normal',
            warnings: [
              `消息闸门数据不可用：${error instanceof Error ? error.message : String(error)}`,
            ],
          }),
        ),
  ])
  const themes = applyThemeEventGate(
    scoreThemes(
      merged,
      marketInput.promotionRate,
      previous?.stocks ?? [],
      themeAnchors,
    ),
    eventGate,
  )
  const technicalMap = new Map(technicalResults.map(([code, result]) => [code, result.evidence]))
  const relayExpectations = buildRelayExpectations({
    stocks: merged,
    technicalResults,
    asof,
    sessionSettled,
  })
  const primaryThemeFor = (stock: NormalizedStock) =>
    (stock.themes
      .map((name) => themes.find((theme) => theme.name === name))
      .filter((theme): theme is ThemeAnalysis => !!theme)
      .sort((a, b) => b.score - a.score)[0]?.name ??
      stock.industry) ||
    '其他'
  const roleMap = buildLadderRoleMap({
    stocks: merged.filter((stock) => mainBoardCode(stock.code)).map((stock) => {
      const technical = technicalMap.get(stock.code)
      return {
        code: stock.code,
        name: stock.name,
        consecutiveDays: stock.consecutiveDays,
        primaryTheme: primaryThemeFor(stock),
        themes: stock.themes,
        firstTime: stock.firstTime,
        openCount: stock.openCount,
        onePrice:
          stock.importedOnePrice ??
          (stock.patternHintAvailable ? stock.onePriceHint : technical?.onePrice),
      }
    }),
    histories: histories.map((history) => ({
      asof: history.asof,
      stocks: history.stocks.map((stock) => ({
        code: stock.code,
        consecutiveDays: stock.consecutiveDays,
        primaryTheme: stock.primaryTheme,
        role: stock.role,
        roleProfile: stock.roleProfile,
      })),
    })),
    anchors: themeAnchors.map((anchor) => ({
      code: anchor.code,
      name: anchor.name,
      themes: anchor.themes,
      priorMaxBoards: anchor.priorMaxBoards,
      active: anchor.active,
    })),
  })
  const promotionStatistics = buildPromotionStatistics(
    archivedPromotionObservations(asof),
  )
  const promotionLanes = computePromotionLanes(
    merged,
    themes,
    previous?.stocks ?? [],
    themeAnchors,
    promotionStatistics,
  )
  const lhbForDay = lhbIndex.get(asof) ?? new Map<string, LhbDay>()
  const fundFlowComplete = lhbForDay.size > 0
  const klineComplete = technicalResults.filter(([, result]) => result.evidence.available && result.evidence.settled).length
  const klineProviderAts = technicalResults
    .map(([, result]) => result.providerAt)
    .filter((value): value is string => !!value)
  const klineReceivedAts = technicalResults
    .map(([, result]) => result.receivedAt)
    .filter((value): value is string => !!value)
  const klineAdjustments = Array.from(
    new Set(
      technicalResults
        .map(([, result]) => result.adjustment)
        .filter((value): value is NonNullable<KlineBar['adjustment']> => !!value),
    ),
  )
  const klineMetadataComplete =
    technicalResults.length === merged.length &&
    technicalResults.every(
      ([, result]) =>
        !!result.provider &&
        !!result.providerAt &&
        !!result.receivedAt &&
        !!result.adjustment,
    )
  const qualityProviderAt =
    klineProviderAts.length === technicalResults.length
      ? klineProviderAts.slice().sort().at(-1) ?? null
      : null
  const qualityReceivedAt =
    klineReceivedAts.length === technicalResults.length
      ? klineReceivedAts.slice().sort().at(-1) ?? null
      : null
  const qualityAdjustment =
    klineAdjustments.length === 1 ? klineAdjustments[0] : klineAdjustments.length === 0 ? null : 'unknown'
  const qualityWarnings: string[] = []
  if (kplResult.error) qualityWarnings.push(`开盘啦实时梯队不可用：${kplResult.error}`)
  if (unresolvedKplTiers.length > 0) {
    qualityWarnings.push(`合并东财后仍缺少${unresolvedKplTiers.join('、')}板梯队`)
  }
  if (kplLadder?.date && kplLadder.date !== asof) {
    qualityWarnings.push(`开盘啦梯队日期为${kplLadder.date}，与分析日${asof}不一致`)
  }
  if (!limitFieldsComplete) qualityWarnings.push('涨停池缺少完整板数或封板时间，已降级')
  if (observationLimitFieldsMissing > 0) {
    qualityWarnings.push(
      `${observationLimitFieldsMissing}只非正式候选观察标的缺少封板时间`,
    )
  }
  if (ashare.limitUpStocks == null) qualityWarnings.push('涨停池数据不可用，已依赖其他来源补全')
  if (sentiment.status !== 'full') {
    qualityWarnings.push(`情绪数据状态为${sentiment.status}，拒绝高置信结论和归档`)
  }
  if (klineComplete < merged.length) qualityWarnings.push(`${merged.length - klineComplete}只股票K线不完整`)
  if (!sessionSettled) qualityWarnings.push('交易时段内仅供预览，未完成K线不得生成次日候选')
  if (!fundFlowComplete) qualityWarnings.push('当日龙虎榜席位尚未发布，资金流维度不可用，不取中性分')
  if (!klineMetadataComplete) qualityWarnings.push('K线缺少provider、providerAt、receivedAt或复权口径，禁止高置信归档')
  const floatCapComplete = merged.filter((stock) => stock.circulatingMarketCap != null).length
  if (floatCapComplete < merged.length) {
    qualityWarnings.push(`${merged.length - floatCapComplete}只股票流通市值缺失，容量分按换手率降级`)
  }
  if (!hotList) qualityWarnings.push('热榜数据不可用，人气分按角色、带动与龙虎榜重归一化')
  if (derivedPromotionRate == null) qualityWarnings.push('缺少前日可比归档，晋级层历史晋级率暂缺')
  if (eventGate.coverage < 75) {
    qualityWarnings.push(`消息闸门来源覆盖率${eventGate.coverage.toFixed(1)}%`)
  }
  qualityWarnings.push(...eventGate.warnings)
  const quality: LadderDataQuality = {
    source,
    sourceDate: kplLadder?.date || asof,
    sentimentSource: sentiment.source,
    sentimentStatus: sentiment.status,
    limitFieldsComplete,
    klineComplete,
    klineTotal: merged.length,
    degraded:
      !limitFieldsComplete ||
      sentiment.status !== 'full' ||
      !sessionSettled ||
      unresolvedKplTiers.length > 0 ||
      (!!kplLadder?.date && kplLadder.date !== asof) ||
      !klineMetadataComplete,
    fundFlowComplete,
    providerAt: qualityProviderAt,
    receivedAt: qualityReceivedAt,
    adjustment: qualityAdjustment,
    settled: sessionSettled && klineComplete === merged.length,
    warnings: qualityWarnings,
  }
  const currentMarks = Object.fromEntries(
    merged
      .filter((stock) => mainBoardCode(stock.code))
      .map((stock) => [stock.code, {
        code: stock.code,
        changePct: stock.changePct,
        isLimitUp: true,
      }]),
  )
  const sentimentQuant = buildLadderSentimentQuantSnapshot({
    asof,
    market: {
      limitUpCount: ashare.limitUpCount,
      ladderCount: merged.filter((stock) => mainBoardCode(stock.code) && stock.consecutiveDays >= 2).length,
      previousLadderCount: previous?.stocks.filter((stock) => mainBoardCode(stock.code) && stock.consecutiveDays >= 2).length ?? null,
      // ALimit/limit-down is not the same as all stocks below -5%; keep this
      // unavailable until a complete breadth snapshot is supplied.
      down5Count: null,
      advanceCount: ashare.advance,
      declineCount: ashare.decline,
      flatCount: ashare.flat,
    },
    previousFirstBoards: previous?.stocks
      .filter((stock) => stock.consecutiveDays === 1)
      .map((stock) => ({ code: stock.code, changePct: null, isLimitUp: null })),
    previousLadderBoards: previous?.stocks
      .filter((stock) => mainBoardCode(stock.code) && stock.consecutiveDays >= 2)
      .map((stock) => ({ code: stock.code, changePct: null, isLimitUp: null })),
    currentMarks,
    crowding: null,
    source: 'derived-from-ladder-v6',
    sourceStatus: {
      breadth: 'ok',
      boardOutcomes: previous ? 'degraded' : 'missing',
      down5Count: 'missing',
      crowding: 'missing',
    },
  })
  if (sessionSettled) writeLadderSentimentQuant(sentimentQuant)
  const stocks = rankAndClassifyStocks({
    stocks: merged,
    themes,
    technical: technicalMap,
    market: cycle,
    degraded: quality.degraded,
    lhb: lhbForDay,
    lanes: promotionLanes,
    hotRanks: buildHotRankMap(hotList ?? undefined),
    hotListAvailable: !!hotList && (hotList.eastmoney.length > 0 || hotList.ths.length > 0),
    roleMap,
    eventGate,
    expectations: relayExpectations,
  })
  const levels = Array.from(new Set(stocks.filter((stock) => stock.consecutiveDays >= 2).map((stock) => stock.consecutiveDays)))
    .sort((a, b) => b - a)
    .map((boards) => ({ boards, stocks: stocks.filter((stock) => stock.consecutiveDays === boards) }))
  const warnings = [...qualityWarnings]
  if (!cycle.directionAvailable) warnings.push('缺少前日归档，周期方向不可计算')
  warnings.push(...sentimentQuant.warnings)

  const analysis: LimitLadderAnalysis = {
    asof,
    generatedAt: new Date().toISOString(),
    ruleVersion: LIMIT_LADDER_RULE_VERSION,
    archived: false,
    market: {
      cycle,
      limitUp: ashare.limitUpCount,
      limitDown: ashare.limitDownCount,
      breakRate: sentiment.breakRate,
      promotionRate: marketInput.promotionRate,
      advance: ashare.advance,
      decline: ashare.decline,
      maxBoards,
    },
    sentimentQuant,
    themes,
    promotionLanes,
    promotionStatistics,
    dominantLane: promotionLanes.find((lane) => lane.dominant)?.label ?? null,
    themeAnchors,
    roleMap,
    riskEvents: eventGate.events,
    eventGate,
    levels,
    firstBoards: stocks.filter((stock) => stock.consecutiveDays === 1),
    stocks,
    nextDayCandidates: stocks.filter((stock) => stock.state === 'candidate'),
    quality,
    warnings,
    strategyStatus: 'research',
  }
  const evidence: EvidenceArchive = {
    asof,
    generatedAt: analysis.generatedAt,
    ruleVersion: LIMIT_LADDER_RULE_VERSION,
    qualityRank: qualityRank(quality),
    providerAt: qualityProviderAt,
    receivedAt: qualityReceivedAt,
    adjustment: qualityAdjustment,
    settled: quality.settled,
    ashare: {
      limitUpCount: ashare.limitUpCount,
      limitDownCount: ashare.limitDownCount,
      advance: ashare.advance,
      decline: ashare.decline,
      flat: ashare.flat,
      promotionRate: ashare.promotionRate,
      promotedCount: ashare.promotedCount,
      promotionTotal: ashare.promotionTotal,
    },
    sentiment,
    kplLadder,
    limitUpStocks: ashare.limitUpStocks,
    imported,
    klines: Object.fromEntries(technicalResults.map(([code, result]) => [code, result.bars])),
    rawKlines: technicalResults.reduce<Record<string, KlineBar[]>>((acc, [code, result]) => {
      if (result.rawBars && result.rawBars.length > 0) acc[code] = result.rawBars
      return acc
    }, {}),
    marketProfiles: Object.fromEntries(
      merged.map((stock) => [
        stock.code,
        { circulatingMarketCap: stock.circulatingMarketCap },
      ]),
    ),
    hotList: hotList
      ? { eastmoney: hotList.eastmoney, ths: hotList.ths }
      : undefined,
    promotionLanes,
    themeAnchors,
    roleMap,
    eventGate,
    promotionStatistics,
  }
  await maybeArchivePreviousOutcome(asof, analysis, previous)
  const archived = maybeArchive(analysis, evidence)
  return { ...analysis, archived }
}

export interface AuctionMarketSnapshot {
  topAmount: AuctionMarketStock[]
  topGainers: AuctionMarketStock[]
}

export interface AuctionProcessSnapshot {
  capturedAt: string
  clockTime: string
  quotes: Record<string, ScreenerLiveQuote>
  market: AuctionMarketSnapshot
  sources: string[]
  coverage: number
  warnings: string[]
}

export interface AuctionProcessArchive {
  signalDate: string
  tradeDate: string
  generatedAt: string
  ruleVersion: string
  snapshots: AuctionProcessSnapshot[]
  finalSnapshot: AuctionProcessSnapshot | null
}

interface ConfirmationSnapshot {
  signalDate: string
  tradeDate: string
  capturedAt: string
  ruleVersion: string
  quotes: Record<string, ScreenerLiveQuote>
}

interface HighBoardAuctionArchive {
  signalDate: string
  tradeDate: string
  generatedAt: string
  ruleVersion: string
  auction: HighBoardRiskContext | null
  open: HighBoardRiskContext | null
  eventReaction: LadderEventReaction | null
}

interface LegacyAuctionSnapshot {
  signalDate: string
  tradeDate: string
  capturedAt: string
  quotes: Record<string, ScreenerLiveQuote>
}

interface LegacyLadderOutcomeArchive {
  signalDate: string
  tradeDate: string
  generatedAt: string
  ruleVersion?: string
  rows: Array<{
    code: string
    name: string
    candidateRank: number | null
    fromBoards: number
    promoted: boolean
    tradable: boolean
    openToClosePct: number | null
    mfePct: number | null
    maePct: number | null
  }>
}

function auctionProcessPath(
  signalDate: string,
  version = LIMIT_LADDER_RULE_VERSION,
): string {
  return join(archiveDir(signalDate), `auction-process-${version}.json`)
}

function confirmationSnapshotPath(
  signalDate: string,
  version = LIMIT_LADDER_RULE_VERSION,
): string {
  return join(archiveDir(signalDate), `confirmation-${version}.json`)
}

function legacyAuctionSnapshotPath(signalDate: string, version = 'limit-ladder-v2'): string {
  return join(archiveDir(signalDate), `auction-${version}.json`)
}

function outcomePath(signalDate: string, version = LIMIT_LADDER_RULE_VERSION): string {
  return join(archiveDir(signalDate), `outcome-${version}.json`)
}

function settledNextDayPath(
  signalDate: string,
  version = LIMIT_LADDER_RULE_VERSION,
): string {
  return join(archiveDir(signalDate), `settled-next-day-${version}.json`)
}

function existingSettledNextDayPath(signalDate: string): string | null {
  for (const version of COMPATIBLE_LADDER_RULE_VERSIONS) {
    const path = settledNextDayPath(signalDate, version)
    if (existsSync(path)) return path
  }
  return null
}

function highBoardArchivePath(
  signalDate: string,
  version = LIMIT_LADDER_RULE_VERSION,
): string {
  return join(
    archiveDir(signalDate),
    `high-board-auction-${version}.json`,
  )
}

function existingHighBoardArchivePath(signalDate: string): string | null {
  for (const version of COMPATIBLE_LADDER_RULE_VERSIONS) {
    const path = highBoardArchivePath(signalDate, version)
    if (existsSync(path)) return path
  }
  return null
}

function marketGateArchivePath(
  signalDate: string,
  version = LIMIT_LADDER_RULE_VERSION,
): string {
  return join(archiveDir(signalDate), `market-gate-${version}.json`)
}

function existingOutcomePath(signalDate: string): string | null {
  for (const version of COMPATIBLE_LADDER_RULE_VERSIONS) {
    const path = outcomePath(signalDate, version)
    if (existsSync(path)) return path
  }
  return null
}

function formalCandidateRows(analysis: LimitLadderAnalysis): LadderStockAnalysis[] {
  return analysis.nextDayCandidates ?? analysis.stocks.filter((stock) => stock.state === 'candidate')
}

function waitOpenMonitorRows(analysis: LimitLadderAnalysis): LadderStockAnalysis[] {
  return analysis.stocks
    .filter(
      (stock) =>
        stock.state === 'waiting' &&
        stock.boardType === 'main' &&
        stock.consecutiveDays <= 3 &&
        stock.onePrice &&
        (stock.promotionScore ?? stock.score) >= 65,
    )
    .sort((a, b) => (b.promotionScore ?? b.score) - (a.promotionScore ?? a.score))
    .slice(0, 3)
}

function summarizeOutcomeRows(rows: LadderOutcomeRow[]): LadderPromotionRateSummary {
  const validRows = rows.filter((row) => row.resultStatus !== 'unresolved')
  const promoted = validRows.filter((row) => row.resultStatus === 'promoted').length
  const failed = validRows.length - promoted
  return {
    total: rows.length,
    valid: validRows.length,
    promoted,
    failed,
    unresolved: rows.length - validRows.length,
    promotionRate: validRows.length > 0 ? r2((promoted / validRows.length) * 100) : null,
    coverage: rows.length > 0 ? r2((validRows.length / rows.length) * 100) : 0,
  }
}

export function buildOutcomeSummary(rows: LadderOutcomeRow[]): LadderOutcomeSummary {
  const formal = rows.filter((row) => row.population === 'formal')
  const waitOpen = rows.filter((row) => row.population === 'wait-open')
  const byLane = Array.from(new Set(formal.map((row) => row.fromBoards)))
    .sort((a, b) => a - b)
    .map((fromBoards) => ({
      promotionLane: `${fromBoards}进${fromBoards + 1}`,
      fromBoards,
      ...summarizeOutcomeRows(formal.filter((row) => row.fromBoards === fromBoards)),
    }))
  const byRepairState = Array.from(
    new Set(
      formal
        .map((row) => row.repairState)
        .filter((value): value is MarketRepairState => !!value),
    ),
  ).map((repairState) => ({
    repairState,
    ...summarizeOutcomeRows(
      formal.filter((row) => row.repairState === repairState),
    ),
  }))
  const bySizeBucket = Array.from(
    new Set(
      formal
        .map((row) => row.sizeBucket)
        .filter((value): value is LadderSizeBucket => !!value),
    ),
  ).map((sizeBucket) => ({
    sizeBucket,
    ...summarizeOutcomeRows(
      formal.filter((row) => row.sizeBucket === sizeBucket),
    ),
  }))
  const byHeightTier = Array.from(
    new Set(
      formal
        .map((row) => row.heightTier)
        .filter(
          (
            value,
          ): value is LadderRoleProfile['heightTier'] => !!value,
        ),
    ),
  ).map((heightTier) => ({
    heightTier,
    ...summarizeOutcomeRows(
      formal.filter((row) => row.heightTier === heightTier),
    ),
  }))
  return {
    formal: summarizeOutcomeRows(formal),
    byLane,
    waitOpen: summarizeOutcomeRows(waitOpen),
    byRepairState,
    bySizeBucket,
    byHeightTier,
  }
}

function normalizeOutcomeArchive(
  value: LadderOutcomeArchive | LegacyLadderOutcomeArchive,
  analysis: LimitLadderAnalysis,
): LadderOutcomeArchive {
  if ('summary' in value && value.summary && value.rows.every((row) => 'population' in row)) {
    return value as LadderOutcomeArchive
  }
  const formalCodes = new Set(formalCandidateRows(analysis).map((stock) => stock.code))
  const legacy = value as LegacyLadderOutcomeArchive
  const rows: LadderOutcomeRow[] = legacy.rows.map((row) => {
    const unresolved =
      !row.promoted &&
      !row.tradable &&
      row.openToClosePct == null &&
      row.mfePct == null &&
      row.maePct == null
    const population: LadderOutcomePopulation = formalCodes.has(row.code)
      ? 'formal'
      : 'wait-open'
    return {
      ...row,
      population,
      promotionLane: `${row.fromBoards}进${row.fromBoards + 1}`,
      targetBoards: row.fromBoards + 1,
      resultStatus: unresolved ? 'unresolved' : row.promoted ? 'promoted' : 'failed',
      promoted: unresolved ? null : row.promoted,
      tradable: unresolved ? null : row.tradable,
      unresolvedReason: unresolved ? '旧版结果缺少有效行情，无法区分失败与缺失' : '',
    }
  })
  return {
    signalDate: legacy.signalDate,
    tradeDate: legacy.tradeDate,
    generatedAt: legacy.generatedAt,
    ruleVersion: legacy.ruleVersion ?? 'limit-ladder-v2',
    summary: buildOutcomeSummary(rows),
    rows,
  }
}

function readOutcomeArchive(
  signalDate: string,
  analysis: LimitLadderAnalysis,
): LadderOutcomeArchive | null {
  const path = existingOutcomePath(signalDate)
  const value = path
    ? readJson<LadderOutcomeArchive | LegacyLadderOutcomeArchive>(path)
    : null
  return value ? normalizeOutcomeArchive(value, analysis) : null
}

async function maybeArchivePreviousOutcome(
  tradeDate: string,
  current: LimitLadderAnalysis,
  previous: LimitLadderAnalysis | null,
): Promise<void> {
  if (
    !isLadderOutcomeWindow() ||
    !previous ||
    !!existingOutcomePath(previous.asof)
  ) {
    return
  }
  const formalCodes = new Set(formalCandidateRows(previous).map((stock) => stock.code))
  // Archive the complete lane population, not only formal/wait-open rows.
  // This is the denominator for an unbiased environment prior; the old
  // candidate monitor remains intentionally narrower for live UI monitoring.
  const candidates = previous.stocks.filter(
    (stock) =>
      stock.boardType === 'main' &&
      stock.consecutiveDays >= 1 &&
      stock.consecutiveDays <= 3,
  )
  if (!candidates.length) return
  const currentMap = new Map(current.stocks.map((stock) => [stock.code, stock]))
  const priorHighBoardPath = existingHighBoardArchivePath(previous.asof)
  const highBoardArchive = priorHighBoardPath
    ? readJson<HighBoardAuctionArchive>(priorHighBoardPath)
    : null
  const riskContext = highBoardArchive?.open ?? highBoardArchive?.auction ?? null
  const marketArchive = readMarketGateArchive(previous.asof)
  const marketGate = marketArchive?.open ?? marketArchive?.auction ?? null
  const rows = await mapLimit(candidates, 6, async (stock): Promise<LadderOutcomeRow> => {
    let bar: KlineBar | undefined
    let previousClose: number | null = null
    try {
      const result = await fetchStockKline(stock.code, 101, 12, { adjustment: 'raw' })
      const index = result.klines.findIndex((item) => item.date === tradeDate)
      bar = index >= 0 ? result.klines[index] : undefined
      previousClose = index > 0 ? result.klines[index - 1].close : null
    } catch {
      bar = undefined
    }
    const targetBoards = stock.consecutiveDays + 1
    const ladderPromoted =
      (currentMap.get(stock.code)?.consecutiveDays ?? 0) >= targetBoards
    const klinePromoted =
      !!bar &&
      previousClose != null &&
      isLimitUpDay(bar, previousClose, stock.code)
    const resolved = !!bar || ladderPromoted
    const promoted = resolved ? ladderPromoted || klinePromoted : null
    // A daily bar cannot prove that a next-day order joined the queue or
    // obtained a fill. Keep promotion and the open/close mark, but never turn
    // a non-one-price daily bar into a tradable fill by default.
    const tradable: boolean | null = null
    const resultStatus: LadderOutcomeStatus =
      promoted == null ? 'unresolved' : promoted ? 'promoted' : 'failed'
    const themeRisk = riskContext?.themes.find(
      (theme) => theme.theme === stock.primaryTheme,
    )
    const themePermission =
      marketGate?.themePermissions.find(
        (permission) => permission.theme === stock.primaryTheme,
      ) ?? null
    const liquidityStyle = scoreLiquidityStyleGate({
      circulatingMarketCap: stock.circulatingMarketCap,
      heightTier: stock.roleProfile?.heightTier,
      boards: stock.consecutiveDays,
      themePermission,
      highBoardState: riskContext?.state ?? null,
      repairContext: marketGate?.repairContext ?? null,
    })
    return {
      code: stock.code,
      name: stock.name,
      candidateRank: stock.candidateRank ?? null,
      population: formalCodes.has(stock.code) ? 'formal' : 'wait-open',
      promotionLane:
        stock.promotionLane ?? `${stock.consecutiveDays}进${stock.consecutiveDays + 1}`,
      fromBoards: stock.consecutiveDays,
      targetBoards,
      resultStatus,
      promoted,
      tradable,
      unresolvedReason: resolved ? (bar ? '缺少逐笔/分钟盘口，无法证明成交' : '') : '次日K线与连板结果均缺失',
      nextDayOpenToCloseMark: bar && bar.open > 0 ? r2(((bar.close - bar.open) / bar.open) * 100) : null,
      markPositive: bar && bar.open > 0 ? bar.close > bar.open : null,
      realizedNetReturnPct: null,
      openToClosePct: bar && bar.open > 0 ? r2(((bar.close - bar.open) / bar.open) * 100) : null,
      mfePct: bar && bar.open > 0 ? r2(((bar.high - bar.open) / bar.open) * 100) : null,
      maePct: bar && bar.open > 0 ? r2(((bar.low - bar.open) / bar.open) * 100) : null,
      marketCycle: previous.market.cycle.phase,
      marketRole: stock.roleProfile?.marketRole,
      themeState: themeRisk?.state ?? stock.themeGrade,
      riskAppetiteState: riskContext?.state ?? null,
      eventStatus: stock.eventGate ?? 'none',
      marketGateState: marketGate?.state ?? null,
      themePermissionState:
        themePermission?.state ?? null,
      externalRiskScore: marketGate?.externalRiskScore ?? null,
      domesticRiskScore: marketGate?.domesticRiskScore ?? null,
      repairState: marketGate?.repairContext?.state ?? null,
      sizeBucket: liquidityStyle.sizeBucket,
      heightTier:
        stock.roleProfile?.heightTier ??
        (stock.consecutiveDays >= 3
          ? 'high'
          : stock.consecutiveDays === 2
            ? 'middle'
            : 'low'),
      liquidityStyleAdjustment: liquidityStyle.adjustment,
      gateReasons: [
        ...(stock.gateReasons ?? []),
        ...(themePermission?.reasons ?? []),
        ...liquidityStyle.reasons,
      ],
      fullLanePool: true,
      hardEligible: stock.hardEligible ?? stock.state === 'candidate',
      quotaSelected: stock.quotaSelected ?? formalCodes.has(stock.code),
      confirmed: null,
      filled: null,
    }
  })
  const summary = buildOutcomeSummary(rows)
  writeJsonAtomic(outcomePath(previous.asof), {
    signalDate: previous.asof,
    tradeDate,
    generatedAt: new Date().toISOString(),
    ruleVersion: LIMIT_LADDER_RULE_VERSION,
    summary,
    rows,
  } satisfies LadderOutcomeArchive)
}

async function fetchCandidateQuotes(codes: string[]): Promise<Map<string, ScreenerLiveQuote>> {
  const [tencent, sina] = await Promise.all([
    fetchTencentBatchQuotes(codes).catch(() => []),
    fetchSinaBatchQuotes(codes).catch(() => []),
  ])
  const out = new Map<string, ScreenerLiveQuote>()
  for (const quote of sina) out.set(quote.code, quote)
  for (const quote of tencent) {
    const book = out.get(quote.code)
    out.set(quote.code, {
      ...quote,
      indicativePrice: quote.indicativePrice ?? book?.indicativePrice ?? null,
      matchedAmount: quote.matchedAmount ?? book?.matchedAmount ?? null,
      bid1Price: quote.bid1Price ?? book?.bid1Price ?? null,
      bid1Volume: quote.bid1Volume ?? book?.bid1Volume ?? null,
      ask1Price: quote.ask1Price ?? book?.ask1Price ?? null,
      ask1Volume: quote.ask1Volume ?? book?.ask1Volume ?? null,
      unmatchedSide: quote.unmatchedSide ?? book?.unmatchedSide ?? null,
      unmatchedAmount: quote.unmatchedAmount ?? book?.unmatchedAmount ?? null,
    })
  }
  return out
}

function openingBandScore(gap: number, boards: number): number {
  const lower = boards >= 3 ? 0 : 1
  const upper = boards === 1 ? 5 : boards === 2 ? 6 : 5
  if (gap >= lower && gap <= upper) return 100
  if (gap < lower) return clamp(100 - (lower - gap) * 20)
  return clamp(100 - (gap - upper) * 30)
}

export const OPENING_DIRECT_PULL_UP_MIN_PCT = 0.5
/** 平开工程带宽：竞价终局在±0.5%内，默认按脆弱开盘处理。 */
export const OPENING_FLAT_MAX_GAP_PCT = 0.5
/** 低开/平开基础扣分，只有开盘量价翻红后才解除确认闸门。 */
export const OPENING_GAP_PENALTY = -6
/** 竞价终局最后5秒相对前段继续强化且买方未匹配时的加分。 */
export const AUCTION_TAIL_BUY_BONUS = 3
export const AUCTION_TAIL_MIN_STRENGTHENING_PCT = 0.2
const OPENING_REBOUND_MIN_PCT = 0.1
const AUCTION_TAIL_START_SECONDS = 9 * 3_600 + 24 * 60 + 55
const AUCTION_TAIL_END_SECONDS = 9 * 3_600 + 25 * 60
const OPENING_MINUTE_TIMESTAMP_TOLERANCE_SECONDS = 5

/**
 * 免费报价源没有稳定的1分钟OHLC时，用09:35分钟内的快照代理直拉K：
 * 价格在开盘价上方至少0.5%。允许数据源最多5秒的时间戳滞后；这是工程默认阈值，
 * 不等同于完整分钟K回放。
 */
export function isOpeningDirectPullUp(quote: ScreenerLiveQuote): boolean {
  const seconds = quoteSecond(quote.quoteTime)
  if (
    seconds == null ||
    seconds < 9 * 3_600 + 35 * 60 - OPENING_MINUTE_TIMESTAMP_TOLERANCE_SECONDS ||
    seconds >= 9 * 3_600 + 36 * 60 ||
    !(quote.open > 0 && quote.price > 0)
  ) {
    return false
  }
  const risePct = ((quote.price - quote.open) / quote.open) * 100
  return risePct >= OPENING_DIRECT_PULL_UP_MIN_PCT && quote.high >= quote.price
}

/**
 * 09:35快照对“低开/平开后迅速翻红、量价齐升”的可计算代理：
 * 现价须同时站上昨收、开盘价和成交VWAP，且成交量/成交额已出现。
 * 免费源没有稳定的逐分钟量柱，因此这是工程代理，不等同于完整1分钟K量价回放。
 */
export function isOpeningVolumePriceRebound(quote: ScreenerLiveQuote): boolean {
  const seconds = quoteSecond(quote.quoteTime)
  if (
    seconds == null ||
    seconds < 9 * 3_600 + 35 * 60 - OPENING_MINUTE_TIMESTAMP_TOLERANCE_SECONDS ||
    seconds >= 9 * 3_600 + 36 * 60 ||
    !(quote.prevClose > 0 && quote.open > 0 && quote.price > 0) ||
    quote.amount <= 0 ||
    quote.volume <= 0
  ) {
    return false
  }
  const reboundPct = ((quote.price - quote.prevClose) / quote.prevClose) * 100
  const vwap = quoteVwap(quote)
  const volumeRatioSupported = quote.volumeRatio == null || quote.volumeRatio >= 1
  return (
    reboundPct >= OPENING_REBOUND_MIN_PCT &&
    quote.changePct > 0 &&
    quote.price > quote.open &&
    (vwap == null || quote.price >= vwap) &&
    volumeRatioSupported &&
    quote.high >= quote.price
  )
}

/**
 * 用竞价终值与竞价前段的价差变化，叠加最后5秒买方未匹配，代理“9:24翘尾抢筹”。
 * 没有过程快照时退化为终值为正且买方未匹配；该退化路径会保守地只加分，不单独放行。
 */
export function isAuctionTailBuy(
  quote: ScreenerLiveQuote | undefined,
  process?: Pick<AuctionCandidateProcess, 'startGapPct' | 'finalGapPct'> & {
    finalUnmatchedSide?: ScreenerLiveQuote['unmatchedSide']
  },
): boolean {
  if (!quote) return false
  const seconds = quoteSecond(quote.quoteTime)
  if (
    seconds == null ||
    seconds < AUCTION_TAIL_START_SECONDS ||
    seconds > AUCTION_TAIL_END_SECONDS
  ) {
    return false
  }
  const finalGapPct = process?.finalGapPct ?? auctionGapPct(quote)
  const strengthened =
    process?.startGapPct != null && finalGapPct != null
      ? finalGapPct >= process.startGapPct + AUCTION_TAIL_MIN_STRENGTHENING_PCT
      : finalGapPct != null && finalGapPct > 0
  const unmatchedSide = quote.unmatchedSide ?? process?.finalUnmatchedSide
  const buyPressure =
    unmatchedSide === 'buy' &&
    (quote.unmatchedAmount == null || quote.unmatchedAmount > 0)
  const bookBuyPressure =
    quote.bid1Volume != null &&
    quote.ask1Volume != null &&
    quote.bid1Volume > quote.ask1Volume
  return strengthened && (buyPressure || bookBuyPressure)
}

function computeOpeningGapAdjustment(gap: number | null): number {
  if (gap == null || gap > OPENING_FLAT_MAX_GAP_PCT) return 0
  return OPENING_GAP_PENALTY
}

function quoteVwap(quote: ScreenerLiveQuote): number | null {
  if (quote.amount <= 0 || quote.volume <= 0) return null
  return quote.amount / (quote.volume * 100)
}

function isContinuedOnePrice(quote: ScreenerLiveQuote): boolean {
  return (
    quote.prevClose > 0 &&
    quote.changePct >= 9.5 &&
    Math.abs(quote.high - quote.low) < 0.005
  )
}

function candidateMonitorRows(analysis: LimitLadderAnalysis): LadderStockAnalysis[] {
  const formal = formalCandidateRows(analysis)
  const waitOpen = waitOpenMonitorRows(analysis)
  return Array.from(new Map([...formal, ...waitOpen].map((stock) => [stock.code, stock])).values())
}

function quoteSecond(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3] ?? 0)
  return hours <= 23 && minutes <= 59 && seconds <= 59
    ? hours * 3_600 + minutes * 60 + seconds
    : null
}

function currentNextDayQuote(
  quote: ScreenerLiveQuote,
  tradeDate: string,
  stage: 'auction' | 'open',
): boolean {
  const seconds = quoteSecond(quote.quoteTime)
  const [minimum, maximum] =
    stage === 'open'
      ? [9 * 3_600 + 34 * 60, 9 * 3_600 + 36 * 60 + 59]
      : [9 * 3_600 + 15 * 60, 9 * 3_600 + 26 * 60 + 59]
  return (
    quote.tradeDate === tradeDate &&
    seconds != null &&
    seconds >= minimum &&
    seconds <= maximum
  )
}

function nullableWeighted(
  values: Array<{ value: number | null | undefined; weight: number }>,
): number | null {
  return values.some((item) => typeof item.value === 'number' && Number.isFinite(item.value))
    ? weightedAvailable(values)
    : null
}

function auctionGapPct(quote?: ScreenerLiveQuote): number | null {
  if (!quote || quote.prevClose <= 0) return null
  const price = quote.indicativePrice ?? quote.price ?? quote.open
  return price > 0 ? r2(((price - quote.prevClose) / quote.prevClose) * 100) : null
}

function classifyAuctionStyle(text: string, marketCap: number | null): AuctionStyle {
  const value = text.toLowerCase()
  if (/科技|人工智能|ai|算力|芯片|半导体|机器人|软件|通信|电子|光模块|cpo|计算机/.test(value)) {
    return 'technology'
  }
  if (/消费|食品|饮料|零售|旅游|白酒|乳业|商业|家电|服装/.test(value)) {
    return 'consumer'
  }
  if (/医药|医疗|生物|创新药|中药|制药/.test(value)) return 'medicine'
  if (/银行|证券|保险|金融|多元金融/.test(value)) return 'finance'
  if (/有色|煤炭|钢铁|化工|资源|石油|稀土/.test(value)) return 'cyclical'
  if (marketCap != null && marketCap < 10_000_000_000) return 'small-cap'
  return 'mixed'
}

export function classifyLadderSizeBucket(
  circulatingMarketCap: number | null | undefined,
): LadderSizeBucket {
  if (
    circulatingMarketCap == null ||
    !Number.isFinite(circulatingMarketCap) ||
    circulatingMarketCap <= 0
  ) {
    return 'unknown'
  }
  if (circulatingMarketCap < 10_000_000_000) return 'small'
  if (circulatingMarketCap < 50_000_000_000) return 'mid'
  return 'large'
}

function styleLabel(style: AuctionStyle): string {
  return {
    technology: '科技',
    consumer: '消费',
    medicine: '医药',
    finance: '金融',
    cyclical: '周期',
    'small-cap': '小票',
    mixed: '分散',
  }[style]
}

function auctionDateTimeFromEpoch(value: unknown): {
  tradeDate: string
  quoteTime: string
} {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return { tradeDate: '', quoteTime: '' }
  const shifted = new Date(seconds * 1000 + 8 * 3_600_000).toISOString()
  return { tradeDate: shifted.slice(0, 10), quoteTime: shifted.slice(11, 19) }
}

function parseAuctionMarketStock(row: Record<string, unknown>): AuctionMarketStock | null {
  const code = normalizeCode(row.f12)
  const name = String(row.f14 ?? '').trim()
  const price = Number(row.f2)
  if (!/^\d{6}$/.test(code) || !name || !Number.isFinite(price) || price <= 0) return null
  const marketCapValue = Number(row.f20)
  const marketCap =
    Number.isFinite(marketCapValue) && marketCapValue > 0 ? marketCapValue : null
  const industry = String(row.f100 ?? '').trim()
  const { tradeDate, quoteTime } = auctionDateTimeFromEpoch(row.f124)
  return {
    code,
    name,
    industry,
    style: classifyAuctionStyle(`${industry} ${name}`, marketCap),
    price,
    changePct: Number(row.f3) || 0,
    amount: Number(row.f6) || 0,
    marketCap,
    tradeDate,
    quoteTime,
    source: 'eastmoney',
  }
}

async function fetchAuctionMarketList(
  fid: 'f6' | 'f3',
  tradeDate: string,
): Promise<AuctionMarketStock[]> {
  const hosts = ['push2.eastmoney.com', '82.push2.eastmoney.com', 'push2delay.eastmoney.com']
  for (const host of hosts) {
    try {
      const url =
        `https://${host}/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2` +
        `&fid=${fid}&fs=${encodeURIComponent(SCREENER.CLIST_FS)}` +
        '&fields=f2,f3,f6,f12,f14,f20,f100,f124'
      const response = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 6_000 })
      if (!response.ok) continue
      const json = (await response.json()) as {
        data?: { diff?: Record<string, unknown>[] }
      }
      const rows = (json.data?.diff ?? [])
        .map(parseAuctionMarketStock)
        .filter((row): row is AuctionMarketStock => !!row)
        .filter((row) => {
          const seconds = quoteSecond(row.quoteTime)
          return (
            row.tradeDate === tradeDate &&
            seconds != null &&
            seconds >= 9 * 3_600 + 15 * 60 &&
            seconds <= 9 * 3_600 + 26 * 60 + 59
          )
        })
      if (rows.length > 0) return rows
    } catch {
      // Continue through the real-time and delayed mirrors.
    }
  }
  return []
}

async function fetchAuctionMarketSnapshot(tradeDate: string): Promise<AuctionMarketSnapshot> {
  const [topAmount, topGainers] = await Promise.all([
    fetchAuctionMarketList('f6', tradeDate),
    fetchAuctionMarketList('f3', tradeDate),
  ])
  return { topAmount, topGainers }
}

export function classifyAuctionMarket(
  topAmount: AuctionMarketStock[],
): AuctionMarketStyle | null {
  const topFive = topAmount.filter((row) => row.amount > 0).slice(0, 5)
  if (!topFive.length) return null
  const counts = new Map<AuctionStyle, number>()
  for (const row of topFive) counts.set(row.style, (counts.get(row.style) ?? 0) + 1)
  const [style, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [
    'mixed' as AuctionStyle,
    0,
  ]
  const concentration = r2((count / topFive.length) * 100)
  const weightedCount = topFive.filter(
    (row) => row.marketCap != null && row.marketCap >= 50_000_000_000,
  ).length
  const weightedSharePct = r2((weightedCount / topFive.length) * 100)
  const topTwenty = topAmount
    .filter((row) => row.amount > 0)
    .slice(0, 20)
  const topTwentyAmount = topTwenty.reduce(
    (sum, row) => sum + row.amount,
    0,
  )
  const largeCapAmount = topTwenty
    .filter(
      (row) =>
        row.marketCap != null &&
        row.marketCap >= 50_000_000_000,
    )
    .reduce((sum, row) => sum + row.amount, 0)
  const largeCapAmountSharePct =
    topTwentyAmount > 0
      ? r2((largeCapAmount / topTwentyAmount) * 100)
      : null
  const score = clamp(50 + (concentration - 40) * 0.5)
  const dominant = style !== 'mixed' && concentration >= 60
  const label = dominant
    ? weightedSharePct >= 60
      ? `权重${styleLabel(style)}回流`
      : `${styleLabel(style)}竞价占优`
    : '竞价方向分散'
  return {
    style: dominant ? style : 'mixed',
    label,
    score: r2(score),
    confidence: r2(Math.min(100, topFive.length * 20)),
    topFiveConcentrationPct: concentration,
    weightedSharePct,
    largeCapAmountSharePct,
    evidence: [
      `成交额前五${styleLabel(style)}占${count}只`,
      `权重股占${weightedCount}只`,
      ...(largeCapAmountSharePct == null
        ? []
        : [`成交额前20大市值占${largeCapAmountSharePct.toFixed(1)}%`]),
      '该信号只作市场风格证据，不单独确认题材主线',
    ],
  }
}

function processForCandidate(
  code: string,
  snapshots: AuctionProcessSnapshot[],
): AuctionCandidateProcess {
  const rows = snapshots
    .map((snapshot) => ({ snapshot, quote: snapshot.quotes[code] }))
    .filter(
      (row): row is { snapshot: AuctionProcessSnapshot; quote: ScreenerLiveQuote } =>
        !!row.quote,
    )
    .sort((a, b) => a.snapshot.clockTime.localeCompare(b.snapshot.clockTime))
  const postCancel = rows.filter((row) => row.snapshot.clockTime >= '09:20:00')
  const first = postCancel[0] ?? rows[0]
  const final = rows.at(-1)
  const startGapPct = auctionGapPct(first?.quote)
  const finalGapPct = auctionGapPct(final?.quote)
  const strengtheningScore =
    startGapPct == null || finalGapPct == null
      ? null
      : clamp(
          50 +
            (finalGapPct - startGapPct) * 15 +
            (final?.quote.unmatchedSide === 'buy'
              ? 10
              : final?.quote.unmatchedSide === 'sell'
                ? -10
                : 0),
        )
  const preCancelQueue = rows
    .filter((row) => row.snapshot.clockTime < '09:20:00')
    .map((row) =>
      row.quote.unmatchedSide === 'buy' ? (row.quote.unmatchedAmount ?? null) : null,
    )
    .filter((value): value is number => value != null && value > 0)
  const postCancelQueue =
    first?.quote.unmatchedSide === 'buy' ? (first.quote.unmatchedAmount ?? null) : null
  const preCancelMax = preCancelQueue.length > 0 ? Math.max(...preCancelQueue) : null
  const cancellationStabilityScore =
    preCancelMax != null && postCancelQueue != null
      ? clamp((postCancelQueue / preCancelMax) * 100)
      : null
  return {
    code,
    sampleCount: rows.length,
    strengtheningScore: strengtheningScore == null ? null : r2(strengtheningScore),
    cancellationStabilityScore:
      cancellationStabilityScore == null ? null : r2(cancellationStabilityScore),
    processScore: nullableWeighted([
      { value: strengtheningScore, weight: 0.6 },
      { value: cancellationStabilityScore, weight: 0.4 },
    ]),
    startGapPct,
    finalGapPct,
    finalUnmatchedSide: final?.quote.unmatchedSide ?? null,
  }
}

function themeDirections(
  analysisRows: LadderStockAnalysis[],
  formalRows: LadderStockAnalysis[],
  finalQuotes: Record<string, ScreenerLiveQuote>,
): AuctionThemeDirection[] {
  const themes = Array.from(new Set(formalRows.map((stock) => stock.primaryTheme)))
  const totalAmount = Object.values(finalQuotes).reduce(
    (sum, quote) => sum + Math.max(0, quote.matchedAmount ?? quote.amount),
    0,
  )
  return themes
    .map((theme): AuctionThemeDirection => {
      const members = analysisRows.filter(
        (stock) => stock.primaryTheme === theme || stock.themes.includes(theme),
      )
      const quoted = members
        .map((stock) => ({ stock, quote: finalQuotes[stock.code] }))
        .filter(
          (row): row is { stock: LadderStockAnalysis; quote: ScreenerLiveQuote } =>
            !!row.quote,
        )
      if (!quoted.length) {
        return {
          theme,
          score: null,
          state: 'unavailable',
          positiveRate: null,
          weightedGapPct: null,
          amountSharePct: null,
          coreCode: null,
          coreName: '',
          coreOnePrice: false,
          assistantCodes: [],
          assistantCount: 0,
          coverage: 0,
        }
      }
      const values = quoted.map((row) => ({
        ...row,
        gap: auctionGapPct(row.quote) ?? row.quote.changePct,
        amount: Math.max(0, row.quote.matchedAmount ?? row.quote.amount),
      }))
      const positive = values.filter((row) => row.gap > 0)
      const positiveRate = r2((positive.length / values.length) * 100)
      const themeAmount = values.reduce((sum, row) => sum + row.amount, 0)
      const weightedGapPct =
        themeAmount > 0
          ? r2(values.reduce((sum, row) => sum + row.gap * row.amount, 0) / themeAmount)
          : r2(mean(values.map((row) => row.gap)))
      const amountSharePct = totalAmount > 0 ? r2((themeAmount / totalAmount) * 100) : null
      const core = [...values].sort(
        (a, b) =>
          Number(b.gap >= 9.5) - Number(a.gap >= 9.5) ||
          b.stock.consecutiveDays - a.stock.consecutiveDays ||
          (b.stock.promotionScore ?? b.stock.score) -
            (a.stock.promotionScore ?? a.stock.score),
      )[0]
      const coreOnePrice = core.gap >= 9.5
      const assistants = values.filter(
        (row) => row.stock.code !== core.stock.code && row.gap >= 1,
      )
      let score = weightedAvailable([
        { value: positiveRate, weight: 0.3 },
        { value: clamp(50 + weightedGapPct * 10), weight: 0.2 },
        {
          value: amountSharePct == null ? null : normalizePercent(amountSharePct, 25),
          weight: 0.2,
        },
        { value: coreOnePrice ? 100 : clamp(50 + core.gap * 8), weight: 0.2 },
        { value: normalizePercent(assistants.length, 3), weight: 0.1 },
      ])
      let state: AuctionThemeDirection['state']
      if (coreOnePrice && assistants.length >= 2) state = 'leading'
      else if (coreOnePrice) {
        state = 'isolated-one-price'
        score = Math.min(score, 60)
      } else if (score >= 65 && positive.length >= 2) state = 'resonant'
      else state = 'weak'
      return {
        theme,
        score: r2(score),
        state,
        positiveRate,
        weightedGapPct,
        amountSharePct,
        coreCode: core.stock.code,
        coreName: core.stock.name,
        coreOnePrice,
        assistantCodes: assistants.map((row) => row.stock.code),
        assistantCount: assistants.length,
        coverage: r2((quoted.length / Math.max(members.length, 1)) * 100),
      }
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
}

export function buildAuctionContext(args: {
  process: AuctionProcessArchive | null
  analysisRows: LadderStockAnalysis[]
  formalRows: LadderStockAnalysis[]
}): LadderAuctionContext | null {
  const snapshots = args.process?.snapshots ?? []
  const final = args.process?.finalSnapshot ?? snapshots.at(-1)
  if (!final) return null
  const candidateProcesses = candidateMonitorRows({
    stocks: args.analysisRows,
    nextDayCandidates: args.formalRows,
  } as LimitLadderAnalysis).map((stock) => processForCandidate(stock.code, snapshots))
  const themes = themeDirections(args.analysisRows, args.formalRows, final.quotes)
  const warnings = [...final.warnings]
  if (snapshots.length < 3) warnings.push('竞价过程样本少于3个，仅保留终值证据')
  if (final.coverage < 80) warnings.push(`竞价报价覆盖率${final.coverage.toFixed(1)}%`)
  return {
    capturedAt: final.capturedAt,
    snapshotCount: snapshots.length,
    coverage: final.coverage,
    lowConfidence: snapshots.length < 3 || final.coverage < 80,
    sources: Array.from(new Set(snapshots.flatMap((snapshot) => snapshot.sources))),
    marketStyle: classifyAuctionMarket(final.market.topAmount),
    // Keep a wider ranked universe for independent overnight-news mapping;
    // the rendered brief still shows only its concise top five.
    topAmount: final.market.topAmount.slice(0, 30),
    themes,
    candidateProcesses,
    warnings,
  }
}

function auctionComparisonRows(analysis: LimitLadderAnalysis): LadderStockAnalysis[] {
  const monitored = candidateMonitorRows(analysis)
  const candidateThemes = new Set(formalCandidateRows(analysis).map((stock) => stock.primaryTheme))
  const highBoardCodes = new Set(
    (analysis.roleMap?.profiles ?? [])
      .filter(
        (profile) =>
          profile.marketRole !== 'normal' ||
          profile.heightTier === 'high' ||
          profile.boards >= 3,
      )
      .map((profile) => profile.code),
  )
  const related = analysis.stocks.filter(
    (stock) =>
      stock.boardType === 'main' &&
      (highBoardCodes.has(stock.code) ||
        (stock.consecutiveDays <= 3 &&
          (candidateThemes.has(stock.primaryTheme) ||
            stock.themes.some((theme) => candidateThemes.has(theme))))),
  )
  return Array.from(new Map([...monitored, ...related].map((stock) => [stock.code, stock])).values())
}

function auctionCaptureCodes(analysis: LimitLadderAnalysis): string[] {
  return Array.from(
    new Set([
      ...auctionComparisonRows(analysis).map((stock) => stock.code),
      ...(analysis.roleMap?.brokenAnchors ?? []).map((profile) => profile.code),
    ]),
  )
}

function shanghaiTime(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.hour}:${values.minute}:${values.second}`
}

async function captureAuctionProcess(
  analysis: LimitLadderAnalysis,
  tradeDate: string,
): Promise<AuctionProcessArchive | null> {
  const path = auctionProcessPath(analysis.asof, analysis.ruleVersion)
  const existing = readJson<AuctionProcessArchive>(path)
  const now = shanghaiTime()
  const finalWindow = now >= '09:25:00' && now <= '09:26:59'
  if (existing?.finalSnapshot && finalWindow) return existing
  const captureCodes = auctionCaptureCodes(analysis)
  const [rawQuotes, market] = await Promise.all([
    fetchCandidateQuotes(captureCodes),
    fetchAuctionMarketSnapshot(tradeDate).catch(() => ({ topAmount: [], topGainers: [] })),
  ])
  const quotes = new Map(
    [...rawQuotes].filter(
      ([, quote]) => quote.tradeDate === tradeDate && currentNextDayQuote(quote, tradeDate, 'auction'),
    ),
  )
  if (!quotes.size && !market.topAmount.length && !market.topGainers.length) return existing
  const sources: string[] = Array.from(
    new Set([...quotes.values()].map((quote) => quote.source as string)),
  )
  if (analysis.quality.source === 'kaipanla' || analysis.quality.source === 'mixed') {
    sources.push('kaipanla-analysis')
  }
  const warnings: string[] = []
  const coverage =
    captureCodes.length > 0 ? r2((quotes.size / captureCodes.length) * 100) : 0
  if (!market.topAmount.length) warnings.push('东财全市场竞价成交额榜缺失')
  if (!market.topGainers.length) warnings.push('东财全市场竞价涨幅榜缺失')
  const snapshot: AuctionProcessSnapshot = {
    capturedAt: new Date().toISOString(),
    clockTime: now,
    quotes: Object.fromEntries(quotes),
    market,
    sources: Array.from(new Set(sources)),
    coverage,
    warnings,
  }
  const priorSnapshots = existing?.tradeDate === tradeDate ? existing.snapshots : []
  const last = priorSnapshots.at(-1)
  const shouldAppend =
    !last ||
    Math.abs((quoteSecond(now) ?? 0) - (quoteSecond(last.clockTime) ?? 0)) >= 10
  const snapshots = shouldAppend ? [...priorSnapshots, snapshot].slice(-50) : priorSnapshots
  const archive: AuctionProcessArchive = {
    signalDate: analysis.asof,
    tradeDate,
    generatedAt: new Date().toISOString(),
    ruleVersion: analysis.ruleVersion,
    snapshots,
    finalSnapshot:
      existing?.tradeDate === tradeDate && existing.finalSnapshot
        ? existing.finalSnapshot
        : finalWindow
          ? snapshot
          : null,
  }
  writeJsonAtomic(path, archive)
  return archive
}

async function captureConfirmationSnapshot(
  analysis: LimitLadderAnalysis,
  tradeDate: string,
): Promise<ConfirmationSnapshot | null> {
  const path = confirmationSnapshotPath(analysis.asof, analysis.ruleVersion)
  const existing = readJson<ConfirmationSnapshot>(path)
  if (existing?.tradeDate === tradeDate) return existing
  const raw = await fetchCandidateQuotes(auctionCaptureCodes(analysis))
  const quotes = new Map(
    [...raw].filter(([, quote]) => currentNextDayQuote(quote, tradeDate, 'open')),
  )
  if (!quotes.size) return null
  const snapshot: ConfirmationSnapshot = {
    signalDate: analysis.asof,
    tradeDate,
    capturedAt: new Date().toISOString(),
    ruleVersion: analysis.ruleVersion,
    quotes: Object.fromEntries(quotes),
  }
  writeJsonAtomic(path, snapshot)
  return snapshot
}

function highBoardContextsFromSnapshots(args: {
  analysis: LimitLadderAnalysis
  tradeDate: string
  process?: AuctionProcessArchive | null
  confirmation?: ConfirmationSnapshot | null
  archive?: boolean
}): HighBoardAuctionArchive | null {
  const roleMap = args.analysis.roleMap
  const finalSnapshot =
    args.process?.tradeDate === args.tradeDate ? args.process.finalSnapshot : null
  if (!roleMap || !finalSnapshot) return null
  const profileCodes = [
    ...roleMap.profiles.map((profile) => profile.code),
    ...roleMap.brokenAnchors.map((profile) => profile.code),
  ]
  const processScores = Object.fromEntries(
    profileCodes.map((code) => [
      code,
      processForCandidate(code, args.process?.snapshots ?? []).processScore,
    ]),
  )
  const reactionQuotes =
    args.confirmation?.tradeDate === args.tradeDate
      ? args.confirmation.quotes
      : finalSnapshot.quotes
  const eventReaction = buildEventReaction({
    gate: args.analysis.eventGate,
    quotes: reactionQuotes,
  })
  const auction = applyEventReactionToRiskContext(
    buildHighBoardRiskContext({
      roleMap,
      auctionQuotes: finalSnapshot.quotes,
      processScores,
      capturedAt: finalSnapshot.capturedAt,
    }),
    args.analysis.eventGate,
    eventReaction,
  )
  const open =
    args.confirmation?.tradeDate === args.tradeDate
      ? applyEventReactionToRiskContext(
          buildHighBoardRiskContext({
            roleMap,
            auctionQuotes: finalSnapshot.quotes,
            liveQuotes: args.confirmation.quotes,
            processScores,
            capturedAt: args.confirmation.capturedAt,
          }),
          args.analysis.eventGate,
          eventReaction,
        )
      : null
  const archive: HighBoardAuctionArchive = {
    signalDate: args.analysis.asof,
    tradeDate: args.tradeDate,
    generatedAt: new Date().toISOString(),
    ruleVersion: LIMIT_LADDER_RULE_VERSION,
    auction,
    open,
    eventReaction,
  }
  if (args.archive && args.analysis.ruleVersion === LIMIT_LADDER_RULE_VERSION) {
    writeJsonAtomic(highBoardArchivePath(args.analysis.asof), archive)
  }
  return archive
}

function marketGateThemes(analysis: LimitLadderAnalysis): string[] {
  return Array.from(
    new Set(
      formalCandidateRows(analysis).flatMap((stock) => [
        stock.primaryTheme,
        ...stock.themes,
      ]),
    ),
  ).filter(Boolean)
}

function readMarketGateArchive(signalDate: string): MarketGateArchive | null {
  return readJson<MarketGateArchive>(marketGateArchivePath(signalDate))
}

async function capturePremarketMarketRisk(args: {
  analysis: LimitLadderAnalysis
  tradeDate: string
  late: boolean
}): Promise<MarketGateArchive> {
  const path = marketGateArchivePath(args.analysis.asof)
  const existing = readJson<MarketGateArchive>(path)
  if (existing?.tradeDate === args.tradeDate && existing.premarket) return existing
  const premarket = await fetchPremarketRiskSnapshot({
    signalDate: args.analysis.asof,
    tradeDate: args.tradeDate,
    late: args.late,
  })
  const archive: MarketGateArchive = {
    signalDate: args.analysis.asof,
    tradeDate: args.tradeDate,
    generatedAt: new Date().toISOString(),
    ruleVersion: LIMIT_LADDER_RULE_VERSION,
    premarket,
    auction: null,
    open: null,
  }
  writeJsonAtomic(path, archive)
  return archive
}

async function resolveMarketRiskGate(args: {
  analysis: LimitLadderAnalysis
  tradeDate: string
  phase: 'premarket' | 'auction' | 'open'
  auctionContext?: LadderAuctionContext | null
  highBoardContext?: HighBoardRiskContext | null
  allowPremarketCapture?: boolean
  allowDomesticCapture?: boolean
}): Promise<MarketRiskGate | null> {
  let archive = readMarketGateArchive(args.analysis.asof)
  if (
    !archive?.premarket &&
    args.allowPremarketCapture &&
    args.tradeDate === todayShanghai()
  ) {
    archive = await capturePremarketMarketRisk({
      analysis: args.analysis,
      tradeDate: args.tradeDate,
      late: shanghaiClock().minutes >= 9 * 60 + 15,
    }).catch(() => archive)
  }
  const premarket =
    archive?.tradeDate === args.tradeDate ? archive.premarket : null
  if (args.phase === 'premarket') {
    if (!premarket) return null
    return buildMarketRiskGate({
      signalDate: args.analysis.asof,
      tradeDate: args.tradeDate,
      phase: 'premarket',
      premarket,
      themes: marketGateThemes(args.analysis),
    })
  }
  const stored =
    args.phase === 'open' ? archive?.open : archive?.auction
  if (stored?.tradeDate === args.tradeDate) return stored

  let domestic: DomesticMarketSnapshot | null = null
  if (args.allowDomesticCapture) {
    domestic = await fetchDomesticMarketSnapshot(
      args.highBoardContext?.state ?? null,
    ).catch(() => null)
  }
  if (!premarket && !domestic) return null
  const gate = buildMarketRiskGate({
    signalDate: args.analysis.asof,
    tradeDate: args.tradeDate,
    phase: args.phase,
    premarket,
    domestic,
    themes: marketGateThemes(args.analysis),
    auctionThemes: args.auctionContext?.themes,
    themeRisk: args.highBoardContext?.themes,
    largeCapAuctionAmountSharePct:
      args.auctionContext?.marketStyle?.largeCapAmountSharePct ?? null,
    highBoardState: args.highBoardContext?.state ?? null,
    frozenRepairContext:
      args.phase === 'open'
        ? archive?.auction?.repairContext ?? null
        : null,
  })
  if (!premarket) {
    gate.warnings = Array.from(
      new Set([
        ...gate.warnings,
        MISSING_PREMARKET_GATE_WARNING,
      ]),
    )
  }
  if (args.allowDomesticCapture) {
    const nextArchive: MarketGateArchive = {
      signalDate: args.analysis.asof,
      tradeDate: args.tradeDate,
      generatedAt: new Date().toISOString(),
      ruleVersion: LIMIT_LADDER_RULE_VERSION,
      premarket,
      auction:
        args.phase === 'auction'
          ? gate
          : archive?.tradeDate === args.tradeDate
            ? archive.auction
            : null,
      open:
        args.phase === 'open'
          ? gate
          : archive?.tradeDate === args.tradeDate
            ? archive.open
            : null,
    }
    writeJsonAtomic(marketGateArchivePath(args.analysis.asof), nextArchive)
  }
  return gate
}

export interface LiquidityStyleDecision {
  sizeBucket: LadderSizeBucket
  adjustment: number
  independentStrength: boolean
  confirmationCapped: boolean
  reasons: string[]
}

export function scoreLiquidityStyleGate(args: {
  circulatingMarketCap?: number | null
  heightTier?: LadderRoleProfile['heightTier'] | null
  boards?: number
  themePermission?: ThemePermission | null
  highBoardState?: HighBoardRiskContext['state'] | null
  repairContext?: MarketRepairContext | null
}): LiquidityStyleDecision {
  const sizeBucket = classifyLadderSizeBucket(
    args.circulatingMarketCap,
  )
  const heightTier =
    args.heightTier ??
    ((args.boards ?? 1) >= 3
      ? 'high'
      : (args.boards ?? 1) === 2
        ? 'middle'
        : 'low')
  const repair = args.repairContext
  if (
    !repair?.applicable ||
    repair.state !== 'weight-led-repair' ||
    sizeBucket === 'large' ||
    sizeBucket === 'unknown'
  ) {
    return {
      sizeBucket,
      adjustment: 0,
      independentStrength: false,
      confirmationCapped: false,
      reasons:
        sizeBucket === 'unknown'
          ? ['流通市值缺失，市值风格因子不参与评分']
          : [],
    }
  }

  const permission = args.themePermission
  const independentStrength =
    (permission?.directionScore ?? 0) >= 70 &&
    (permission?.positiveRate ?? 0) >= 60 &&
    (permission?.assistantCount ?? 0) >= 2 &&
    args.highBoardState !== 'panic'
  let adjustment =
    heightTier === 'low'
      ? -4
      : permission?.riskClass === 'high-beta'
        ? -8
        : -6
  if (independentStrength) adjustment /= 2
  const reasons = [
    '9:25确认权重拉指数、市场宽度偏弱',
    `${sizeBucket === 'small' ? '小盘' : '中盘'}${heightTier === 'low' ? '低位' : '中高位'}流动性受挤压`,
  ]
  if (permission?.riskClass === 'high-beta' && heightTier !== 'low') {
    reasons.push('高Beta中高位加重流动性折价')
  }
  if (independentStrength) {
    reasons.push('题材核心、广度与至少两只助攻共振，解除状态上限并将扣分减半')
  }
  return {
    sizeBucket,
    adjustment: r2(adjustment),
    independentStrength,
    confirmationCapped:
      heightTier !== 'low' && !independentStrength,
    reasons,
  }
}

export function combineEnvironmentAdjustments(
  themeAdjustment: number,
  liquidityAdjustment: number,
): number {
  const combined = clamp(
    themeAdjustment + liquidityAdjustment,
    -12,
    5,
  )
  // 权重抽水时防御属性不能抵消市值流动性折价；独立题材已经在
  // scoreLiquidityStyleGate 中通过减半体现。
  return r2(
    liquidityAdjustment < 0
      ? Math.min(combined, liquidityAdjustment)
      : combined,
  )
}

export function scoreNextDayConfirmations(args: {
  baseRows: LadderStockAnalysis[]
  comparisonRows?: LadderStockAnalysis[]
  tradeDate: string
  clockMinutes: number
  quotes: Map<string, ScreenerLiveQuote>
  auctionQuotes?: Record<string, ScreenerLiveQuote> | null
  auctionContext?: LadderAuctionContext | null
  highBoardContext?: HighBoardRiskContext | null
  eventReaction?: LadderEventReaction | null
  marketGate?: MarketRiskGate | null
  sentimentQuant?: LadderSentimentQuantSnapshot | null
}): Pick<
  LimitLadderNextDay,
  | 'stage'
  | 'auctionSnapshotAvailable'
  | 'confirmationSnapshotAvailable'
  | 'auctionContext'
  | 'highBoardContext'
  | 'themeRiskAppetite'
  | 'eventReaction'
  | 'marketGate'
  | 'themePermissions'
  | 'candidates'
  | 'warnings'
> {
  const stage: 'auction' | 'open' =
    args.clockMinutes < 9 * 60 + 35 ? 'auction' : 'open'
  const freshQuotes = new Map(
    Array.from(args.quotes.entries()).filter(([, quote]) =>
      currentNextDayQuote(quote, args.tradeDate, stage),
    ),
  )
  const warnings: string[] = []
  if (freshQuotes.size < args.baseRows.length) {
    warnings.push(
      `${args.baseRows.length - freshQuotes.size}只候选缺少${args.tradeDate}新鲜行情`,
    )
  }
  const auctionQuotes =
    args.auctionQuotes &&
    Object.values(args.auctionQuotes).some(
      (quote) => quote.tradeDate === args.tradeDate,
    )
      ? args.auctionQuotes
      : null
  if (stage === 'open' && !auctionQuotes) {
    warnings.push('9:25竞价快照缺失（终值未冻结），竞价因子已跳过并重归一化')
  }
  if (args.auctionContext?.lowConfidence) {
    warnings.push('竞价过程覆盖不足，过程因子按低置信度处理')
  }
  if (args.highBoardContext?.state === 'panic') {
    warnings.push('高标竞价处于恐慌，中高位接力禁止确认')
  } else if (args.highBoardContext?.state === 'contraction') {
    warnings.push('高标竞价处于收缩，确认状态受题材独立强度约束')
  }
  if (args.marketGate?.state === 'frozen') {
    warnings.push('大盘交易闸门冻结，所有连板接力暂停确认')
  } else if (args.marketGate?.state === 'unavailable') {
    warnings.push('大盘交易闸门数据不可用，所有连板接力暂停确认')
  } else if (args.marketGate?.state === 'restricted') {
    warnings.push('大盘交易闸门限制，高Beta题材禁止执行')
  } else if (args.marketGate?.state === 'cautious') {
    warnings.push('大盘交易闸门谨慎，板块必须形成独立竞价强度')
  }
  if (args.sentimentQuant?.gateState === 'JOINT_CLIMAX') {
    warnings.push('昨日双高潮：次日全天NO_NEW_RELAY，强个股只展示不确认')
  } else if (args.sentimentQuant?.gateState === 'HOT') {
    warnings.push('昨日情绪与势能偏热，次日接力权重降至0.25')
  } else if (args.sentimentQuant?.gateState === 'UNAVAILABLE') {
    warnings.push('关键情绪数据不可用，不能按中性值放行接力')
  }
  if (
    args.marketGate?.repairContext?.state === 'weight-led-repair' &&
    args.marketGate.repairContext.applicable
  ) {
    warnings.push('9:25确认权重抽水式修复，中小盘连板执行权限条件降级')
  }
  const comparisonRows = args.comparisonRows ?? args.baseRows
  const quoteRows = comparisonRows
    .map((stock) => ({ stock, quote: freshQuotes.get(stock.code) }))
    .filter(
      (item): item is { stock: LadderStockAnalysis; quote: ScreenerLiveQuote } =>
        !!item.quote,
    )
  const currentAmounts = quoteRows.map((item) => item.quote.amount)
  const themeMap = new Map(
    (args.auctionContext?.themes ?? []).map((theme) => [theme.theme, theme]),
  )
  const processMap = new Map(
    (args.auctionContext?.candidateProcesses ?? []).map((process) => [
      process.code,
      process,
    ]),
  )
  const themePermissionMap = new Map(
    (args.marketGate?.themePermissions ?? []).map((permission) => [
      permission.theme,
      permission,
    ]),
  )
  const candidates = args.baseRows.map(
    (stock): NextDayCandidateConfirmation => {
      const quote = freshQuotes.get(stock.code)
      const rowWarnings: string[] = []
      const gateReasons = [...(stock.gateReasons ?? [])]
      const themePermission =
        themePermissionMap.get(stock.primaryTheme) ?? null
      const liquidityStyle = scoreLiquidityStyleGate({
        circulatingMarketCap: stock.circulatingMarketCap,
        heightTier: stock.roleProfile?.heightTier,
        boards: stock.consecutiveDays,
        themePermission,
        highBoardState: args.highBoardContext?.state ?? null,
        repairContext: args.marketGate?.repairContext ?? null,
      })
      const environmentAdjustment = combineEnvironmentAdjustments(
        themePermission?.environmentAdjustment ?? 0,
        liquidityStyle.adjustment,
      )
      if (!quote) {
        const expectationMatch = matchRelayExpectation({ expectation: stock.expectation })
        const executionEligibility = evaluateLadderExecutionEligibility({
          stage,
          tradeDate: args.tradeDate,
          quote: null,
          confirmationState: null,
          inaccessible: true,
          marketGateState: args.marketGate?.state,
          themePermissionState: themePermission?.state,
          auctionSnapshotAvailable: !!auctionQuotes,
          openSnapshotAvailable: false,
          openingConfirmationGate: 'unavailable',
          technicalAvailable: stock.technical.available,
          relayGateState: args.sentimentQuant?.gateState,
        })
        return {
          code: stock.code,
          name: stock.name,
          baseState: stock.state,
          promotionLane: stock.promotionLane ?? '',
          baseScore: stock.baseScore ?? stock.score,
          promotionScore: stock.promotionScore ?? stock.score,
          tradabilityScore: stock.tradabilityScore ?? stock.score,
          themeLadder: stock.themeLadder,
          expectation: stock.expectation,
          expectationMatch,
          auctionScore: null,
          finalAuctionScore: null,
          processScore: null,
          themeDirectionScore: null,
          marketStyleScore: null,
          sizeBucket: liquidityStyle.sizeBucket,
          liquidityStyleAdjustment: liquidityStyle.adjustment,
          styleGateReasons: liquidityStyle.reasons,
          openScore: null,
          openingPullUpConfirmed: null,
          openingReboundConfirmed: null,
          auctionTailBuyConfirmed: null,
          openingConfirmationGate: 'unavailable',
          liveScore: null,
          environmentAdjustment,
          openingGapAdjustment: 0,
          auctionTailBonus: 0,
          decisionScore: null,
          marketGateState: args.marketGate?.state ?? null,
          themePermission,
          state: 'rejected',
          tradeDate: '',
          quoteTime: '',
          openGapPct: null,
          auctionAmount: null,
          currentAmount: null,
          currentPrice: null,
          vwap: null,
          inaccessible: true,
          warnings: ['实时行情缺失、日期陈旧或时间未到确认节点'],
          gateReasons: [...gateReasons, ...liquidityStyle.reasons],
          researchConfirmed: false,
          executionEligible: executionEligibility.eligible,
          executionEligibility,
        }
      }
      const openGapPct =
        auctionGapPct(auctionQuotes?.[stock.code]) ??
        (quote.prevClose > 0 && quote.open > 0
          ? r2(((quote.open - quote.prevClose) / quote.prevClose) * 100)
          : null)
      const auctionQuote = auctionQuotes?.[stock.code]
      const process = processMap.get(stock.code)
      const auctionAmount =
        auctionQuote?.matchedAmount ?? auctionQuote?.amount ?? null
      const floatCap = stock.circulatingMarketCap ?? null
      const auctionFloatPct =
        auctionAmount != null && floatCap && floatCap > 0
          ? (auctionAmount / floatCap) * 100
          : null
      const sameTheme = quoteRows.filter((item) =>
        item.stock.primaryTheme === stock.primaryTheme ||
        item.stock.themes.includes(stock.primaryTheme),
      )
      const themePositive =
        sameTheme.length > 0
          ? (sameTheme.filter((item) => item.quote.changePct > 0).length /
              sameTheme.length) *
            100
          : null
      const continuedOnePrice = isContinuedOnePrice(quote)
      const inaccessible =
        continuedOnePrice || (openGapPct != null && openGapPct > 8)
      if (continuedOnePrice) rowWarnings.push('次日继续一字，不可达')
      if (openGapPct != null && openGapPct > 8) {
        rowWarnings.push('开盘涨幅超过8%，拒绝追价')
      }
      const openingFragile =
        openGapPct != null && openGapPct <= OPENING_FLAT_MAX_GAP_PCT
      const openingPullUpConfirmed = stage === 'open' ? isOpeningDirectPullUp(quote) : null
      const openingReboundConfirmed =
        stage === 'open' ? isOpeningVolumePriceRebound(quote) : null
      const auctionTailBuyConfirmed = auctionQuote
        ? isAuctionTailBuy(auctionQuote, process)
        : null
      const openingConfirmationGate: NonNullable<NextDayCandidateConfirmation['openingConfirmationGate']> =
        !openingFragile
          ? 'not-required'
          : stage === 'open' && openingReboundConfirmed
            ? 'passed'
            : 'blocked'
      const openingGapLabel = openGapPct != null && openGapPct < 0 ? '低开' : '平开'
      if (openingFragile && openingConfirmationGate === 'blocked') {
        rowWarnings.push(
          stage === 'open'
            ? `竞价终局${openingGapLabel}，09:35未出现量价翻红`
            : `竞价终局${openingGapLabel}，等待9:35开盘量价翻红`,
        )
        gateReasons.push(
          `竞价${openingGapLabel}默认不确认，必须由9:35量价翻红解除等待`,
        )
      } else if (openingFragile && openingConfirmationGate === 'passed') {
        rowWarnings.push(
          `竞价终局${openingGapLabel}，9:35量价翻红，允许进入确认评分`,
        )
      }
      if (auctionTailBuyConfirmed) {
        rowWarnings.push('竞价9:24末段翘尾抢筹，决策分加3')
      }
      const laneAuctionRows = comparisonRows.filter(
        (candidate) => candidate.promotionLane === stock.promotionLane,
      )
      const laneAuctionAmounts = laneAuctionRows
        .map(
          (candidate) =>
            auctionQuotes?.[candidate.code]?.matchedAmount ??
            auctionQuotes?.[candidate.code]?.amount,
        )
        .filter((value): value is number => value != null && Number.isFinite(value))
      const laneAuctionFloatRatios = laneAuctionRows
        .map((candidate) => {
          const amount =
            auctionQuotes?.[candidate.code]?.matchedAmount ??
            auctionQuotes?.[candidate.code]?.amount
          const cap = candidate.circulatingMarketCap
          return amount != null && cap ? (amount / cap) * 100 : null
        })
        .filter((value): value is number => value != null && Number.isFinite(value))
      if (auctionAmount != null && laneAuctionAmounts.length < 5) {
        rowWarnings.push('同层竞价样本少于5只，分位按中性分处理')
      }
      const finalAuctionScore = auctionQuotes
        ? nullableWeighted([
            {
              value:
                openGapPct == null
                  ? null
                  : openingBandScore(openGapPct, stock.consecutiveDays),
              weight: 0.2,
            },
            {
              value:
                auctionAmount == null
                  ? null
                  : crossSectionPercentile(auctionAmount, laneAuctionAmounts),
              weight: 0.1,
            },
            {
              value:
                auctionFloatPct == null
                  ? null
                  : crossSectionPercentile(auctionFloatPct, laneAuctionFloatRatios),
              weight: 0.1,
            },
            { value: inaccessible ? 0 : 100, weight: 0.05 },
          ])
        : null
      const themeDirection = themeMap.get(stock.primaryTheme)
      const expectationMatch = matchRelayExpectation({
        expectation: stock.expectation,
        openGapPct,
        themeStrength: themeDirection?.score,
        observedPath: classifyObservedRelayPath({
          onePrice: continuedOnePrice,
          openGapPct,
        }),
      })
      const marketStyle = args.auctionContext?.marketStyle
      const stockStyle = classifyAuctionStyle(
        `${stock.primaryTheme} ${stock.themes.join(' ')}`,
        stock.circulatingMarketCap ?? null,
      )
      const marketStyleScore =
        marketStyle?.score == null
          ? null
          : marketStyle.style === 'mixed'
            ? 50
            : stockStyle === marketStyle.style
              ? marketStyle.score
              : 45
      const auctionScore = auctionQuotes
        ? nullableWeighted([
            {
              value:
                openGapPct == null
                  ? null
                  : openingBandScore(openGapPct, stock.consecutiveDays),
              weight: 0.2,
            },
            {
              value:
                auctionAmount == null
                  ? null
                  : crossSectionPercentile(auctionAmount, laneAuctionAmounts),
              weight: 0.1,
            },
            {
              value:
                auctionFloatPct == null
                  ? null
                  : crossSectionPercentile(auctionFloatPct, laneAuctionFloatRatios),
              weight: 0.1,
            },
            { value: inaccessible ? 0 : 100, weight: 0.05 },
            { value: process?.strengtheningScore, weight: 0.15 },
            { value: process?.cancellationStabilityScore, weight: 0.1 },
            { value: themeDirection?.score, weight: 0.2 },
            { value: marketStyleScore, weight: 0.1 },
          ])
        : null
      const vwap = quoteVwap(quote)
      const vwapScore =
        vwap == null || quote.price <= 0
          ? null
          : quote.price >= vwap
            ? 100
            : clamp(100 - ((vwap - quote.price) / vwap) * 1000)
      const laneQuotes = quoteRows.filter(
        (item) => item.stock.promotionLane === stock.promotionLane,
      )
      const laneRelative =
        laneQuotes.length > 0
          ? crossSectionPercentile(
              quote.changePct,
              laneQuotes.map((item) => item.quote.changePct),
            )
          : null
      const openScore =
        stage === 'open'
          ? weightedAvailable([
              { value: vwapScore, weight: 0.3 },
              {
                value: crossSectionPercentile(quote.amount, currentAmounts),
                weight: 0.25,
              },
              { value: themePositive, weight: 0.2 },
              { value: laneRelative, weight: 0.15 },
              { value: inaccessible ? 0 : 100, weight: 0.1 },
            ])
          : null
      const liveScore =
        stage === 'open'
          ? weightedAvailable([
              { value: stock.baseScore ?? stock.score, weight: 0.65 },
              { value: auctionScore, weight: 0.15 },
              { value: openScore, weight: 0.2 },
            ])
          : weightedAvailable([
              { value: stock.baseScore ?? stock.score, weight: 0.65 },
              { value: auctionScore, weight: 0.15 },
            ])
      const openingGapAdjustment = computeOpeningGapAdjustment(openGapPct)
      const auctionTailBonus = auctionTailBuyConfirmed
        ? AUCTION_TAIL_BUY_BONUS
        : 0
      const sentimentRelayWeight = args.sentimentQuant?.nextDayRelayWeight ?? 1
      const decisionScore = r2(
        clamp(
          liveScore * sentimentRelayWeight +
            environmentAdjustment +
            openingGapAdjustment +
            auctionTailBonus,
        ),
      )
      let state: NextDayState
      if (inaccessible) state = 'rejected'
      else if (openingConfirmationGate === 'blocked') {
        state = 'waiting'
      }
      else if (stage === 'auction') {
        state =
          (auctionScore ?? 0) >= 65 && decisionScore >= 65
            ? 'auction-qualified'
            : 'waiting'
      } else if (decisionScore >= 70 && (openScore ?? 0) >= 60) {
        state = 'confirmed'
      } else if (decisionScore >= 55) state = 'waiting'
      else state = 'rejected'
      const roleProfile = stock.roleProfile
      const themeRisk = args.highBoardContext?.themes.find(
        (theme) => theme.theme === stock.primaryTheme,
      )
      if (stock.eventGate === 'hard-block') {
        state = 'rejected'
        gateReasons.push('消息闸门硬否决未解除')
      } else if (stock.eventGate === 'risk-cap') {
        const absorbed =
          args.eventReaction?.state === 'absorbed' &&
          quote.changePct > 0 &&
          args.highBoardContext?.state !== 'panic'
        if (!absorbed) {
          state = args.eventReaction?.state === 'amplified' ? 'rejected' : 'waiting'
          gateReasons.push(
            args.eventReaction?.state === 'amplified'
              ? '监管风险被价格负反馈放大'
              : '监管风险上限等待价格承接验证',
          )
        } else {
          gateReasons.push('监管压力获得竞价承接，风险上限阶段性减轻')
        }
      }
      if (
        args.highBoardContext?.state === 'panic' &&
        roleProfile?.heightTier !== 'low'
      ) {
        if (state === 'confirmed' || state === 'auction-qualified') state = 'waiting'
        gateReasons.push('全市场高标恐慌限制中高位接力确认')
      } else if (
        args.highBoardContext?.state === 'panic' &&
        roleProfile?.heightTier === 'low' &&
        !(themeRisk?.highLowSwitch && themeRisk.score >= 60)
      ) {
        if (state === 'confirmed' || state === 'auction-qualified') state = 'waiting'
        gateReasons.push('恐慌期低位标的未形成题材独立高低切')
      } else if (
        args.highBoardContext?.state === 'contraction' &&
        roleProfile?.heightTier !== 'low' &&
        themeRisk?.state !== 'expansion'
      ) {
        if (state === 'confirmed' || state === 'auction-qualified') state = 'waiting'
        gateReasons.push('高标收缩且题材未独立扩张')
      }
      if (!inaccessible && state !== 'rejected') {
        if (args.marketGate?.state === 'frozen' || args.marketGate?.state === 'unavailable') {
          state = 'blocked'
          gateReasons.push(
            args.marketGate.state === 'unavailable'
              ? '大盘环境数据不可用，禁止以个股分数抵消未知系统性风险'
              : '大盘环境冻结，个股分数不得抵消系统性风险',
          )
        } else if (themePermission?.state === 'blocked') {
          state = 'blocked'
          gateReasons.push(...themePermission.reasons)
        } else if (
          themePermission?.state === 'conditional' &&
          (state === 'confirmed' || state === 'auction-qualified')
        ) {
          state = 'waiting'
          gateReasons.push('板块尚未获得独立行情许可')
        }
        if (
          liquidityStyle.confirmationCapped &&
          (state === 'confirmed' || state === 'auction-qualified')
        ) {
          state = 'waiting'
          gateReasons.push('权重抽水式修复限制中小盘中高位直接确认')
        }
      }
      if (expectationMatch.status === 'violated') {
        if (state === 'confirmed' || state === 'auction-qualified') state = 'waiting'
        gateReasons.push('实际路径违背盘后预期，降为等待确认')
        rowWarnings.push(...expectationMatch.unmet.slice(0, 2))
      }
      if (args.sentimentQuant?.gateState === 'JOINT_CLIMAX') {
        if (!inaccessible) state = 'blocked'
        gateReasons.push('双高潮次日NO_NEW_RELAY：禁止形成新接力确认')
      } else if (args.sentimentQuant?.gateState === 'UNAVAILABLE') {
        if (!inaccessible) state = 'blocked'
        gateReasons.push('关键情绪数据缺失：不按中性值放行')
      }
      gateReasons.push(...liquidityStyle.reasons)
      const executionEligibility = evaluateLadderExecutionEligibility({
        stage,
        tradeDate: args.tradeDate,
        quote,
        confirmationState: state,
        inaccessible,
        marketGateState: args.marketGate?.state,
        themePermissionState: themePermission?.state,
        auctionSnapshotAvailable: !!auctionQuotes,
        openSnapshotAvailable: freshQuotes.size > 0,
        openingConfirmationGate,
        technicalAvailable: stock.technical.available && stock.technical.settled,
        relayGateState: args.sentimentQuant?.gateState,
      })
      return {
        code: stock.code,
        name: stock.name,
        baseState: stock.state,
        promotionLane: stock.promotionLane ?? '',
        baseScore: stock.baseScore ?? stock.score,
        promotionScore: stock.promotionScore ?? stock.score,
        tradabilityScore: stock.tradabilityScore ?? stock.score,
        themeLadder: stock.themeLadder,
        expectation: stock.expectation,
        expectationMatch,
        auctionScore,
        finalAuctionScore,
        processScore: process?.processScore ?? null,
        themeDirectionScore: themeDirection?.score ?? null,
        marketStyleScore,
        sizeBucket: liquidityStyle.sizeBucket,
        liquidityStyleAdjustment: liquidityStyle.adjustment,
        styleGateReasons: liquidityStyle.reasons,
        openScore,
        openingPullUpConfirmed,
        openingReboundConfirmed,
        auctionTailBuyConfirmed,
        openingConfirmationGate,
        liveScore,
        environmentAdjustment,
        openingGapAdjustment,
        auctionTailBonus,
        decisionScore,
        marketGateState: args.marketGate?.state ?? null,
        themePermission,
        state,
        tradeDate: quote.tradeDate,
        quoteTime: quote.quoteTime,
        openGapPct,
        auctionAmount,
        currentAmount: quote.amount,
        currentPrice: quote.price,
        vwap,
        inaccessible,
        warnings: rowWarnings,
        gateReasons,
        researchConfirmed: state === 'confirmed' || state === 'auction-qualified',
        executionEligible: executionEligibility.eligible,
        executionEligibility,
      }
    },
  )
  return {
    stage,
    auctionSnapshotAvailable: !!auctionQuotes,
    confirmationSnapshotAvailable: stage === 'open' && freshQuotes.size > 0,
    auctionContext: args.auctionContext ?? null,
    highBoardContext: args.highBoardContext ?? null,
    themeRiskAppetite: args.highBoardContext?.themes ?? [],
    eventReaction: args.eventReaction ?? null,
    marketGate: args.marketGate ?? null,
    themePermissions: args.marketGate?.themePermissions ?? [],
    candidates: candidates.sort(
      (a, b) =>
        (b.decisionScore ?? b.liveScore ?? b.baseScore) -
        (a.decisionScore ?? a.liveScore ?? a.baseScore),
    ),
    warnings,
  }
}

function pendingConfirmations(
  baseRows: LadderStockAnalysis[],
  marketGate?: MarketRiskGate | null,
  sentimentQuant?: LadderSentimentQuantSnapshot | null,
): NextDayCandidateConfirmation[] {
  const permissions = new Map(
    (marketGate?.themePermissions ?? []).map((permission) => [
      permission.theme,
      permission,
    ]),
  )
  return baseRows
    .map((stock): NextDayCandidateConfirmation => {
      const baseScore = stock.baseScore ?? stock.score
      const themePermission = permissions.get(stock.primaryTheme) ?? null
      const liquidityStyle = scoreLiquidityStyleGate({
        circulatingMarketCap: stock.circulatingMarketCap,
        heightTier: stock.roleProfile?.heightTier,
        boards: stock.consecutiveDays,
        themePermission,
        highBoardState:
          marketGate?.repairContext?.highBoardState ?? null,
        repairContext: marketGate?.repairContext ?? null,
      })
      const environmentAdjustment = combineEnvironmentAdjustments(
        themePermission?.environmentAdjustment ?? 0,
        liquidityStyle.adjustment,
      )
      const executionEligibility = evaluateLadderExecutionEligibility({
        stage: 'pending',
        tradeDate: '',
        quote: null,
        confirmationState: null,
        inaccessible: false,
        marketGateState: marketGate?.state,
        themePermissionState: themePermission?.state,
        auctionSnapshotAvailable: false,
        openSnapshotAvailable: false,
        openingConfirmationGate: 'unavailable',
        technicalAvailable: stock.technical.available && stock.technical.settled,
        relayGateState: sentimentQuant?.gateState,
      })
      return {
        code: stock.code,
        name: stock.name,
        baseState: stock.state,
        promotionLane:
          stock.promotionLane ?? `${stock.consecutiveDays}进${stock.consecutiveDays + 1}`,
        baseScore,
        promotionScore: stock.promotionScore ?? stock.score,
        tradabilityScore: stock.tradabilityScore ?? stock.score,
        themeLadder: stock.themeLadder,
        expectation: stock.expectation,
        expectationMatch: matchRelayExpectation({ expectation: stock.expectation }),
        auctionScore: null,
        finalAuctionScore: null,
        processScore: null,
        themeDirectionScore: null,
        marketStyleScore: null,
        sizeBucket: liquidityStyle.sizeBucket,
        liquidityStyleAdjustment: liquidityStyle.adjustment,
        styleGateReasons: liquidityStyle.reasons,
        openScore: null,
        openingPullUpConfirmed: null,
        openingReboundConfirmed: null,
        auctionTailBuyConfirmed: null,
        openingConfirmationGate: 'unavailable',
        liveScore: null,
        environmentAdjustment,
        openingGapAdjustment: 0,
        auctionTailBonus: 0,
        decisionScore: r2(clamp(baseScore * (sentimentQuant?.nextDayRelayWeight ?? 1) + environmentAdjustment)),
        marketGateState: marketGate?.state ?? null,
        themePermission,
        state: 'pending',
        tradeDate: '',
        quoteTime: '',
        openGapPct: null,
        auctionAmount: null,
        currentAmount: null,
        currentPrice: null,
        vwap: null,
        inaccessible: false,
        warnings: [],
        gateReasons: [
          ...(stock.gateReasons ?? []),
          ...liquidityStyle.reasons,
          ...(sentimentQuant?.gateState === 'JOINT_CLIMAX' ? ['双高潮次日NO_NEW_RELAY'] : []),
          ...(sentimentQuant?.gateState === 'UNAVAILABLE' ? ['关键情绪数据缺失，不按中性值放行'] : []),
        ],
        researchConfirmed: false,
        executionEligible: executionEligibility.eligible,
        executionEligibility,
      }
    })
    .sort(
      (a, b) =>
        (b.decisionScore ?? b.baseScore) - (a.decisionScore ?? a.baseScore),
    )
}

export function settleNextDayFromSnapshots(args: {
  signalDate: string
  tradeDate: string
  baseRows: LadderStockAnalysis[]
  comparisonRows?: LadderStockAnalysis[]
  relayRows?: LadderStockAnalysis[]
  formalRows?: LadderStockAnalysis[]
  process?: AuctionProcessArchive | null
  confirmation?: ConfirmationSnapshot | null
  auctionContext?: LadderAuctionContext | null
  highBoardContext?: HighBoardRiskContext | null
  eventReaction?: LadderEventReaction | null
  marketGate?: MarketRiskGate | null
  sentimentQuant?: LadderSentimentQuantSnapshot | null
  outcome?: LadderOutcomeArchive | null
  warnings?: string[]
}): LimitLadderNextDay {
  const finalSnapshot =
    args.process?.tradeDate === args.tradeDate ? args.process.finalSnapshot : null
  const confirmation =
    args.confirmation?.tradeDate === args.tradeDate ? args.confirmation : null
  const settlementWarnings = [...(args.warnings ?? [])]
  let scored: Pick<
    LimitLadderNextDay,
    | 'auctionSnapshotAvailable'
    | 'confirmationSnapshotAvailable'
    | 'auctionContext'
    | 'highBoardContext'
    | 'themeRiskAppetite'
    | 'eventReaction'
    | 'marketGate'
    | 'themePermissions'
    | 'candidates'
    | 'warnings'
  >

  if (confirmation) {
    scored = scoreNextDayConfirmations({
      baseRows: args.baseRows,
      comparisonRows: args.comparisonRows,
      tradeDate: args.tradeDate,
      clockMinutes: 9 * 60 + 35,
      quotes: new Map(Object.entries(confirmation.quotes)),
      auctionQuotes: finalSnapshot?.quotes ?? null,
      auctionContext: args.auctionContext,
      highBoardContext: args.highBoardContext,
      eventReaction: args.eventReaction,
      marketGate: args.marketGate,
      sentimentQuant: args.sentimentQuant,
    })
  } else if (finalSnapshot) {
    const auctionScored = scoreNextDayConfirmations({
      baseRows: args.baseRows,
      comparisonRows: args.comparisonRows,
      tradeDate: args.tradeDate,
      clockMinutes: 9 * 60 + 25,
      quotes: new Map(Object.entries(finalSnapshot.quotes)),
      auctionQuotes: finalSnapshot.quotes,
      auctionContext: args.auctionContext,
      highBoardContext: args.highBoardContext,
      eventReaction: args.eventReaction,
      marketGate: args.marketGate,
      sentimentQuant: args.sentimentQuant,
    })
    scored = {
      ...auctionScored,
      confirmationSnapshotAvailable: false,
    }
    settlementWarnings.push('9:35确认快照缺失，最终状态仅保留竞价阶段结论')
  } else {
    scored = {
      auctionSnapshotAvailable: false,
      confirmationSnapshotAvailable: false,
      auctionContext: args.auctionContext ?? null,
      highBoardContext: args.highBoardContext ?? null,
      themeRiskAppetite: args.highBoardContext?.themes ?? [],
      eventReaction: args.eventReaction ?? null,
      marketGate: args.marketGate ?? null,
      themePermissions: args.marketGate?.themePermissions ?? [],
      candidates: pendingConfirmations(args.baseRows, args.marketGate, args.sentimentQuant),
      warnings: [],
    }
    settlementWarnings.push('9:25竞价与9:35确认快照均缺失，未使用收盘行情回填')
  }

  const relayPlan = buildNextDayRelayPlan({
    signalDate: args.signalDate,
    tradeDate: args.tradeDate,
    stage: 'settled',
    rows: args.relayRows ?? args.baseRows,
    formalRows: args.formalRows ?? args.baseRows,
    quotes: confirmation
      ? new Map(Object.entries(confirmation.quotes))
      : finalSnapshot
        ? new Map(Object.entries(finalSnapshot.quotes))
        : new Map(),
    auctionContext: args.auctionContext,
    sentimentQuant: args.sentimentQuant,
    confirmations: new Map(scored.candidates.map((candidate) => [candidate.code, candidate])),
  })

  return {
    signalDate: args.signalDate,
    tradeDate: args.tradeDate,
    generatedAt: new Date().toISOString(),
    ruleVersion: LIMIT_LADDER_RULE_VERSION,
    stage: 'settled',
    sentimentQuant: args.sentimentQuant ?? null,
    auctionSnapshotAvailable: scored.auctionSnapshotAvailable,
    confirmationSnapshotAvailable: scored.confirmationSnapshotAvailable,
    auctionContext: args.auctionContext ?? null,
    highBoardContext: scored.highBoardContext ?? args.highBoardContext ?? null,
    themeRiskAppetite:
      scored.themeRiskAppetite ?? args.highBoardContext?.themes ?? [],
    eventReaction: scored.eventReaction ?? args.eventReaction ?? null,
    marketGate: scored.marketGate ?? args.marketGate ?? null,
    themePermissions:
      scored.themePermissions ?? args.marketGate?.themePermissions ?? [],
    outcome: args.outcome ?? null,
    candidates: scored.candidates,
    relayPlan,
    warnings: Array.from(
      new Set([
        ...settlementWarnings,
        ...(args.auctionContext?.warnings ?? []),
        ...scored.warnings,
      ]),
    ),
    strategyStatus: 'research',
  }
}

function legacyAuctionProcess(
  signalDate: string,
  analysis: LimitLadderAnalysis,
): AuctionProcessArchive | null {
  if (analysis.ruleVersion === LIMIT_LADDER_RULE_VERSION) return null
  const snapshot = readJson<LegacyAuctionSnapshot>(
    legacyAuctionSnapshotPath(signalDate, analysis.ruleVersion),
  )
  if (!snapshot) return null
  const synthetic: AuctionProcessSnapshot = {
    capturedAt: snapshot.capturedAt,
    clockTime:
      Object.values(snapshot.quotes)
        .map((quote) => quote.quoteTime)
        .sort()
        .at(-1) ?? '09:25:00',
    quotes: snapshot.quotes,
    market: { topAmount: [], topGainers: [] },
    sources: Array.from(new Set(Object.values(snapshot.quotes).map((quote) => quote.source))),
    coverage: r2(
      (Object.keys(snapshot.quotes).length /
        Math.max(candidateMonitorRows(analysis).length, 1)) *
        100,
    ),
    warnings: ['旧版仅保存9:25终值，不含竞价过程和全市场方向'],
  }
  return {
    signalDate,
    tradeDate: snapshot.tradeDate,
    generatedAt: snapshot.capturedAt,
    ruleVersion: analysis.ruleVersion,
    snapshots: [synthetic],
    finalSnapshot: synthetic,
  }
}

async function resolveNextTradeDate(
  signalDate: string,
  nowDate: string,
  outcome?: LadderOutcomeArchive | null,
): Promise<string | null> {
  if (outcome?.tradeDate) return outcome.tradeDate
  // The next analysis archive is not a trading calendar. If an intermediate
  // signal day is missing, using a later archive (for example 08-31) would
  // incorrectly label the 08-28 outcome as 08-31. Resolve the calendar first.
  const dates = await fetchTradingDates(nowDate).catch(() => [])
  const calendarNext = dates
    .filter((date) => date > signalDate)
    .sort()
    .at(0)
  if (calendarNext) return calendarNext
  // When the provider calendar is unavailable, only use an already archived
  // date that is not later than today. Never use a future/current analysis as
  // a substitute for the missing next trading session.
  const archivedNext = allArchivedAnalysisDates()
    .filter((date) => date > signalDate && date <= nowDate)
    .sort()
    .at(0)
  if (archivedNext) return archivedNext
  const latestSignal = archivedAnalysisDates(nowDate).at(-1)
  const clock = shanghaiClock()
  if (
    latestSignal === signalDate &&
    nowDate > signalDate &&
    clock.day >= 1 &&
    clock.day <= 5
  ) {
    return nowDate
  }
  return null
}

export async function fetchLimitLadderNextDay(
  signalDate: string,
): Promise<LimitLadderNextDay> {
  if (!safeDate(signalDate)) throw new Error('signalDate 必须是 YYYY-MM-DD')
  const analysis = await fetchLimitLadderAnalysis(signalDate)
  const sentimentQuant = analysis.sentimentQuant ?? readLadderSentimentQuant(signalDate)
  const baseRows = candidateMonitorRows(analysis)
  const comparisonRows = auctionComparisonRows(analysis)
  const nowDate = todayShanghai()
  const clock = shanghaiClock()
  const warnings: string[] = []
  let outcome = readOutcomeArchive(signalDate, analysis)
  const tradeDate = await resolveNextTradeDate(signalDate, nowDate, outcome)

  if (
    tradeDate === nowDate &&
    isLadderOutcomeWindow(clock) &&
    !outcome
  ) {
    const current = await fetchLimitLadderAnalysis(nowDate)
    await maybeArchivePreviousOutcome(nowDate, current, analysis)
    outcome = readOutcomeArchive(signalDate, analysis)
  }

  const storedProcess =
    readJson<AuctionProcessArchive>(
      auctionProcessPath(signalDate, analysis.ruleVersion),
    ) ??
    legacyAuctionProcess(signalDate, analysis)
  const storedConfirmation = readJson<ConfirmationSnapshot>(
    confirmationSnapshotPath(signalDate, analysis.ruleVersion),
  )
  const storedContext = buildAuctionContext({
    process: storedProcess,
    analysisRows: analysis.stocks,
    formalRows: formalCandidateRows(analysis),
  })
  const highBoardPath = existingHighBoardArchivePath(signalDate)
  const storedHighBoard =
    (highBoardPath
      ? readJson<HighBoardAuctionArchive>(highBoardPath)
      : null) ??
    (tradeDate
      ? highBoardContextsFromSnapshots({
          analysis,
          tradeDate,
          process: storedProcess,
          confirmation: storedConfirmation,
        })
      : null)
  const storedHighBoardContext =
    storedHighBoard?.open ?? storedHighBoard?.auction ?? null
  let marketGateArchive = readMarketGateArchive(signalDate)
  if (
    tradeDate === nowDate &&
    isPremarketGateCaptureWindow(clock) &&
    !marketGateArchive?.premarket
  ) {
    marketGateArchive = await capturePremarketMarketRisk({
      analysis,
      tradeDate,
      late: false,
    }).catch(() => marketGateArchive)
  }
  const storedMarketGate =
    marketGateArchive?.tradeDate === tradeDate
      ? marketGateArchive.open ??
        marketGateArchive.auction ??
        (marketGateArchive.premarket
          ? buildMarketRiskGate({
              signalDate,
              tradeDate: tradeDate ?? '',
              phase: 'premarket',
              premarket: marketGateArchive.premarket,
              themes: marketGateThemes(analysis),
            })
          : null)
      : null
  if (
    shouldWarnMissingPremarketGate({
      tradeDate,
      nowDate,
      clockMinutes: clock.minutes,
      hasPremarketSnapshot:
        marketGateArchive?.tradeDate === tradeDate &&
        !!marketGateArchive.premarket,
    })
  ) {
    warnings.push(MISSING_PREMARKET_GATE_WARNING)
  }

  if (outcome || (tradeDate != null && nowDate > tradeDate)) {
    if (!outcome) warnings.push(`${tradeDate}次日结果档缺失，未使用当前行情回填`)
    const settledTradeDate = outcome?.tradeDate ?? tradeDate ?? ''
    const archivedSettlementPath = existingSettledNextDayPath(signalDate)
    const archivedSettlement =
      outcome && archivedSettlementPath
        ? readJson<LimitLadderNextDay>(archivedSettlementPath)
        : null
    if (
      archivedSettlement?.stage === 'settled' &&
      archivedSettlement.tradeDate === settledTradeDate &&
      archivedSettlement.outcome?.generatedAt === outcome?.generatedAt
    ) {
      return {
        ...archivedSettlement,
        warnings: Array.from(
          new Set([...archivedSettlement.warnings, ...warnings]),
        ),
      }
    }
    const settled = settleNextDayFromSnapshots({
      signalDate,
      tradeDate: settledTradeDate,
      baseRows,
      comparisonRows,
      relayRows: analysis.stocks,
      formalRows: formalCandidateRows(analysis),
      process: storedProcess,
      confirmation: storedConfirmation,
      auctionContext: storedContext,
      highBoardContext: storedHighBoardContext,
      eventReaction: storedHighBoard?.eventReaction ?? null,
      marketGate: storedMarketGate,
      sentimentQuant,
      outcome,
      warnings,
    })
    if (outcome) writeJsonAtomic(settledNextDayPath(signalDate), settled)
    return settled
  }

  if (
    !tradeDate ||
    nowDate < tradeDate ||
    nowDate <= signalDate ||
    clock.day === 0 ||
    clock.day === 6 ||
    clock.minutes < 9 * 60 + 15
  ) {
    return {
      signalDate,
      tradeDate: tradeDate ?? '',
      generatedAt: new Date().toISOString(),
      ruleVersion: LIMIT_LADDER_RULE_VERSION,
      stage: 'pending',
      sentimentQuant,
      auctionSnapshotAvailable: !!storedProcess?.finalSnapshot,
      confirmationSnapshotAvailable: !!storedConfirmation,
      auctionContext: storedContext,
      highBoardContext: storedHighBoardContext,
      themeRiskAppetite: storedHighBoardContext?.themes ?? [],
      eventReaction: storedHighBoard?.eventReaction ?? null,
      marketGate: storedMarketGate,
      themePermissions: storedMarketGate?.themePermissions ?? [],
      outcome: null,
      candidates: pendingConfirmations(baseRows, storedMarketGate, sentimentQuant),
      relayPlan: buildNextDayRelayPlan({
        signalDate,
        tradeDate: tradeDate ?? '',
        stage: 'pending',
        rows: analysis.stocks,
        formalRows: formalCandidateRows(analysis),
        auctionContext: storedContext,
        sentimentQuant,
        confirmations: new Map(
          pendingConfirmations(baseRows, storedMarketGate, sentimentQuant).map((candidate) => [candidate.code, candidate]),
        ),
      }),
      warnings,
      strategyStatus: 'research',
    }
  }

  if (tradeDate !== nowDate) {
    return {
      signalDate,
      tradeDate,
      generatedAt: new Date().toISOString(),
      ruleVersion: LIMIT_LADDER_RULE_VERSION,
      stage: 'pending',
      sentimentQuant,
      auctionSnapshotAvailable: !!storedProcess?.finalSnapshot,
      confirmationSnapshotAvailable: !!storedConfirmation,
      auctionContext: storedContext,
      highBoardContext: storedHighBoardContext,
      themeRiskAppetite: storedHighBoardContext?.themes ?? [],
      eventReaction: storedHighBoard?.eventReaction ?? null,
      marketGate: storedMarketGate,
      themePermissions: storedMarketGate?.themePermissions ?? [],
      outcome: null,
      candidates: pendingConfirmations(baseRows, storedMarketGate, sentimentQuant),
      relayPlan: buildNextDayRelayPlan({
        signalDate,
        tradeDate: tradeDate ?? '',
        stage: 'pending',
        rows: analysis.stocks,
        formalRows: formalCandidateRows(analysis),
        auctionContext: storedContext,
        sentimentQuant,
        confirmations: new Map(
          pendingConfirmations(baseRows, storedMarketGate, sentimentQuant).map((candidate) => [candidate.code, candidate]),
        ),
      }),
      warnings: [`目标交易日为${tradeDate}，禁止使用${nowDate}行情`],
      strategyStatus: 'research',
    }
  }

  let process = storedProcess
  if (clock.minutes >= 9 * 60 + 15 && clock.minutes < 9 * 60 + 27) {
    process = await captureAuctionProcess(analysis, tradeDate)
  }
  let confirmation = storedConfirmation
  if (clock.minutes >= 9 * 60 + 35 && clock.minutes < 9 * 60 + 37) {
    confirmation = await captureConfirmationSnapshot(analysis, tradeDate)
  }
  const auctionContext = buildAuctionContext({
    process,
    analysisRows: analysis.stocks,
    formalRows: formalCandidateRows(analysis),
  })
  const highBoardArchive = highBoardContextsFromSnapshots({
    analysis,
    tradeDate,
    process,
    confirmation,
    archive: true,
  })
  const highBoardContext =
    highBoardArchive?.open ?? highBoardArchive?.auction ?? null
  const stage = clock.minutes < 9 * 60 + 35 ? 'auction' : 'open'
  const gateCaptureWindow =
    (stage === 'auction' &&
      !!process?.finalSnapshot &&
      clock.minutes >= 9 * 60 + 25 &&
      clock.minutes < 9 * 60 + 27) ||
    (stage === 'open' &&
      !!confirmation &&
      clock.minutes >= 9 * 60 + 35 &&
      clock.minutes < 9 * 60 + 37)
  const marketGate =
    (await resolveMarketRiskGate({
      analysis,
      tradeDate,
      phase:
        stage === 'auction' && !process?.finalSnapshot ? 'premarket' : stage,
      auctionContext,
      highBoardContext,
      allowPremarketCapture: clock.minutes < 9 * 60 + 15,
      allowDomesticCapture: gateCaptureWindow,
    })) ?? storedMarketGate
  const liveQuotes =
    stage === 'open'
      ? (confirmation?.quotes ?? {})
      : (process?.finalSnapshot?.quotes ?? process?.snapshots.at(-1)?.quotes ?? {})
  const scored = scoreNextDayConfirmations({
    baseRows,
    comparisonRows,
    tradeDate,
    clockMinutes: clock.minutes,
    quotes: new Map(Object.entries(liveQuotes)),
    auctionQuotes: process?.finalSnapshot?.quotes ?? null,
    auctionContext,
    highBoardContext,
    eventReaction: highBoardArchive?.eventReaction ?? null,
    marketGate,
    sentimentQuant,
  })
  const relayPlan = buildNextDayRelayPlan({
    signalDate,
    tradeDate,
    stage,
    rows: analysis.stocks,
    formalRows: formalCandidateRows(analysis),
    quotes: new Map(Object.entries(liveQuotes)),
    auctionContext,
    sentimentQuant,
    confirmations: new Map(scored.candidates.map((candidate) => [candidate.code, candidate])),
  })
  return {
    signalDate,
    tradeDate,
    generatedAt: new Date().toISOString(),
    ruleVersion: LIMIT_LADDER_RULE_VERSION,
    sentimentQuant,
    ...scored,
    relayPlan,
    outcome: null,
    warnings: [
      ...warnings,
      ...(auctionContext?.warnings ?? []),
      ...scored.warnings,
    ],
  }
}

let auctionScheduler: ReturnType<typeof setInterval> | null = null
let auctionSchedulerBusy = false

export interface LimitLadderAuctionSchedulerStatus {
  lastTickAt: string | null
  signalDate: string | null
  today: string | null
  nextTradeDate: string | null
  phase: string | null
  action: 'idle' | 'skipped' | 'dispatching' | 'sent' | 'failed'
  reason: string | null
  error: string | null
}

let auctionSchedulerStatus: LimitLadderAuctionSchedulerStatus = {
  lastTickAt: null,
  signalDate: null,
  today: null,
  nextTradeDate: null,
  phase: null,
  action: 'idle',
  reason: null,
  error: null,
}

export function getLimitLadderAuctionSchedulerStatus(): LimitLadderAuctionSchedulerStatus {
  return { ...auctionSchedulerStatus }
}

export async function runLimitLadderAuctionSchedulerTick(nowMs = Date.now()): Promise<void> {
  if (auctionSchedulerBusy) return
  const clock = shanghaiClockAt(nowMs)
  const today = todayShanghai(nowMs)
  auctionSchedulerStatus = {
    ...auctionSchedulerStatus,
    lastTickAt: new Date(nowMs).toISOString(),
    today,
    signalDate: null,
    nextTradeDate: null,
    phase: null,
    action: 'idle',
    reason: null,
    error: null,
  }
  if (!isTradingDayAt(nowMs)) {
    auctionSchedulerStatus = { ...auctionSchedulerStatus, action: 'skipped', reason: '当前日期不是交易日' }
    return
  }
  const signalDate = archivedAnalysisDates(today).at(-1)
  auctionSchedulerStatus = { ...auctionSchedulerStatus, signalDate: signalDate ?? null }
  if (!signalDate) {
    auctionSchedulerStatus = { ...auctionSchedulerStatus, action: 'skipped', reason: '没有可用于隔日预案的连板收盘归档' }
    return
  }
  const briefPhase = auctionBriefPhaseForMinutes(clock.minutes)
  auctionSchedulerStatus = { ...auctionSchedulerStatus, phase: briefPhase }
  const premarketWindow = isPremarketGateCaptureWindow(clock)
  const captureWindow =
    (clock.minutes >= 9 * 60 + 15 && clock.minutes < 9 * 60 + 27) ||
    (clock.minutes >= 9 * 60 + 35 && clock.minutes < 9 * 60 + 37)
  const outcomeWindow =
    clock.minutes >= 15 * 60 + 10 &&
    clock.minutes < 15 * 60 + 20 &&
    !existingOutcomePath(signalDate)
  if (!premarketWindow && !captureWindow && !outcomeWindow && !briefPhase) {
    auctionSchedulerStatus = { ...auctionSchedulerStatus, action: 'idle', reason: '当前不在调度窗口' }
    return
  }
  auctionSchedulerBusy = true
  try {
    const nextDay = await fetchLimitLadderNextDay(signalDate)
    auctionSchedulerStatus = { ...auctionSchedulerStatus, nextTradeDate: nextDay.tradeDate }
    if (briefPhase && nextDay.tradeDate === today) {
      auctionSchedulerStatus = { ...auctionSchedulerStatus, action: 'dispatching' }
      const analysis = await fetchLimitLadderAnalysis(signalDate)
      const currentAnalysis = briefPhase === 'open-confirmation'
        ? await fetchLimitLadderAnalysis(today).catch(() => undefined)
        : undefined
      await generateAndDispatchAuctionBrief({
        phase: briefPhase,
        analysis,
        nextDay,
        currentAnalysis,
      })
      auctionSchedulerStatus = { ...auctionSchedulerStatus, action: 'sent', reason: null }
    } else if (briefPhase) {
      auctionSchedulerStatus = {
        ...auctionSchedulerStatus,
        action: 'skipped',
        reason: `最新可用连板归档 ${signalDate} 的下一交易日为 ${nextDay.tradeDate ?? '未知'}，不是当前交易日 ${today}`,
      }
    }
  } catch (error) {
    auctionSchedulerStatus = {
      ...auctionSchedulerStatus,
      action: 'failed',
      error: error instanceof Error ? error.message : '连板推送调度失败',
      reason: '本次调度未完成，后续 tick 将重试',
    }
  } finally {
    auctionSchedulerBusy = false
  }
}

export function startLimitLadderAuctionScheduler(): boolean {
  if (auctionScheduler) return false
  auctionScheduler = setInterval(() => void runLimitLadderAuctionSchedulerTick(), 15_000)
  auctionScheduler.unref?.()
  void runLimitLadderAuctionSchedulerTick()
  return true
}
export async function fetchLimitLadderAnalysis(asof = todayShanghai()): Promise<LimitLadderAnalysis> {
  if (!safeDate(asof)) throw new Error('date 必须是 YYYY-MM-DD')
  const today = todayShanghai()
  if (asof !== today) {
    const path = archivedAnalysisPath(asof)
    const archived = path ? readJson<LimitLadderAnalysis>(path) : null
    if (!archived) throw new Error(`未找到${asof}的连板天梯归档`)
    return { ...archived, archived: true, strategyStatus: 'research' }
  }
  // 收盘后的同日快照是定盘数据。服务重启或页面再次打开时直接读盘，零上游 API 请求。
  // 当日有手工导入时允许重算并覆盖快照。
  if (isLadderSettledWindow() && !importsByDate.has(asof)) {
    const archivedPath = archivedAnalysisPath(asof)
    const archived = archivedPath
      ? readJson<LimitLadderAnalysis>(archivedPath)
      : null
    // A version upgrade must start from a complete new trading-day cycle. Explicit
    // refreshes may refill the current version, but cannot rewrite a frozen legacy signal.
    if (archived && archived.ruleVersion !== LIMIT_LADDER_RULE_VERSION) {
      return { ...archived, archived: true, strategyStatus: 'research' }
    }
    // 15:00先保存行情定盘；16:30后若龙虎榜此前未发布，允许自动补算一次资金流并覆盖快照。
    if (
      archived &&
      !forcedRecomputeDates.has(asof) &&
      (archived.quality.fundFlowComplete !== false ||
        !isLhbPublicationWindow())
    ) {
      return { ...archived, archived: true, strategyStatus: 'research' }
    }
  }
  const cached = analysisCache.get(asof)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  try {
    const value = await computeCurrentAnalysis(asof)
    analysisCache.set(asof, { at: Date.now(), value })
    return value
  } finally {
    forcedRecomputeDates.delete(asof)
  }
}

export async function importLimitLadder(input: unknown): Promise<LimitLadderAnalysis> {
  const normalized = normalizeLadderImport(input)
  if (normalized.asof !== todayShanghai()) {
    throw new Error('只允许导入当前交易日天梯')
  }
  importsByDate.set(normalized.asof, normalized)
  analysisCache.delete(normalized.asof)
  return fetchLimitLadderAnalysis(normalized.asof)
}

export function clearLimitLadderCache(): void {
  analysisCache.clear()
  clearKplLadderCache()
  forcedRecomputeDates.add(todayShanghai())
}
