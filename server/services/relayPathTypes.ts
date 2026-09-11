import type { BoardType } from './ladderExpectation'

export const RELAY_PATH_EVIDENCE_SCHEMA = 'relay-path-evidence-v1' as const

export type RelayBoardClass =
  | 'strict-first-board'
  | 'rebound-board'
  | 'n-day-m-board'
  | 'consecutive'
  | 'unknown'

export type RelayPathQuality = 'full' | 'partial' | 'unavailable' | 'mismatch'
export type RelayBoardState =
  | 'LOCKED_CONSENSUS'
  | 'TRADABLE_CONSENSUS'
  | 'HEALTHY_DIVERGENCE'
  | 'EXHAUSTION_DIVERGENCE'
  | 'FAILED'

export interface RelayField<T> {
  value: T | null
  asOf: string
  eventAt: string | null
  providerAt: string | null
  receivedAt: string | null
  decisionAt: string
  provider: string
  adjustment: 'raw' | 'qfq' | 'hfq' | 'none' | 'unknown'
  missingReason?: string
}

export interface LaunchStructureEvidence {
  basePrice: number | null
  baseDate: string | null
  preBoardRange20Pct: number | null
  preBoardVolumeContraction: number | null
  position250: number | null
  distPriorHighAtr: number | null
  ma20: number | null
  ma60: number | null
  ma120: number | null
  ma250: number | null
  maSlopes: Record<'ma20' | 'ma60' | 'ma120' | 'ma250', number | null>
  episodeSpeed: number | null
  macdState: 'bullish' | 'bearish' | 'mixed' | 'unavailable'
  evidence: string[]
}

export interface BoardPathDay {
  date: string
  boardNo: number
  boardType: BoardType
  boardState: RelayBoardState
  openGapPct: RelayField<number>
  firstTouchMinute: RelayField<number>
  firstSealMinute: RelayField<number>
  lastSealMinute: RelayField<number>
  reopenCount: RelayField<number>
  reopenTotalSeconds: RelayField<number>
  maxOpenSeconds: RelayField<number>
  sealDurationSeconds: RelayField<number>
  turnoverPct: RelayField<number>
  amountToFloatPct: RelayField<number>
  amountRatio20: RelayField<number>
  amountRatioPrevBoard: RelayField<number>
  sealAmountToDayAmount: RelayField<number>
  closeLocation: RelayField<number>
  amplitude: RelayField<number>
  postSealVwapHold: RelayField<boolean>
  themeRank: RelayField<number>
  themeBreadth: RelayField<number>
  missingReasons: string[]
}

export interface RelayPathAggregates {
  turnoverExchangeProxy: number | null
  amountSlope: number | null
  turnoverSlope: number | null
  sealTimeSlope: number | null
  reopenPressure: number | null
  queueSlope: number | null
  episodeSpeed: number | null
  extensionAtr: number | null
  boardStates: RelayBoardState[]
  evidence: string[]
}

export interface StockPersonalityEvidence {
  priorFirstBoardCount250: number
  priorFirstBoardCount500: number
  sameTypeEventCount: number
  effectiveSampleSize: number
  lastLimitEventAge: number | null
  touchToSealRate: number | null
  blastRate: number | null
  nextOpenPositiveRate: number | null
  nextOpenGapMedian: number | null
  nextClosePremiumMedian: number | null
  nextOpenToLowMedian: number | null
  nextDayTouchRate: number | null
  nextDaySealRate: number | null
  missingReasons: string[]
}

export interface LocationSupplyEvidence {
  position250: number | null
  distPriorHighAtr: number | null
  nearOverheadSupply: number | null
  overhead20PctSupply: number | null
  failedBreakoutCount60: number | null
  distanceToMa: Record<'ma20' | 'ma60' | 'ma120' | 'ma250', number | null>
  maSlopes: Record<'ma20' | 'ma60' | 'ma120' | 'ma250', number | null>
  proxy: true
  missingReasons: string[]
}

export interface EnvironmentPathEvidence {
  marketCycle: string | null
  lanePromotionUniverse: number | null
  themeRank: number | null
  themeBreadth: number | null
  missingReasons: string[]
}

export interface FeatureCoverage {
  overall: number
  byField: Record<string, number>
  requiredComplete: boolean
  missingReasons: string[]
}

export interface RelayPathEvidence {
  schemaVersion: typeof RELAY_PATH_EVIDENCE_SCHEMA
  featureVersion: string
  signalDate: string
  signalCutoffAt: string
  code: string
  boardClass: RelayBoardClass
  lane: string
  declaredBoards: number
  reconstructedBoards: number | null
  contiguous: boolean | null
  launch: LaunchStructureEvidence
  boards: BoardPathDay[]
  aggregates: RelayPathAggregates
  personality: StockPersonalityEvidence
  locationSupply: LocationSupplyEvidence
  environmentPath: EnvironmentPathEvidence
  coverage: FeatureCoverage
  quality: RelayPathQuality
  missingReasons: string[]
  sourceRefs: string[]
  sourceHash: string
}

// ── 接力路径评分结果（从 `relayPathScoring.ts` 移到公开侧）─────────────────
//
// 判定依据：这些是**数据结构**，不含任何权重或阈值 —— 权重表留在私有
// `relayPathScoring.ts`。公开侧的天梯要把分数存进自己的类型并序列化输出，
// 所以必须知道形状，但不需要知道怎么算。

export interface RelayScoreComponent {
  score: number | null
  featureCoverage: number
  sampleConfidence: number
  evidence: string[]
  failedConditions: string[]
}

export interface RelayPathScore {
  scoreVersion: string
  model: 'first-board-path-v4-shadow' | 'streak-path-v1-shadow'
  pathResearchScore: number | null
  pathCoverage: number
  promotionResearchScore: number | null
  tradabilityProxy: number | null
  dataConfidence: number
  probabilityStatus: 'research-score'
  components: Record<string, RelayScoreComponent>
  failedConditions: string[]
}

export interface RelayDecisionHeads {
  pathResearchScore: number | null
  pathCoverage: number
  promotionResearchScore: number | null
  tradabilityProxy: number | null
  dataConfidence: number
  probabilityStatus: 'unavailable' | 'research-score' | 'calibrated'
  pathScoreVersion: string
}
