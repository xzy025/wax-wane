import { canonicalStringify, hashCanonical, sortBy } from '../lib/canonicalJson'
import {
  phaseOfRelayCheckpoint,
  type RelayCandidatePlaybook,
  type RelayCheckpoint,
  type RelayClosePlan,
  type RelayDailyReviewV1,
  type RelayFeedbackEdge,
  type RelayLanePermission,
  type RelayLanePlaybook,
  type RelayReviewCheckpoint,
  type RelayReviewOutcome,
  type RelayReviewQuality,
  type RelayReviewValidation,
  type RelaySourceRef,
  type RelayThemePlaybook,
} from './relayDailyReviewTypes'
import { checkpointSpec, type SchedulerCheckpoint } from './schedulerCheckpoints'

/** Ordered timeline used for canonical projection of checkpoints. */
export const RELAY_REVIEW_CHECKPOINT_ORDER: RelayReviewCheckpoint[] = [
  'close-plan',
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
  'exit-settled',
]

export function isRelayCheckpointKnown(checkpoint: string): checkpoint is RelayReviewCheckpoint {
  return RELAY_REVIEW_CHECKPOINT_ORDER.includes(checkpoint as RelayReviewCheckpoint)
}

function parseIso(value: string): number {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) throw new Error(`非法 ISO 时间: ${value}`)
  return ms
}

/**
 * Timezone-safe ISO comparison (handles +08:00 vs Z offsets that would break
 * lexicographic ordering). Throws on unparseable values instead of silently
 * misordering.
 */
export function compareIsoTimes(a: string, b: string): number {
  return parseIso(a) - parseIso(b)
}

export function isIsoTime(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

export interface RelayQualityAggregationInput {
  sourceRefs: readonly RelaySourceRef[]
}

/**
 * WP3.1: quality must reflect the actual source set, not merely "there are N
 * sourceRefs". Degraded/shadow/unavailable sources can never be marketed as
 * formal/100%. Point-in-time is only true when every usable source is checked.
 */
export function aggregateRelaySourceQuality(
  input: RelayQualityAggregationInput,
): RelayReviewQuality {
  const sources = input.sourceRefs
  const total = sources.length
  const usable = sources.filter((source) => source.quality !== 'unavailable')
  const formal = sources.filter((source) => source.quality === 'formal')
  const unusable = sources.filter((source) => source.quality === 'unavailable')
  const missingLayers = Array.from(new Set(sources.flatMap((source) => source.missingReasons ?? [])))
  const coveragePct = total > 0 ? Math.round((formal.length / total) * 1000) / 10 : null
  let status: RelayReviewQuality['status']
  if (total === 0) {
    status = 'unavailable'
    missingLayers.push('sourceRefs')
  } else if (unusable.length === total) {
    status = 'unavailable'
  } else if (unusable.length > 0 || usable.some((source) => source.quality === 'degraded')) {
    // Any unusable or degraded source prevents formality.
    status = 'degraded'
  } else if (usable.some((source) => source.quality === 'shadow' || source.quality === 'legacy-unverified')) {
    // Shadow/legacy sources are research evidence, not formal point-in-time.
    status = 'partial'
  } else {
    status = 'formal'
  }
  return {
    status,
    pointInTime: status === 'formal',
    coveragePct,
    sourceCount: total,
    missingLayers: Array.from(new Set(missingLayers)),
    warnings: [],
  }
}

function sourceRefsSorted(sourceRefs: ReadonlyArray<RelaySourceRef>): RelaySourceRef[] {
  return sortBy(sourceRefs, (s) => `${s.sourceId}|${s.eventAt ?? ''}|${s.capturedAt}`)
}

/**
 * WP3.1: verify a single revision document against the whole contract. Returns
 * a list of violations; an empty list means the document is trustworthy. Hash
 * verification catches legal-JSON tampering.
 */
export function validateRelayDailyReview(revision: RelayDailyReviewV1): string[] {
  const errors: string[] = []
  if (revision.schemaVersion !== 'relay-daily-review-v1') {
    errors.push('schemaVersion 非法: ' + revision.schemaVersion)
  }
  if (!safeRelayDate(revision.signalDate)) errors.push('signalDate 非法: ' + revision.signalDate)
  if (!safeRelayDate(revision.tradeDate)) errors.push('tradeDate 非法: ' + revision.tradeDate)
  if (revision.timezone !== 'Asia/Shanghai') errors.push(`timezone 非法: ${revision.timezone}`)
  for (const field of [revision.decisionAt, revision.dataCutoffAt, revision.generatedAt] as const) {
    if (!isIsoTime(field)) errors.push(`时间字段非法: ${field}`)
  }
  if (!Number.isInteger(revision.revision) || revision.revision < 1) errors.push(`revision 非法: ${revision.revision}`)
  if (revision.runtimePermission !== 'research-only') errors.push(`runtimePermission 非法: ${revision.runtimePermission}`)
  if (revision.latestCheckpoint !== 'close-plan' && revision.checkpoints.length === 0) {
    errors.push('latestCheckpoint 非 close-plan 但 checkpoints 为空')
  }
  let previous: RelayReviewCheckpoint | null = null
  for (const entry of revision.checkpoints) {
    if (!isRelayCheckpointKnown(entry.checkpoint)) {
      errors.push(`未知检查点: ${entry.checkpoint}`)
      continue
    }
    const index = RELAY_REVIEW_CHECKPOINT_ORDER.indexOf(entry.checkpoint)
    if (previous) {
      const previousIndex = RELAY_REVIEW_CHECKPOINT_ORDER.indexOf(previous)
      if (index < previousIndex) {
        errors.push(`检查点顺序倒退: ${previous} -> ${entry.checkpoint}`)
      }
    }
    previous = entry.checkpoint
  }
  const closePlanHash = computeClosePlanHash({
    signalDate: revision.signalDate,
    tradeDate: revision.tradeDate,
    dataCutoffAt: revision.dataCutoffAt,
    ruleVersion: revision.ruleVersion,
    taxonomyVersion: revision.taxonomyVersion,
    closePlan: revision.closePlan,
  })
  if (revision.closePlanHash !== closePlanHash) errors.push('closePlanHash 不匹配')
  const sourceHash = computeSourceHash(revision.closePlan.sourceRefs)
  if (revision.sourceHash !== sourceHash) errors.push('sourceHash 不匹配')
  const evidenceHashes = computeEvidenceHashes(revision.closePlan.sourceRefs)
  if (
    revision.evidenceHashes.length !== evidenceHashes.length ||
    !evidenceHashes.every((hash, index) => hash === revision.evidenceHashes[index])
  ) {
    errors.push('evidenceHashes 不匹配')
  }
  const revisionContentHash = computeRevisionContentHash({
    closePlanHash: revision.closePlanHash,
    checkpoints: revision.checkpoints,
    outcome: revision.outcome,
    validation: revision.validation,
    warnings: revision.warnings,
  })
  if (revision.revisionContentHash !== revisionContentHash) errors.push('revisionContentHash 不匹配')
  const documentHash = computeDocumentHash(revision)
  if (revision.documentHash !== documentHash) errors.push('documentHash 不匹配')
  if (revision.supersedes && revision.revision <= 1) {
    errors.push('revision 1 不应存在 supersedes')
  }
  if (revision.supersedes && revision.supersedes.revision >= revision.revision) {
    errors.push('supersedes 指向非前序 revision')
  }
  return errors
}

export function isRelayDailyReviewValid(revision: RelayDailyReviewV1): boolean {
  return validateRelayDailyReview(revision).length === 0
}

function safeRelayDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function stableCheckpoints(checkpoints: readonly RelayCheckpoint[]): RelayCheckpoint[] {
  return [...checkpoints].sort((a, b) => {
    const pa = RELAY_REVIEW_CHECKPOINT_ORDER.indexOf(a.checkpoint)
    const pb = RELAY_REVIEW_CHECKPOINT_ORDER.indexOf(b.checkpoint)
    if (pa !== pb) return pa - pb
    if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? -1 : 1
    return 0
  })
}

function semanticClosePlan(closePlan: RelayClosePlan): RelayClosePlan {
  return {
    ...closePlan,
    themePlaybooks: sortBy(closePlan.themePlaybooks, (t) => t.themeId),
    lanePlaybooks: sortBy(closePlan.lanePlaybooks, (l) => l.lane),
    candidatePlaybooks: sortBy(closePlan.candidatePlaybooks, (c) => c.code),
    watchGraph: sortBy(
      closePlan.watchGraph,
      (e) => `${e.subject.kind}:${e.subject.id}|${e.target.kind}:${e.target.id}|${e.relation}`,
    ),
    sourceRefs: sortBy(
      closePlan.sourceRefs,
      (s) => `${s.sourceId}|${s.eventAt ?? ''}`,
    ),
  }
}

export interface ClosePlanHashInput {
  signalDate: string
  tradeDate: string
  dataCutoffAt: string
  ruleVersion: string
  taxonomyVersion: string
  closePlan: RelayClosePlan
}

/**
 * §8.7 closePlanHash: excludes generatedAt/storedAt/revision/supersedes and
 * ordering metadata. Only signalDate/tradeDate/dataCutoffAt/ruleVersion/
 * taxonomyVersion plus the frozen closePlan semantic projection participate.
 */
export function computeClosePlanHash(input: ClosePlanHashInput): string {
  return hashCanonical({
    signalDate: input.signalDate,
    tradeDate: input.tradeDate,
    dataCutoffAt: input.dataCutoffAt,
    ruleVersion: input.ruleVersion,
    taxonomyVersion: input.taxonomyVersion,
    closePlan: semanticClosePlan(input.closePlan),
  })
}

/** evidenceHash per source entry. */
export function computeSourceEvidenceHash(source: RelaySourceRef): string {
  return hashCanonical({
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    sourceRef: source.sourceRef,
    asof: source.asof,
    observedPhase: source.observedPhase,
    dataCutoffAt: source.dataCutoffAt,
    decisionAt: source.decisionAt,
    eventAt: source.eventAt ?? null,
    providerAt: source.providerAt ?? null,
    receivedAt: source.receivedAt,
    knownAt: source.knownAt,
    capturedAt: source.capturedAt,
    quality: source.quality,
    missingReasons: [...source.missingReasons].sort(),
  })
}

export function computeEvidenceHashes(sources: readonly RelaySourceRef[]): string[] {
  return sortBy(sources, (s) => `${s.sourceId}|${s.eventAt ?? ''}|${s.capturedAt}`)
    .map(computeSourceEvidenceHash)
}

export function computeSourceHash(sources: readonly RelaySourceRef[]): string {
  return hashCanonical({ evidenceHashes: computeEvidenceHashes(sources) })
}

export interface RevisionContentHashInput {
  closePlanHash: string
  checkpoints: readonly RelayCheckpoint[]
  outcome: RelayReviewOutcome | null
  validation: RelayReviewValidation
  warnings: readonly string[]
}

export function computeRevisionContentHash(input: RevisionContentHashInput): string {
  return hashCanonical({
    closePlanHash: input.closePlanHash,
    checkpoints: stableCheckpoints(input.checkpoints),
    outcome: input.outcome ?? null,
    validation: input.validation,
    warnings: [...input.warnings].sort(),
  })
}

/**
 * documentHash: a semantic hash of the entire revision content, intentionally
 * excluding the documentHash field itself and storedAt runtime metadata.
 */
export function computeDocumentHash(revision: RelayDailyReviewV1): string {
  const projection = {
    schemaVersion: revision.schemaVersion,
    reviewId: revision.reviewId,
    signalDate: revision.signalDate,
    tradeDate: revision.tradeDate,
    timezone: revision.timezone,
    phase: revision.phase,
    latestCheckpoint: revision.latestCheckpoint,
    decisionAt: revision.decisionAt,
    dataCutoffAt: revision.dataCutoffAt,
    generatedAt: revision.generatedAt,
    settled: revision.settled,
    revision: revision.revision,
    supersedes: revision.supersedes,
    strategyStatus: revision.strategyStatus,
    runtimePermission: revision.runtimePermission,
    validationStage: revision.validationStage,
    ruleVersion: revision.ruleVersion,
    taxonomyVersion: revision.taxonomyVersion,
    closePlanHash: revision.closePlanHash,
    sourceHash: revision.sourceHash,
    revisionContentHash: revision.revisionContentHash,
    evidenceHashes: [...revision.evidenceHashes].sort(),
    quality: revision.quality,
    closePlan: revision.closePlan,
    checkpoints: stableCheckpoints(revision.checkpoints),
    outcome: revision.outcome ?? null,
    validation: revision.validation,
    warnings: [...revision.warnings].sort(),
  }
  return hashCanonical(projection)
}

export interface RelayLanePermissionInput {
  marketGate: string
  lane: string
  populationSize: number
  effectiveN: number | null
  sourceCoveragePct: number | null
}

/**
 * Deterministic lane permission state machine. This is an engineering default;
 * it never grants real execution permission (executionEligible stays false).
 */
export function deriveLanePermission(input: RelayLanePermissionInput): RelayLanePermission {
  const missing = input.effectiveN === null || input.effectiveN <= 0
  const lowCoverage = input.sourceCoveragePct !== null && input.sourceCoveragePct < 80
  if (input.marketGate === 'frozen' || input.marketGate === 'restricted' || input.marketGate === 'exclude') {
    return 'exclude'
  }
  if (input.marketGate === 'unavailable' || missing) {
    return missing ? 'unavailable' : 'observe'
  }
  if (lowCoverage) return 'observe'
  if (input.populationSize <= 0) return 'unavailable'
  if (input.effectiveN !== null && input.effectiveN <= 4) return 'wait-confirm'
  if (input.effectiveN !== null && input.effectiveN >= 5 && !lowCoverage) return 'research-relay'
  return 'observe'
}

export interface BuildRelayClosePlanInput {
  reviewId: string
  signalDate: string
  tradeDate: string
  /** decisionAt must be >= every source decisionAt and >= dataCutoffAt. */
  decisionAt: string
  dataCutoffAt: string
  generatedAt: string
  ruleVersion: string
  taxonomyVersion: string
  strategyStatus: RelayDailyReviewV1['strategyStatus']
  validationStage: RelayReviewValidation['stage']
  marketRegime: string
  marketGate: string
  sentiment: string
  themePlaybooks?: RelayThemePlaybook[]
  lanePlaybooks?: RelayLanePlaybook[]
  candidatePlaybooks?: RelayCandidatePlaybook[]
  watchGraph?: RelayFeedbackEdge[]
  sourceRefs?: RelaySourceRef[]
  quality?: Partial<RelayReviewQuality>
  warnings?: string[]
}

export function buildRelayClosePlan(input: BuildRelayClosePlanInput): RelayDailyReviewV1 {
  const closePlan: RelayClosePlan = {
    marketRegime: input.marketRegime,
    marketGate: input.marketGate,
    sentiment: input.sentiment,
    rotationSnapshot: {
      asof: input.signalDate,
      sourceRefs: [],
      taxonomyVersion: input.taxonomyVersion,
      archiveAvailable: false,
      warnings: ['rotation 归档缺失，本轮采用 unavailable'],
    },
    themePlaybooks: input.themePlaybooks ?? [],
    lanePlaybooks: input.lanePlaybooks ?? [],
    candidatePlaybooks: input.candidatePlaybooks ?? [],
    watchGraph: input.watchGraph ?? [],
    sourceRefs: sortBy(input.sourceRefs ?? [], (s) => `${s.sourceId}|${s.eventAt ?? ''}`),
  }
  const sourceCount = closePlan.sourceRefs.length
  const aggregatedQuality = aggregateRelaySourceQuality({ sourceRefs: closePlan.sourceRefs })
  const quality: RelayReviewQuality = {
    ...aggregatedQuality,
    ...input.quality,
    sourceCount,
  }
  const closePlanHash = computeClosePlanHash({
    signalDate: input.signalDate,
    tradeDate: input.tradeDate,
    dataCutoffAt: input.dataCutoffAt,
    ruleVersion: input.ruleVersion,
    taxonomyVersion: input.taxonomyVersion,
    closePlan,
  })
  const sourceHash = computeSourceHash(closePlan.sourceRefs)
  const validation: RelayReviewValidation = {
    stage: input.validationStage,
    ruleVersion: input.ruleVersion,
    featureVersion: input.ruleVersion,
    taxonomyVersion: input.taxonomyVersion,
    fillVersion: 'n/a',
    datasetHash: null,
    metrics: {},
    failedChecks: [],
  }
  const warnings = [...new Set(input.warnings ?? [])]
  const revisionContentHash = computeRevisionContentHash({
    closePlanHash,
    checkpoints: [],
    outcome: null,
    validation,
    warnings,
  })
  const documentHash = ''
  const revision: RelayDailyReviewV1 = {
    schemaVersion: 'relay-daily-review-v1',
    reviewId: input.reviewId,
    signalDate: input.signalDate,
    tradeDate: input.tradeDate,
    timezone: 'Asia/Shanghai',
    phase: 'close-plan',
    latestCheckpoint: 'close-plan',
    decisionAt: input.decisionAt,
    dataCutoffAt: input.dataCutoffAt,
    generatedAt: input.generatedAt,
    storedAt: input.generatedAt,
    settled: false,
    revision: 1,
    supersedes: null,
    strategyStatus: input.strategyStatus,
    runtimePermission: 'research-only',
    validationStage: input.validationStage,
    ruleVersion: input.ruleVersion,
    taxonomyVersion: input.taxonomyVersion,
    closePlanHash,
    sourceHash,
    revisionContentHash,
    documentHash,
    evidenceHashes: computeEvidenceHashes(closePlan.sourceRefs),
    quality,
    closePlan,
    checkpoints: [],
    outcome: null,
    validation,
    warnings,
  }
  return { ...revision, documentHash: computeDocumentHash(revision) }
}

export interface ProjectRelayCheckpointInput {
  signalDate: string
  tradeDate: string
  checkpoint: RelayReviewCheckpoint
  observedAt: string
  decisionAt: string
  dataCutoffAt: string
  sourceRefs: RelaySourceRef[]
  quality?: Partial<Omit<RelayReviewQuality, 'status'>>
  warnings?: string[]
}

/**
 * Project a new checkpoint onto a frozen close plan. It only reads the plan; it
 * does not write. The next revision's hash is recomputed but revnumbering is left
 * to the store.
 */
export function projectRelayCheckpoint(
  current: RelayDailyReviewV1,
  input: ProjectRelayCheckpointInput,
): RelayDailyReviewV1 {
  if (input.signalDate !== current.signalDate || input.tradeDate !== current.tradeDate) {
    throw new Error('checkpoint signalDate/tradeDate 与冻结 close plan 不一致')
  }
  const cpIndex = RELAY_REVIEW_CHECKPOINT_ORDER.indexOf(input.checkpoint)
  const latestIndex = RELAY_REVIEW_CHECKPOINT_ORDER.indexOf(current.latestCheckpoint)
  if (cpIndex < 0) throw new Error(`未知检查点: ${input.checkpoint}`)
  if (cpIndex <= latestIndex) {
    throw new Error(`检查点不可回退: ${current.latestCheckpoint} -> ${input.checkpoint}`)
  }
  if (input.dataCutoffAt > input.decisionAt) {
    throw new Error('dataCutoffAt 不得晚于 decisionAt')
  }
  if (compareIsoTimes(input.dataCutoffAt, input.decisionAt) > 0) {
    throw new Error('dataCutoffAt 不得晚于 decisionAt')
  }
  for (const source of input.sourceRefs) {
    if (source.eventAt && compareIsoTimes(source.eventAt, source.dataCutoffAt) > 0) {
      throw new Error(`eventAt 晚于 dataCutoffAt: ${source.sourceId}`)
    }
    if (source.providerAt && compareIsoTimes(source.providerAt, source.dataCutoffAt) > 0) {
      throw new Error(`providerAt 晚于 dataCutoffAt: ${source.sourceId}`)
    }
    if (compareIsoTimes(source.receivedAt, source.decisionAt) > 0) {
      throw new Error(`receivedAt 晚于 decisionAt: ${source.sourceId}`)
    }
    if (compareIsoTimes(source.knownAt, source.decisionAt) > 0) {
      throw new Error(`knownAt 晚于 decisionAt: ${source.sourceId}`)
    }
    if (compareIsoTimes(source.capturedAt, source.decisionAt) > 0) {
      throw new Error(`capturedAt 晚于 decisionAt: ${source.sourceId}`)
    }
    if (compareIsoTimes(source.dataCutoffAt, source.decisionAt) > 0) {
      throw new Error(`dataCutoffAt 晚于 decisionAt: ${source.sourceId}`)
    }
  }
  const entry: RelayCheckpoint = {
    checkpoint: input.checkpoint,
    phase: phaseOfRelayCheckpoint(input.checkpoint),
    observedAt: input.observedAt,
    dataCutoffAt: input.dataCutoffAt,
    decisionAt: input.decisionAt,
    sourceRefs: sourceRefsSorted(input.sourceRefs),
    quality: {
      ...aggregateRelaySourceQuality({ sourceRefs: input.sourceRefs }),
      ...input.quality,
      sourceCount: input.sourceRefs.length,
    },
    warnings: [...new Set(input.warnings ?? [])],
  }
  const checkpoints = [...current.checkpoints, entry]
  const phase = phaseOfRelayCheckpoint(input.checkpoint)
  const warnings = [...new Set([...current.warnings, ...entry.warnings])]
  const revisionContentHash = computeRevisionContentHash({
    closePlanHash: current.closePlanHash,
    checkpoints,
    outcome: current.outcome,
    validation: current.validation,
    warnings,
  })
  const projected: RelayDailyReviewV1 = {
    ...current,
    phase,
    latestCheckpoint: input.checkpoint,
    // Top-level dataCutoffAt/decisionAt stay frozen from the close-plan
    // contract; each checkpoint entry carries its own observedAt/decisionAt.
    settled: input.checkpoint === 'settled' || input.checkpoint === 'exit-settled',
    closePlanHash: current.closePlanHash,
    revisionContentHash,
    checkpoints,
    evidenceHashes: [...current.evidenceHashes].sort(),
    warnings,
  }
  return { ...projected, documentHash: computeDocumentHash(projected) }
}

export function isFrozenClosePlan(revision: RelayDailyReviewV1): boolean {
  return Boolean(
    revision.revision >= 1 &&
      revision.latestCheckpoint === 'close-plan' &&
      revision.phase === 'close-plan',
  )
}

export function validateSchedulerCheckpointMapping(): void {
  const checkpoints: SchedulerCheckpoint[] = [
    'overnight-context', 'asia-open', 'asia-0830', 'asia-0900', 'pre-auction',
    'auction-initial', 'auction-probe', 'auction-prelock', 'auction-lock',
    'auction-locked-mid', 'auction-prefinal', 'auction-final', 'open-initial',
    'open-confirm', 'settled',
  ]
  for (const checkpoint of checkpoints) {
    const cp = checkpointSpec(checkpoint).checkpoint
    if (!RELAY_REVIEW_CHECKPOINT_ORDER.includes(cp as RelayReviewCheckpoint)) {
      throw new Error(`scheduler checkpoint 未映射到 relay review: ${cp}`)
    }
  }
}

/**
 * Canonical stringify used by tests and debugging to assert stable key ordering.
 * Pass-through for the hash-spec helpers above.
 */
export { canonicalStringify as canonicalJsonSnapshot }