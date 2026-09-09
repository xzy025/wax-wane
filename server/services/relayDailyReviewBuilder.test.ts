import { describe, expect, it } from 'vitest'
import { validateRelayDailyReviewRevision } from './relayDailyReviewValidation'
import {
  aggregateRelaySourceQuality,
  buildRelayClosePlan,
  compareIsoTimes,
  computeEvidenceHashes,
  computeRevisionContentHash,
  computeSourceHash,
  deriveLanePermission,
  isRelayDailyReviewValid,
  projectRelayCheckpoint,
  validateRelayDailyReview,
  validateSchedulerCheckpointMapping,
  type BuildRelayClosePlanInput,
} from './relayDailyReviewBuilder'

const baseInput: BuildRelayClosePlanInput = {
  reviewId: 'relay-review-2026-08-28-2026-08-31',
  signalDate: '2026-08-28',
  tradeDate: '2026-08-31',
  decisionAt: '2026-08-28T15:10:00+08:00',
  dataCutoffAt: '2026-08-28T15:10:00+08:00',
  generatedAt: '2026-08-28T15:10:01+08:00',
  ruleVersion: 'limit-ladder-v7',
  taxonomyVersion: 'relay-theme-taxonomy-v1',
  strategyStatus: 'research',
  validationStage: 'shadow',
  marketRegime: 'fixture',
  marketGate: 'normal',
  sentiment: 'fixture',
  sourceRefs: [
    {
      sourceId: 's2',
      sourceType: 'ladder',
      sourceRef: 'archive/2026-08-28',
      asof: '2026-08-28',
      observedPhase: 'close-plan',
      dataCutoffAt: '2026-08-28T15:10:00+08:00',
      decisionAt: '2026-08-28T15:10:00+08:00',
      eventAt: '2026-08-28T15:00:00+08:00',
      providerAt: '2026-08-28T15:05:00+08:00',
      receivedAt: '2026-08-28T15:08:00+08:00',
      knownAt: '2026-08-28T15:08:00+08:00',
      capturedAt: '2026-08-28T15:09:00+08:00',
      sourceHash: 'abc',
      quality: 'formal',
      missingReasons: [],
    },
    {
      sourceId: 's1',
      sourceType: 'rotation',
      sourceRef: 'tempo/2026-08-28',
      asof: '2026-08-28',
      observedPhase: 'close-plan',
      dataCutoffAt: '2026-08-28T15:10:00+08:00',
      decisionAt: '2026-08-28T15:10:00+08:00',
      eventAt: '2026-08-28T15:00:00+08:00',
      providerAt: null,
      receivedAt: '2026-08-28T15:06:00+08:00',
      knownAt: '2026-08-28T15:06:00+08:00',
      capturedAt: '2026-08-28T15:07:00+08:00',
      sourceHash: 'def',
      quality: 'formal',
      missingReasons: [],
    },
  ],
}

describe('relay daily review builder', () => {
  it('freezes a deterministic close plan with stable, well-formed hashes', () => {
    const plan = buildRelayClosePlan(baseInput)
    expect(plan.schemaVersion).toBe('relay-daily-review-v1')
    expect(plan.phase).toBe('close-plan')
    expect(plan.settled).toBe(false)
    expect(plan.closePlanHash).toMatch(/^[a-f0-9]{64}$/)
    expect(plan.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(plan.revisionContentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(plan.documentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('recomputes the same hashes from the resequenced same content', () => {
    const a = buildRelayClosePlan(baseInput)
    const shuffled: BuildRelayClosePlanInput = {
      ...baseInput,
      sourceRefs: [...(baseInput.sourceRefs ?? [])].reverse(),
    }
    const b = buildRelayClosePlan(shuffled)
    expect(b.sourceHash).toBe(a.sourceHash)
    expect(b.documentHash).toBe(a.documentHash)
    expect(b.closePlanHash).toBe(a.closePlanHash)
  })

  it('changes the hash when a source or rule version changes (supersede becomes new revision)', () => {
    const a = buildRelayClosePlan(baseInput)
    const b = buildRelayClosePlan({ ...baseInput, ruleVersion: 'limit-ladder-v8' })
    expect(b.closePlanHash).not.toBe(a.closePlanHash)
    expect(b.revisionContentHash).not.toBe(a.revisionContentHash)
  })

  it('ignores generatedAt/storedAt/revision/display ordering in semantic hashes', () => {
    const a = buildRelayClosePlan(baseInput)
    const b = buildRelayClosePlan({
      ...baseInput,
      generatedAt: '2026-08-28T15:20:00+08:00',
    })
    expect(b.closePlanHash).toBe(a.closePlanHash)
    expect(b.revisionContentHash).toBe(a.revisionContentHash)
    // revision/storedAt/generatedAt are runtime metadata; closePlanHash and
    // revisionContentHash must not depend on them.
    const withGenerated = { ...a, generatedAt: '2026-08-28T15:20:00+08:00' }
    expect(computeRevisionContentHash({
      closePlanHash: withGenerated.closePlanHash,
      checkpoints: withGenerated.checkpoints,
      outcome: withGenerated.outcome,
      validation: withGenerated.validation,
      warnings: withGenerated.warnings,
    })).toBe(a.revisionContentHash)
    // Display ordering of sources does not change the source hash.
    const shuffled = buildRelayClosePlan({
      ...baseInput,
      sourceRefs: [...(baseInput.sourceRefs ?? [])].reverse(),
    })
    expect(computeSourceHash(shuffled.closePlan.sourceRefs)).toBe(computeSourceHash(a.closePlan.sourceRefs))
  })

  it('projects an auction checkpoint onto the frozen plan without writing', () => {
    const plan = buildRelayClosePlan(baseInput)
    const projected = projectRelayCheckpoint(plan, {
      signalDate: plan.signalDate,
      tradeDate: plan.tradeDate,
      checkpoint: 'auction-final',
      observedAt: '2026-08-31T09:25:05+08:00',
      decisionAt: '2026-08-31T09:25:06+08:00',
      dataCutoffAt: '2026-08-31T09:25:05+08:00',
      sourceRefs: [{
        sourceId: 'auction-pub',
        sourceType: 'auction',
        sourceRef: 'collective-auction',
        asof: '2026-08-31',
        observedPhase: 'auction-final',
        dataCutoffAt: '2026-08-31T09:25:05+08:00',
        decisionAt: '2026-08-31T09:25:06+08:00',
        eventAt: null,
        providerAt: null,
        receivedAt: '2026-08-31T09:25:05+08:00',
        knownAt: '2026-08-31T09:25:05+08:00',
        capturedAt: '2026-08-31T09:25:05+08:00',
        sourceHash: 'auction',
        quality: 'formal',
        missingReasons: [],
      }],
    })
    expect(projected.latestCheckpoint).toBe('auction-final')
    expect(projected.phase).toBe('auction')
    expect(projected.closePlanHash).toBe(plan.closePlanHash)
    expect(projected.revisionContentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(projected.evidenceHashes).toHaveLength(plan.evidenceHashes.length + 1)
    expect(projected.sourceHash).not.toBe(plan.sourceHash)
    expect(validateRelayDailyReviewRevision(projected, { expectedRevision: 1 })).toEqual([])
  })

  it('does not keep revision quality formal when a required checkpoint has no source', () => {
    const plan = buildRelayClosePlan(baseInput)
    const projected = projectRelayCheckpoint(plan, {
      signalDate: plan.signalDate,
      tradeDate: plan.tradeDate,
      checkpoint: 'auction-final',
      observedAt: '2026-08-31T09:25:05+08:00',
      decisionAt: '2026-08-31T09:25:06+08:00',
      dataCutoffAt: '2026-08-31T09:25:05+08:00',
      sourceRefs: [],
    })
    expect(projected.quality.status).toBe('degraded')
    expect(projected.quality.pointInTime).toBe(false)
    expect(validateRelayDailyReviewRevision(projected, { expectedRevision: 1 })).toEqual([])
  })

  it('rejects regressions and time-order violations fail-closed', () => {
    const plan = buildRelayClosePlan(baseInput)
    expect(() => projectRelayCheckpoint(plan, {
      signalDate: plan.signalDate,
      tradeDate: plan.tradeDate,
      checkpoint: 'close-plan',
      observedAt: '2026-08-31T00:00:00+08:00',
      decisionAt: plan.decisionAt,
      dataCutoffAt: plan.dataCutoffAt,
      sourceRefs: [],
    })).toThrow(/回退/)
    const firstSource = (baseInput.sourceRefs ?? [])[0]
    if (!firstSource) throw new Error('test requires sourceRefs')
    const late = {
      ...firstSource,
      capturedAt: '2026-08-31T15:11:00+08:00', // later than decisionAt
    }
    expect(() => projectRelayCheckpoint(plan, {
      signalDate: plan.signalDate,
      tradeDate: plan.tradeDate,
      checkpoint: 'open-confirm',
      observedAt: '2026-08-31T09:35:00+08:00',
      decisionAt: '2026-08-31T09:35:02+08:00',
      dataCutoffAt: '2026-08-31T09:35:00+08:00',
      sourceRefs: [late],
    })).toThrow(/capturedAt 晚于 decisionAt/)
  })

  it('rejects signalDate/tradeDate mixing', () => {
    const plan = buildRelayClosePlan(baseInput)
    expect(() => projectRelayCheckpoint(plan, {
      signalDate: '2026-08-29', // chopped to a different signalDate
      tradeDate: plan.tradeDate,
      checkpoint: 'open-confirm',
      observedAt: '2026-08-31T09:35:00+08:00',
      decisionAt: '2026-08-31T09:35:02+08:00',
      dataCutoffAt: '2026-08-31T09:35:00+08:00',
      sourceRefs: [],
    })).toThrow(/signalDate\/tradeDate 与冻结 close plan 不一致/)
  })

  it('duplicates unwrapped evidence hashes by business key but not by insertion order', () => {
    const sources = baseInput.sourceRefs ?? []
    const a = computeEvidenceHashes(sources)
    const b = computeEvidenceHashes([...sources].reverse())
    expect(a).toEqual(b)
    expect(a.length).toBe(2)
  })

  it('derives lane permissions deterministically', () => {
    expect(deriveLanePermission({ marketGate: 'normal', lane: '1-2', populationSize: 8, effectiveN: 12, sourceCoveragePct: 100 })).toBe('research-relay')
    expect(deriveLanePermission({ marketGate: 'frozen', lane: '1-2', populationSize: 8, effectiveN: 12, sourceCoveragePct: 100 })).toBe('exclude')
    expect(deriveLanePermission({ marketGate: 'normal', lane: '3-4', populationSize: 3, effectiveN: 2, sourceCoveragePct: 100 })).toBe('wait-confirm')
    expect(deriveLanePermission({ marketGate: 'normal', lane: '3-4', populationSize: 3, effectiveN: null, sourceCoveragePct: 100 })).toBe('unavailable')
  })

  it('maps every scheduler checkpoint to the relay review enum', () => {
    expect(() => validateSchedulerCheckpointMapping()).not.toThrow()
  })

  it('aggregates quality from sourceRefs instead of promoting on count (WP3.1)', () => {
    const sources = baseInput.sourceRefs ?? []
    const firstSource = sources[0]
    if (!firstSource) throw new Error('test requires sourceRefs')
    const base = (overrides: Partial<BuildRelayClosePlanInput> = {}) => buildRelayClosePlan({ ...baseInput, ...overrides })
    // No sources → unavailable, never formal.
    const empty = base({ sourceRefs: [] })
    expect(empty.quality.status).toBe('unavailable')
    expect(empty.quality.coveragePct).toBeNull()
    // degraded source → degraded, never formal/100%.
    const degraded = base({
      sourceRefs: [{
        ...firstSource,
        quality: 'degraded' as const,
      }],
    })
    expect(degraded.quality.status).toBe('degraded')
    expect(degraded.quality.coveragePct).not.toBe(100)
    expect(degraded.quality.pointInTime).toBe(false)
    // shadow source must not be promoted to formal.
    const shadow = base({
      sourceRefs: [{
        ...firstSource,
        quality: 'shadow' as const,
      }],
    })
    expect(shadow.quality.status).toBe('partial')
    expect(shadow.quality.pointInTime).toBe(false)
  })

  it('aggregates quality with partial formal coverage (WP3.1)', () => {
    const sources = baseInput.sourceRefs ?? []
    const firstSource = sources[0]
    if (!firstSource) throw new Error('test requires sourceRefs')
    const quality = aggregateRelaySourceQuality({
      sourceRefs: [
        { ...firstSource, quality: 'formal' },
        { ...firstSource, quality: 'unavailable' },
      ],
    })
    expect(quality.status).toBe('degraded')
    expect(quality.sourceCount).toBe(2)
  })

  it('compares ISO timestamps across timezone offsets (WP3.1)', () => {
    const sameInstant = compareIsoTimes('2026-08-31T09:25:05+08:00', '2026-08-31T01:25:05Z')
    expect(sameInstant).toBe(0)
    expect(compareIsoTimes('2026-08-31T09:25:05+08:00', '2026-08-31T09:25:04+08:00')).toBeGreaterThan(0)
    expect(() => compareIsoTimes('not-a-date', '2026-08-31')).toThrow(/非法 ISO/)
  })

  it('rejects impossible calendar dates and makes sourceHash sensitive to sourceHash', () => {
    const impossibleDate = buildRelayClosePlan({ ...baseInput, signalDate: '2026-02-30' })
    expect(validateRelayDailyReviewRevision(impossibleDate, { expectedRevision: 1 })).toContain('signalDate 非法: 2026-02-30')
    const source = baseInput.sourceRefs?.[0]
    if (!source) throw new Error('test requires sourceRefs')
    expect(computeSourceHash([{ ...source, sourceHash: 'different' }])).not.toBe(computeSourceHash([source]))
  })

  it('validates a pristine plan and rejects a tampered one (WP3.1)', () => {
    const plan = buildRelayClosePlan(baseInput)
    expect(isRelayDailyReviewValid(plan)).toBe(true)
    const tampered = {
      ...plan,
      closePlan: {
        ...plan.closePlan,
        sentiment: '被篡改',
      } as typeof plan.closePlan,
    }
    expect(isRelayDailyReviewValid(tampered)).toBe(false)
    expect(validateRelayDailyReview(tampered)).toContain('closePlanHash 不匹配')
  })
})
