import { describe, expect, it } from 'vitest'
import { buildRelayFeedbackEvidence } from './relayFeedbackEvidence'

const signalDate = '2026-08-28'

describe('relay feedback evidence', () => {
  it.each([
    [0, 'unavailable'],
    [1, 'supportive'],
    [2, 'supportive'],
    [3, 'mixed'],
    [4, 'negative'],
  ] as const)('keeps n=%i direct evidence with the expected research direction', (n, expected) => {
    const observations = Array.from({ length: n }, (_, index) => ({
      id: String(index),
      positive: n === 4 ? false : n === 3 ? index < 2 : true,
    }))
    const result = buildRelayFeedbackEvidence({ signalDate, observations })

    expect(result.direct.status).toBe(expected)
    expect(result.direct.confidence).toBe(n === 0 ? 'unavailable' : 'low')
    expect(result.direct.denominator).toBe(n || null)
    expect(result.prior.posterior).toBeNull()
  })

  it('does not calculate a one-anchor group rate', () => {
    const result = buildRelayFeedbackEvidence({
      signalDate,
      observations: [{ id: 'anchor', positive: true }],
    })

    expect(result.direct.positiveRate).toBeNull()
    expect(result.direct.missingReasons).toContain('仅1只单锚样本，不计算群体正反馈率')
  })

  it('allows descriptive n>=5 only with source coverage and rejects future priors', () => {
    const result = buildRelayFeedbackEvidence({
      signalDate,
      sourceCoveragePct: 100,
      observations: Array.from({ length: 5 }, (_, index) => ({ id: String(index), positive: index < 4 })),
      prior: {
        signalDate,
        numerator: 8,
        denominator: 10,
        effectiveN: 10,
        priorWindow: 'future',
        posterior: 80,
      },
    })

    expect(result.direct.status).toBe('supportive')
    expect(result.direct.confidence).toBe('medium')
    expect(result.direct.positiveRate).toBe(80)
    expect(result.prior.available).toBe(false)
    expect(result.prior.missingReasons).toContain('历史先验日期不得晚于信号日')
  })

  it('keeps valid historical prior separate from direct evidence', () => {
    const result = buildRelayFeedbackEvidence({
      signalDate,
      observations: [{ id: 'a', positive: true }, { id: 'b', positive: false }],
      prior: {
        signalDate: '2026-08-27',
        numerator: 12,
        denominator: 20,
        effectiveN: 18,
        priorWindow: 'lane×regime:120d',
        posterior: null,
      },
    })

    expect(result.direct.denominator).toBe(2)
    expect(result.prior.denominator).toBe(20)
    expect(result.direct.denominator).not.toBe(result.prior.denominator)
    expect(result.prior.available).toBe(true)
  })
})
