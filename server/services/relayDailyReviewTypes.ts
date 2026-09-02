import type {
  SchedulerCheckpoint,
  SchedulerPhase,
} from './schedulerCheckpoints'

export const RELAY_DAILY_REVIEW_SCHEMA_VERSION = 'relay-daily-review-v1' as const
export const RELAY_DAILY_REVIEW_TAXONOMY_VERSION = 'relay-theme-taxonomy-v1' as const

/**
 * The two boundary checkpoints are ledger concepts. All market-session
 * checkpoints are deliberately reused from schedulerCheckpoints.ts so their
 * time semantics cannot drift in a second enum.
 */
export type RelayReviewCheckpoint = 'close-plan' | SchedulerCheckpoint | 'exit-settled'

export type RelayReviewPhase = 'close-plan' | SchedulerPhase | 'exit-settled'

export type RelaySourceQuality =
  | 'formal'
  | 'shadow'
  | 'degraded'
  | 'legacy-unverified'
  | 'unavailable'

export interface RelaySourceRef {
  sourceId: string
  sourceType: string
  sourceRef: string
  asof: string
  observedPhase: RelayReviewCheckpoint
  dataCutoffAt: string
  decisionAt: string
  eventAt: string | null
  providerAt: string | null
  receivedAt: string
  knownAt: string
  capturedAt: string
  sourceHash: string
  quality: RelaySourceQuality
  missingReasons: string[]
}

export interface RelayReviewQuality {
  status: 'formal' | 'partial' | 'degraded' | 'unavailable'
  pointInTime: boolean
  coveragePct: number | null
  sourceCount: number
  missingLayers: string[]
  warnings: string[]
}

export type RelayLanePermission =
  | 'research-relay'
  | 'wait-confirm'
  | 'observe'
  | 'exclude'
  | 'unavailable'

export type RelayConfidence = 'high' | 'medium' | 'low' | 'unavailable'

export interface RelayFeedbackEvidence {
  numerator: number | null
  denominator: number | null
  effectiveN: number | null
  priorWindow: string | null
  posterior: number | null
  confidence: RelayConfidence
  evidenceRefs: string[]
  missingReasons: string[]
}

export interface RelayLanePlaybook {
  lane: string
  fromBoards: number
  targetBoards: number
  population: {
    fullLanePool: number
    hardEligible: number
    ranked: number
    quotaSelected: number
    confirmed: number
    filled: number
  }
  evidence: RelayFeedbackEvidence
  permission: RelayLanePermission
  confidence: RelayConfidence
  reasons: string[]
  confirmations: string[]
  invalidations: string[]
}

export type RelayCandidateRole =
  | 'relay-candidate'
  | 'theme-core-observer'
  | 'emotion-anchor'
  | 'fallback-observer'

export interface RelayCandidatePlaybook {
  code: string
  name: string
  lane: string
  role: RelayCandidateRole
  researchPriority: number
  probabilityStatus: 'unavailable' | 'research-ranking' | 'calibrated'
  pPromote: number | null
  pFill: number | null
  expectedNetR: number | null
  expectedAuctionRange: { minPct: number; maxPct: number } | null
  allowedPaths: string[]
  prohibitedPaths: string[]
  confirmations: string[]
  invalidations: string[]
  noChaseReasons: string[]
  watchRefs: string[]
  executionEligible: false
}

export interface RelayFeedbackEdge {
  subject: { kind: 'stock' | 'theme' | 'lane'; id: string }
  target: { kind: 'stock' | 'theme' | 'lane'; id: string }
  relation: 'confirm' | 'anchor' | 'compete' | 'siphon' | 'follow' | 'diverge'
  effect: 'supportive' | 'negative' | 'mixed' | 'unavailable'
  phase: RelayReviewCheckpoint
  numerator: number | null
  denominator: number | null
  effectiveN: number | null
  priorWindow: string | null
  posterior: number | null
  confidence: RelayConfidence
  evidenceRefs: string[]
  missingReasons: string[]
}

export interface RelayThemePlaybook {
  themeId: string
  canonicalName: string
  originalLabels: Array<{ provider: string; rawName: string }>
  permission: RelayLanePermission
  reasons: string[]
  sourceRefs: string[]
}

export interface RelayRotationSnapshot {
  asof: string
  sourceRefs: string[]
  taxonomyVersion: string
  archiveAvailable: boolean
  warnings: string[]
}

export interface RelayClosePlan {
  marketRegime: string
  marketGate: string
  sentiment: string
  rotationSnapshot: RelayRotationSnapshot
  themePlaybooks: RelayThemePlaybook[]
  lanePlaybooks: RelayLanePlaybook[]
  candidatePlaybooks: RelayCandidatePlaybook[]
  watchGraph: RelayFeedbackEdge[]
  sourceRefs: RelaySourceRef[]
}

export interface RelayCheckpoint {
  checkpoint: RelayReviewCheckpoint
  phase: RelayReviewPhase
  observedAt: string
  dataCutoffAt: string
  decisionAt: string
  sourceRefs: RelaySourceRef[]
  quality: RelayReviewQuality
  warnings: string[]
}

export interface RelayReviewOutcome {
  dataCutoffAt?: string
  observedAt?: string
  decisionAt?: string
  marketOutcome: Record<string, unknown> | null
  executionOutcome: Record<string, unknown> | null
  exitOutcome: Record<string, unknown> | null
  expectationDelta: Record<string, unknown> | null
  errorTaxonomy: Array<
    | 'market'
    | 'theme'
    | 'lane'
    | 'auction'
    | 'execution'
    | 'exit'
    | 'unresolved'
  >
}

export interface RelayReviewValidation {
  stage: 'shadow' | 'descriptive' | 'oos-evaluated' | 'calibrated' | 'paper-trade-validated'
  ruleVersion: string
  featureVersion: string
  taxonomyVersion: string
  fillVersion: string
  datasetHash: string | null
  metrics: Record<string, number | null>
  failedChecks: string[]
}

export interface RelayDailyReviewV1 {
  schemaVersion: typeof RELAY_DAILY_REVIEW_SCHEMA_VERSION
  reviewId: string
  signalDate: string
  tradeDate: string
  timezone: 'Asia/Shanghai'
  phase: RelayReviewPhase
  latestCheckpoint: RelayReviewCheckpoint
  decisionAt: string
  dataCutoffAt: string
  generatedAt: string
  storedAt: string
  settled: boolean
  revision: number
  supersedes: { revision: number; documentHash: string } | null
  strategyStatus: 'research' | 'paper-trade' | 'eligible' | 'rejected'
  runtimePermission: 'research-only'
  validationStage: RelayReviewValidation['stage']
  ruleVersion: string
  taxonomyVersion: string
  closePlanHash: string
  sourceHash: string
  revisionContentHash: string
  documentHash: string
  evidenceHashes: string[]
  quality: RelayReviewQuality
  closePlan: RelayClosePlan
  checkpoints: RelayCheckpoint[]
  outcome: RelayReviewOutcome | null
  validation: RelayReviewValidation
  warnings: string[]
}

export function isRelayReviewCheckpoint(value: unknown): value is RelayReviewCheckpoint {
  return value === 'close-plan' || value === 'exit-settled' || [
    'overnight-context',
    'asia-open',
    'asia-0830',
    'asia-0900',
    'pre-auction',
    'auction-initial',
    'auction-probe',
    'auction-prelock',
    'auction-lock',
    'auction-locked-mid',
    'auction-prefinal',
    'auction-final',
    'open-initial',
    'open-confirm',
    'settled',
  ].includes(value as string)
}

export function phaseOfRelayCheckpoint(checkpoint: RelayReviewCheckpoint): RelayReviewPhase {
  if (checkpoint === 'close-plan') return 'close-plan'
  if (checkpoint === 'exit-settled') return 'exit-settled'
  const phase: SchedulerPhase = checkpoint === 'settled'
    ? 'settled'
    : checkpoint.startsWith('auction-')
      ? 'auction'
      : checkpoint === 'open-initial' || checkpoint === 'open-confirm'
        ? 'open'
        : 'premarket'
  return phase
}
