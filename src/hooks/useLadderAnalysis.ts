import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

const LADDER_SNAPSHOT_PREFIX = 'limit-ladder-snapshot-v6:'
const CURRENT_LADDER_RULE_VERSION = 'limit-ladder-v6'

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
export type MarketCyclePhase = 'ice' | 'repair' | 'climax' | 'ebb'
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
}

export interface LadderImportPayload {
  asof: string
  stocks: LadderImportStock[]
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
  v2?: {
    promotion: number
    tradability: number
    base: number
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
    score: number
    net: number
    instNet: number
    hotNet: number
    lhasaNet: number
    note: string
    source: 'eastmoney-lhb' | 'missing-neutral'
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
      score: number
      directionAvailable: boolean
      reasons: string[]
      current: {
        temperature: number
        limitUp: number
        limitDown: number
        breakRate: number
        promotionRate: number
        yestLimitPerf: number
        advance: number
        decline: number
        maxBoards: number
        ladderContinuity: number
      }
      previousTemperature?: number
    }
    limitUp: number
    limitDown: number
    breakRate: number
    promotionRate: number
    advance: number
    decline: number
    maxBoards: number
  }
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
    limitFieldsComplete: boolean
    klineComplete: number
    klineTotal: number
    degraded: boolean
    fundFlowComplete?: boolean
    warnings: string[]
  }
  warnings: string[]
}

export interface NextDayCandidateConfirmation {
  code: string
  name: string
  baseState: LadderState
  promotionLane: string
  baseScore: number
  promotionScore: number
  tradabilityScore: number
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
  decisionScore?: number | null
  marketGateState?: MarketGateState | null
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

export interface LimitLadderNextDay {
  signalDate: string
  tradeDate: string
  generatedAt: string
  ruleVersion: string
  stage: 'pending' | 'auction' | 'open' | 'settled'
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

export type ExternalRiskState = 'risk-on' | 'mixed' | 'risk-off' | 'panic'
export type MarketGateState = 'normal' | 'cautious' | 'restricted' | 'frozen'
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
  riskScore: number
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
  advance: number
  decline: number
  flat: number
  limitUp: number
  limitDown: number
  indexRiskScore: number | null
  breadthRiskScore: number | null
  highBoardRiskScore: number | null
  riskScore: number
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
  riskScore: number
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
      if (refresh) await fetch('/api/refresh?market=ladder', { method: 'POST' }).catch(() => {})
      const res = await fetchWithTimeout(
        `/api/ladder/analysis?date=${encodeURIComponent(date)}`,
        120_000,
      )
      const json = (await res.json()) as LimitLadderAnalysis & { error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
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
    fetching.current = true
    setLoading(true)
    load()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load ladder')
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

export function useLadderNextDay(signalDate: string, enabled = true, refreshKey = 0) {
  const requestKey = enabled && signalDate ? signalDate : ''
  const [result, setResult] = useState<{
    key: string
    data: LimitLadderNextDay | null
    error: string | null
  }>({ key: '', data: null, error: null })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!requestKey) return
      try {
        const response = await fetchWithTimeout(
          `/api/ladder/next-day?signalDate=${encodeURIComponent(signalDate)}`,
          30_000,
        )
        const json = (await response.json()) as LimitLadderNextDay & { error?: string }
        if (!response.ok || json.error) throw new Error(json.error ?? `HTTP ${response.status}`)
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
        const response = await fetchWithTimeout(
          `/api/ladder/auction-brief?signalDate=${encodeURIComponent(signalDate)}`,
          15_000,
        )
        const json = (await response.json()) as AuctionBriefState & { error?: string }
        if (!response.ok || json.error) throw new Error(json.error ?? `HTTP ${response.status}`)
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
