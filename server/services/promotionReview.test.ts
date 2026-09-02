import { describe, expect, it } from 'vitest'
import {
  buildPromotionReview,
  type PromotionInput,
  type PromotionRow,
} from './promotionReview'

function row(overrides: Partial<PromotionRow>): PromotionRow {
  return {
    code: '600001',
    name: '样本',
    population: 'formal',
    promotionLane: '1进2',
    fromBoards: 1,
    resultStatus: 'failed',
    promoted: false,
    candidateRank: 1,
    promotionScore: 70,
    ...overrides,
  }
}

function input(signalDate: string, rows: PromotionRow[], ruleVersion = 'limit-ladder-v6'): PromotionInput {
  return {
    signalDate,
    tradeDate: '2026-08-25',
    ruleVersion,
    sourcePath: `docs/ladder/${signalDate}/outcome-${ruleVersion}.json`,
    rows,
  }
}

describe('promotion review aggregation', () => {
  it('keeps formal and wait-open populations separate and computes uncertainty', () => {
    const review = buildPromotionReview([
      input('2026-08-20', [
        row({ code: '600001', resultStatus: 'promoted', promoted: true, promotionScore: 88, tradable: true, openToClosePct: 1, mfePct: 2, maePct: -1 }),
        row({ code: '600002', resultStatus: 'failed', promoted: false, promotionScore: 72, tradable: true, openToClosePct: -1, mfePct: 1, maePct: -2 }),
        row({ code: '600003', population: 'wait-open', resultStatus: 'promoted', promoted: true }),
      ]),
    ])
    expect(review.overall).toMatchObject({ total: 2, valid: 2, promoted: 1, failed: 1, promotionRate: 50 })
    expect(review.waitOpen).toMatchObject({ total: 1, valid: 1, promoted: 1, promotionRate: 100 })
    expect(review.trade).toMatchObject({ observations: 2, tradable: 2, wins: 1, losses: 1, winRate: 50, averageOpenToClosePct: 0 })
    expect(review.overall.ci95Low).toBeLessThan(50)
    expect(review.overall.ci95High).toBeGreaterThan(50)
    expect(review.calibration.status).toBe('early')
  })

  it('groups by lane and score bucket without treating unresolved as failure', () => {
    const review = buildPromotionReview([
      input('2026-08-20', [
        row({ code: '600001', fromBoards: 2, promotionLane: '2进3', resultStatus: 'promoted', promoted: true, promotionScore: 86 }),
        row({ code: '600002', fromBoards: 2, promotionLane: '2进3', resultStatus: 'unresolved', promoted: null, promotionScore: 68 }),
      ]),
    ])
    expect(review.byLane[0]).toMatchObject({ label: '2进3', total: 2, valid: 1, promoted: 1, unresolved: 1, promotionRate: 100 })
    expect(review.byScoreBucket.map((group) => group.label)).toEqual(['65-74', '85+'])
    expect(review.overall).toMatchObject({ total: 2, valid: 1, unresolved: 1, promotionRate: 100 })
  })
})

