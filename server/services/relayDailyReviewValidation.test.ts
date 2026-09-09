import { describe, expect, it } from 'vitest'
import { buildRelayClosePlan, type BuildRelayClosePlanInput } from './relayDailyReviewBuilder'
import { validateRelayDailyReviewRevision } from './relayDailyReviewValidation'

const input: BuildRelayClosePlanInput = {
  reviewId: 'validation-fixture',
  signalDate: '2026-09-01',
  tradeDate: '2026-09-02',
  decisionAt: '2026-09-01T15:10:00+08:00',
  dataCutoffAt: '2026-09-01T15:10:00+08:00',
  generatedAt: '2026-09-01T15:10:01+08:00',
  ruleVersion: 'fixture-v1',
  taxonomyVersion: 'relay-theme-taxonomy-v1',
  strategyStatus: 'research',
  validationStage: 'shadow',
  marketRegime: 'fixture',
  marketGate: 'unavailable',
  sentiment: 'fixture',
  sourceRefs: [],
}

describe('relay daily review independent validator', () => {
  it('accepts a builder output and rejects legal JSON tampering', () => {
    const review = buildRelayClosePlan(input)
    expect(validateRelayDailyReviewRevision(review, { expectedRevision: 1 })).toEqual([])
    expect(validateRelayDailyReviewRevision({ ...review, sourceHash: 'tampered' })).toContain('sourceHash 不匹配')
  })

  it('fails closed for malformed objects and impossible dates', () => {
    expect(validateRelayDailyReviewRevision(null as never)).toContain('revision 必须是对象')
    const review = buildRelayClosePlan({ ...input, signalDate: '2026-02-30' })
    expect(validateRelayDailyReviewRevision(review)).toContain('signalDate 非法: 2026-02-30')
    expect(() => validateRelayDailyReviewRevision({ ...review, checkpoints: [null] } as never)).not.toThrow()
  })
})
