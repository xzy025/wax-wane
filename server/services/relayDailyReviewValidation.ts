import {
  aggregateRelaySourceQuality,
  aggregateRelayRevisionQuality,
  collectRelaySourceRefs,
  compareIsoTimes,
  computeClosePlanHash,
  computeDocumentHash,
  computeEvidenceHashes,
  computeRevisionContentHash,
  computeSourceHash,
  isIsoTime,
  isRelayCheckpointKnown,
  RELAY_REVIEW_CHECKPOINT_ORDER,
} from './relayDailyReviewBuilder'
import { phaseOfRelayCheckpoint, type RelayDailyReviewV1, type RelaySourceRef } from './relayDailyReviewTypes'

export interface RelayDailyReviewValidationOptions {
  expectedRevision?: number
  previous?: RelayDailyReviewV1 | null
}

const SOURCE_QUALITIES = new Set<RelaySourceRef['quality']>([
  'formal',
  'shadow',
  'degraded',
  'legacy-unverified',
  'unavailable',
])

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function sameArray(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function containsSortedArray(actual: readonly string[], expected: readonly string[]): boolean {
  const actualSorted = [...actual].sort()
  const expectedSorted = [...expected].sort()
  return expectedSorted.every((value) => actualSorted.includes(value))
}

function validateSource(source: RelaySourceRef, label: string, errors: string[]): void {
  if (!source || typeof source !== 'object') {
    errors.push(`${label} 必须是对象`)
    return
  }
  for (const field of [
    'sourceId', 'sourceType', 'sourceRef', 'asof', 'observedPhase', 'dataCutoffAt',
    'decisionAt', 'receivedAt', 'knownAt', 'capturedAt', 'sourceHash', 'quality',
  ] as const) {
    if (typeof source[field] !== 'string' || source[field].length === 0) {
      errors.push(`${label}.${field} 缺失或非法`)
    }
  }
  if (!validDate(source.asof)) errors.push(`${label}.asof 非法`)
  if (!isRelayCheckpointKnown(source.observedPhase)) errors.push(`${label}.observedPhase 非法`)
  if (!SOURCE_QUALITIES.has(source.quality)) errors.push(`${label}.quality 非法`)
  if (!Array.isArray(source.missingReasons)) errors.push(`${label}.missingReasons 非法`)

  for (const field of ['dataCutoffAt', 'decisionAt', 'receivedAt', 'knownAt', 'capturedAt'] as const) {
    if (!isIsoTime(source[field])) errors.push(`${label}.${field} 非法`)
  }
  for (const field of ['eventAt', 'providerAt'] as const) {
    if (source[field] !== null && !isIsoTime(source[field])) errors.push(`${label}.${field} 非法`)
  }
  if (source.eventAt !== null && isIsoTime(source.eventAt) && isIsoTime(source.dataCutoffAt) && compareIsoTimes(source.eventAt, source.dataCutoffAt) > 0) {
    errors.push(`${label}.eventAt 晚于 dataCutoffAt`)
  }
  if (source.providerAt !== null && isIsoTime(source.providerAt) && isIsoTime(source.dataCutoffAt) && compareIsoTimes(source.providerAt, source.dataCutoffAt) > 0) {
    errors.push(`${label}.providerAt 晚于 dataCutoffAt`)
  }
  for (const field of ['receivedAt', 'knownAt', 'capturedAt', 'dataCutoffAt'] as const) {
    if (isIsoTime(source[field]) && isIsoTime(source.decisionAt) && compareIsoTimes(source[field], source.decisionAt) > 0) {
      errors.push(`${label}.${field} 晚于 decisionAt`)
    }
  }
}

function validateQuality(
  actual: RelayDailyReviewV1['quality'] | undefined,
  sources: readonly RelaySourceRef[],
  label: string,
  errors: string[],
): void {
  if (!actual || typeof actual !== 'object') {
    errors.push(`${label} 必须是对象`)
    return
  }
  if (!Array.isArray(actual.missingLayers) || !Array.isArray(actual.warnings)) {
    errors.push(`${label}.missingLayers/warnings 必须是数组`)
    return
  }
  const expected = aggregateRelaySourceQuality({ sourceRefs: sources })
  if (actual.status !== expected.status) errors.push(`${label}.status 与来源不一致`)
  if (actual.pointInTime !== expected.pointInTime) errors.push(`${label}.pointInTime 与来源不一致`)
  if (actual.coveragePct !== expected.coveragePct) errors.push(`${label}.coveragePct 与来源不一致`)
  if (actual.sourceCount !== sources.length) errors.push(`${label}.sourceCount 与来源不一致`)
  if (!containsSortedArray(actual.missingLayers, expected.missingLayers)) errors.push(`${label}.missingLayers 与来源不一致`)
  if (!containsSortedArray(actual.warnings, expected.warnings)) errors.push(`${label}.warnings 与来源不一致`)
}

/**
 * Independent fail-closed validator for persisted relay review revisions.
 * Store code supplies the expected filename revision and previous revision so
 * the validator can verify both content hashes and the append-only chain.
 */
export function validateRelayDailyReviewRevision(
  revision: RelayDailyReviewV1,
  options: RelayDailyReviewValidationOptions = {},
): string[] {
  if (!revision || typeof revision !== 'object') return ['revision 必须是对象']
  const candidate = revision as unknown as Record<string, unknown>
  const errors: string[] = []
  if (candidate.schemaVersion !== 'relay-daily-review-v1') errors.push('schemaVersion 非法')
  if (!validDate(candidate.signalDate)) errors.push(`signalDate 非法: ${String(candidate.signalDate)}`)
  if (!validDate(candidate.tradeDate)) errors.push(`tradeDate 非法: ${String(candidate.tradeDate)}`)
  if (candidate.timezone !== 'Asia/Shanghai') errors.push('timezone 非法')
  if (typeof candidate.reviewId !== 'string' || candidate.reviewId.length === 0) errors.push('reviewId 缺失')
  if (!Number.isInteger(candidate.revision) || Number(candidate.revision) < 1) errors.push('revision 非法')
  if (options.expectedRevision !== undefined && candidate.revision !== options.expectedRevision) {
    errors.push(`revision 与文件名不一致: ${String(candidate.revision)} != ${options.expectedRevision}`)
  }
  if (candidate.runtimePermission !== 'research-only') errors.push('runtimePermission 非法')

  for (const field of ['decisionAt', 'dataCutoffAt', 'generatedAt', 'storedAt'] as const) {
    if (!isIsoTime(revision[field])) errors.push(`时间字段非法: ${field}`)
  }
  if (isIsoTime(revision.dataCutoffAt) && isIsoTime(revision.decisionAt) && compareIsoTimes(revision.dataCutoffAt, revision.decisionAt) > 0) {
    errors.push('顶层 dataCutoffAt 不得晚于 decisionAt')
  }

  const checkpoints = Array.isArray(candidate.checkpoints) ? revision.checkpoints : []
  if (!Array.isArray(candidate.checkpoints)) errors.push('checkpoints 必须是数组')
  let previousCheckpointIndex = -1
  let previousEntry: RelayDailyReviewV1['checkpoints'][number] | null = null
  for (const [index, entry] of checkpoints.entries()) {
    const label = `checkpoints[${index}]`
    if (!entry || !isRelayCheckpointKnown(entry.checkpoint)) {
      errors.push(`${label}.checkpoint 非法`)
      continue
    }
    const checkpointIndex = RELAY_REVIEW_CHECKPOINT_ORDER.indexOf(entry.checkpoint)
    if (checkpointIndex <= previousCheckpointIndex) errors.push(`检查点顺序非法: ${entry.checkpoint}`)
    previousCheckpointIndex = checkpointIndex
    if (entry.phase !== phaseOfRelayCheckpoint(entry.checkpoint)) errors.push(`${label}.phase 不匹配`)
    for (const field of ['observedAt', 'dataCutoffAt', 'decisionAt'] as const) {
      if (!isIsoTime(entry[field])) errors.push(`${label}.${field} 非法`)
    }
    if (isIsoTime(entry.observedAt) && isIsoTime(entry.decisionAt) && compareIsoTimes(entry.observedAt, entry.decisionAt) > 0) {
      errors.push(`${label}.observedAt 晚于 decisionAt`)
    }
    if (isIsoTime(entry.dataCutoffAt) && isIsoTime(entry.decisionAt) && compareIsoTimes(entry.dataCutoffAt, entry.decisionAt) > 0) {
      errors.push(`${label}.dataCutoffAt 晚于 decisionAt`)
    }
    if (previousEntry && isIsoTime(entry.decisionAt) && isIsoTime(previousEntry.decisionAt) && compareIsoTimes(entry.decisionAt, previousEntry.decisionAt) < 0) {
      errors.push(`检查点时间倒退: ${previousEntry.checkpoint} -> ${entry.checkpoint}`)
    }
    if (!Array.isArray(entry.sourceRefs)) errors.push(`${label}.sourceRefs 必须是数组`)
    else entry.sourceRefs.forEach((source, sourceIndex) => validateSource(source, `${label}.sourceRefs[${sourceIndex}]`, errors))
    validateQuality(entry.quality, Array.isArray(entry.sourceRefs) ? entry.sourceRefs : [], `${label}.quality`, errors)
    previousEntry = entry
  }

  const expectedLatest = checkpoints.at(-1)?.checkpoint ?? 'close-plan'
  if (revision.latestCheckpoint !== expectedLatest) errors.push('latestCheckpoint 与 checkpoints 不一致')
  if (!isRelayCheckpointKnown(revision.latestCheckpoint)) errors.push('latestCheckpoint 非法')
  if (isRelayCheckpointKnown(revision.latestCheckpoint) && revision.phase !== phaseOfRelayCheckpoint(revision.latestCheckpoint)) {
    errors.push('顶层 phase 与 latestCheckpoint 不一致')
  }
  const expectedSettled = revision.latestCheckpoint === 'settled' || revision.latestCheckpoint === 'exit-settled'
  if (revision.settled !== expectedSettled) errors.push('settled 与 latestCheckpoint 不一致')

  if (!revision.validation || revision.validation.stage !== revision.validationStage) errors.push('validationStage 与 validation.stage 不一致')
  if (revision.validation?.ruleVersion !== revision.ruleVersion) errors.push('validation.ruleVersion 不一致')
  if (revision.validation?.taxonomyVersion !== revision.taxonomyVersion) errors.push('validation.taxonomyVersion 不一致')

  if (!revision.closePlan || !Array.isArray(revision.closePlan.sourceRefs)) {
    errors.push('closePlan/sourceRefs 非法')
  } else {
    revision.closePlan.sourceRefs.forEach((source, index) => validateSource(source, `closePlan.sourceRefs[${index}]`, errors))
  }
  const aggregationCheckpoints = checkpoints.filter((entry) =>
    entry && typeof entry === 'object' && Array.isArray(entry.sourceRefs),
  )
  const aggregationRevision = revision.closePlan && Array.isArray(revision.closePlan.sourceRefs)
    ? { closePlan: revision.closePlan, checkpoints: aggregationCheckpoints }
    : null
  const allSources = aggregationRevision
    ? collectRelaySourceRefs(aggregationRevision)
    : []
  if (aggregationRevision) {
    const expectedRevisionQuality = aggregateRelayRevisionQuality(aggregationRevision)
    if (!revision.quality || typeof revision.quality !== 'object') {
      errors.push('quality 必须是对象')
    } else {
      if (revision.quality.status !== expectedRevisionQuality.status) errors.push('quality.status 与质量层不一致')
      if (revision.quality.pointInTime !== expectedRevisionQuality.pointInTime) errors.push('quality.pointInTime 与质量层不一致')
      if (revision.quality.coveragePct !== expectedRevisionQuality.coveragePct) errors.push('quality.coveragePct 与质量层不一致')
      if (revision.quality.sourceCount !== expectedRevisionQuality.sourceCount) errors.push('quality.sourceCount 与质量层不一致')
      if (!containsSortedArray(revision.quality.missingLayers, expectedRevisionQuality.missingLayers)) errors.push('quality.missingLayers 与质量层不一致')
      if (!containsSortedArray(revision.quality.warnings, expectedRevisionQuality.warnings)) errors.push('quality.warnings 与质量层不一致')
    }
  }
  try {
    const closePlanHash = computeClosePlanHash({
      signalDate: revision.signalDate,
      tradeDate: revision.tradeDate,
      dataCutoffAt: revision.dataCutoffAt,
      ruleVersion: revision.ruleVersion,
      taxonomyVersion: revision.taxonomyVersion,
      closePlan: revision.closePlan,
    })
    if (revision.closePlanHash !== closePlanHash) errors.push('closePlanHash 不匹配')
    const sourceHash = computeSourceHash(allSources)
    if (revision.sourceHash !== sourceHash) errors.push('sourceHash 不匹配')
    const evidenceHashes = computeEvidenceHashes(allSources)
    if (!sameArray([...revision.evidenceHashes].sort(), [...evidenceHashes].sort())) errors.push('evidenceHashes 不匹配')
    const revisionContentHash = computeRevisionContentHash({
      closePlanHash: revision.closePlanHash,
      checkpoints: revision.checkpoints,
      outcome: revision.outcome,
      validation: revision.validation,
      warnings: revision.warnings,
    })
    if (revision.revisionContentHash !== revisionContentHash) errors.push('revisionContentHash 不匹配')
    if (revision.documentHash !== computeDocumentHash(revision)) errors.push('documentHash 不匹配')
  } catch (error) {
    errors.push(`hash 校验异常: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (revision.revision === 1 && revision.supersedes !== null) errors.push('revision 1 不应存在 supersedes')
  if (revision.revision > 1 && !revision.supersedes) errors.push('revision > 1 必须存在 supersedes')
  if (revision.supersedes && options.previous) {
    if (revision.supersedes.revision !== options.previous.revision || revision.supersedes.documentHash !== options.previous.documentHash) {
      errors.push('supersedes 未精确指向前一 revision')
    }
  }
  if (revision.supersedes && revision.supersedes.revision >= revision.revision) errors.push('supersedes 指向非前序 revision')
  return Array.from(new Set(errors))
}

export function isRelayDailyReviewRevisionValid(
  revision: RelayDailyReviewV1,
  options: RelayDailyReviewValidationOptions = {},
): boolean {
  return validateRelayDailyReviewRevision(revision, options).length === 0
}
