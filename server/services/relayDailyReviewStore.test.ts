import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendRelayCheckpoint,
  appendRelayOutcome,
  freezeRelayClosePlan,
  listRelayDailyReviewRevisions,
  readRelayDailyReview,
  RelayReviewStoreError,
  relayReviewPath,
} from './relayDailyReviewStore'
import { buildRelayClosePlan, type BuildRelayClosePlanInput } from './relayDailyReviewBuilder'

const originalRoot = process.env.RELAY_REVIEW_ROOT
let testDir = ''

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
      sourceId: 's1',
      sourceType: 'ladder',
      sourceRef: 'archive/2026-08-28',
      asof: '2026-08-28',
      observedPhase: 'close-plan',
      dataCutoffAt: '2026-08-28T15:10:00+08:00',
      decisionAt: '2026-08-28T15:10:00+08:00',
      eventAt: '2026-08-28T15:00:00+08:00',
      providerAt: null,
      receivedAt: '2026-08-28T15:08:00+08:00',
      knownAt: '2026-08-28T15:08:00+08:00',
      capturedAt: '2026-08-28T15:09:00+08:00',
      sourceHash: 'abc',
      quality: 'formal',
      missingReasons: [],
    },
  ],
}

beforeEach(() => {
  testDir = join(tmpdir(), `relay-review-store-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(testDir, { recursive: true })
  process.env.RELAY_REVIEW_ROOT = testDir
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  if (originalRoot === undefined) delete process.env.RELAY_REVIEW_ROOT
  else process.env.RELAY_REVIEW_ROOT = originalRoot
})

const auctionInput = {
  signalDate: '2026-08-28',
  tradeDate: '2026-08-31',
  checkpoint: 'auction-final' as const,
  observedAt: '2026-08-31T09:25:05+08:00',
  decisionAt: '2026-08-31T09:25:06+08:00',
  dataCutoffAt: '2026-08-31T09:25:05+08:00',
  sourceRefs: [],
}

describe('relay daily review store', () => {
  it('freezes revision 1, reads it back and lists exactly one revision', () => {
    const plan = buildRelayClosePlan(baseInput)
    const frozen = freezeRelayClosePlan(plan)
    expect(frozen.revision).toBe(1)
    expect(frozen.documentHash).toMatch(/^[a-f0-9]{64}$/)

    const read = readRelayDailyReview('2026-08-28')
    expect(read?.closePlanHash).toBe(frozen.closePlanHash)
    const revisions = listRelayDailyReviewRevisions('2026-08-28')
    expect(revisions.map((row) => row.revision)).toEqual([1])
    expect(revisions[0].documentHash).toBe(frozen.documentHash)
  })

  it('is idempotent: an identical freeze returns the original revision', () => {
    const a = freezeRelayClosePlan(buildRelayClosePlan(baseInput))
    const b = freezeRelayClosePlan(buildRelayClosePlan(baseInput))
    expect(b.revision).toBe(1)
    expect(b.documentHash).toBe(a.documentHash)
    expect(listRelayDailyReviewRevisions('2026-08-28').length).toBe(1)
  })

  it('rejects re-freezing a different close plan as a conflict', () => {
    freezeRelayClosePlan(buildRelayClosePlan(baseInput))
    const conflict = buildRelayClosePlan({ ...baseInput, marketGate: 'frozen' })
    expect(() => freezeRelayClosePlan(conflict)).toThrow(RelayReviewStoreError)
    expect(() => freezeRelayClosePlan(conflict)).toThrow(/已有冻结/)
  })

  it('appends checkpoints as immutable superseding revisions with constant closePlanHash', () => {
    const frozen = freezeRelayClosePlan(buildRelayClosePlan(baseInput))
    const auction = appendRelayCheckpoint('2026-08-28', auctionInput)
    expect(auction.revision).toBe(2)
    expect(auction.supersedes).toEqual({ revision: 1, documentHash: frozen.documentHash })
    expect(auction.closePlanHash).toBe(frozen.closePlanHash)
    expect(auction.latestCheckpoint).toBe('auction-final')

    const confirm = appendRelayCheckpoint('2026-08-28', {
      ...auctionInput,
      checkpoint: 'open-confirm',
      observedAt: '2026-08-31T09:35:00+08:00',
      decisionAt: '2026-08-31T09:35:02+08:00',
      dataCutoffAt: '2026-08-31T09:35:00+08:00',
    })
    expect(confirm.revision).toBe(3)
    expect(confirm.closePlanHash).toBe(frozen.closePlanHash)
    expect(readRelayDailyReview('2026-08-28')?.latestCheckpoint).toBe('open-confirm')
    expect(readRelayDailyReview('2026-08-28', 1)?.latestCheckpoint).toBe('close-plan')
  })

  it('appends the settled outcome as a new superseding revision', () => {
    freezeRelayClosePlan(buildRelayClosePlan(baseInput))
    const settled = appendRelayOutcome('2026-08-28', {
      decisionAt: '2026-08-31T15:10:02+08:00',
      dataCutoffAt: '2026-08-31T15:10:00+08:00',
      marketOutcome: { promoted: 1 },
      executionOutcome: { filled: 0 },
      exitOutcome: null,
      expectationDelta: null,
      errorTaxonomy: ['unresolved'],
    })
    expect(settled.revision).toBe(2)
    expect(settled.settled).toBe(true)
    expect(settled.latestCheckpoint).toBe('settled')
    expect(settled.outcome?.marketOutcome).toEqual({ promoted: 1 })
    expect(() => appendRelayOutcome('2026-08-28', {
      marketOutcome: { promoted: 9 },
      executionOutcome: null,
      exitOutcome: null,
      expectationDelta: null,
      errorTaxonomy: [],
    })).toThrow(/已写入/)
  })

  it('fails fast when appending before a close plan exists', () => {
    expect(() => appendRelayCheckpoint('2026-08-27', auctionInput)).toThrow(RelayReviewStoreError)
    expect(readRelayDailyReview('2026-08-27')).toBeNull()
  })

  it('detects a corrupt latest revision explicitly and can fall back to last-good', () => {
    freezeRelayClosePlan(buildRelayClosePlan(baseInput))
    appendRelayCheckpoint('2026-08-28', auctionInput)
    // Corrupt the r2 file on disk.
    writeFileSync(relayReviewPath('2026-08-28', 2), '{broken', 'utf8')

    expect(() => readRelayDailyReview('2026-08-28')).toThrow(/损坏/)
    const fallback = readRelayDailyReview('2026-08-28', undefined, { allowLastGood: true })
    expect(fallback?.revision).toBe(1)
    expect(fallback?.warnings.join(' ')).toContain('回退到 last-good')
  })

  it('rejects a mixed signalDate during checkpoint projection', () => {
    freezeRelayClosePlan(buildRelayClosePlan(baseInput))
    expect(() => appendRelayCheckpoint('2026-08-28', {
      ...auctionInput,
      signalDate: '2026-08-29',
    })).toThrow(/不一致/)
  })
})