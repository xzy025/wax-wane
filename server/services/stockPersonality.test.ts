import { describe, expect, it } from 'vitest'
import { buildStockPersonalityEvidence } from './stockPersonality'

describe('stock personality evidence', () => {
  it('filters future events and shrinks a one-sample rate toward the lane prior', () => {
    const result = buildStockPersonalityEvidence({
      code: '600103',
      signalDate: '2026-08-28',
      events: [
        {
          code: '600103', signalDate: '2026-08-20', boardClass: 'strict-first-board',
          boardType: 't-board', lane: 'FB_STRICT', nextDaySeal: true, nextOpenPositive: true,
        },
        {
          code: '600103', signalDate: '2026-08-29', boardClass: 'strict-first-board',
          boardType: 't-board', lane: 'FB_STRICT', nextDaySeal: false, nextOpenPositive: false,
        },
      ],
      boardType: 't-board',
      lane: 'FB_STRICT',
      lanePrior: { nextDaySealRate: 0.5 },
    })
    expect(result.sameTypeEventCount).toBe(1)
    expect(result.priorFirstBoardCount250).toBe(1)
    expect(result.nextDaySealRate).toBeGreaterThan(0.5)
    expect(result.nextDaySealRate).toBeLessThan(1)
  })

  it('keeps zero historical events distinct from an incomplete event pool', () => {
    const result = buildStockPersonalityEvidence({
      code: '600103',
      signalDate: '2026-08-28',
      events: [],
      historyComplete: true,
    })
    expect(result.priorFirstBoardCount250).toBe(0)
    expect(result.effectiveSampleSize).toBe(0)
    expect(result.missingReasons.join('')).toContain('历史严格首板事件为0')
  })
})

