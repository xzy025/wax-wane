import { describe, expect, it } from 'vitest'
import {
  normalizeManualReviewPayload,
  scoreNextDayManualReview,
} from './nextDayManualReview'

const candidate = {
  code: '600479',
  name: '示例股票',
  automaticScore: 72,
  themeLadderScore: 80,
}

describe('next-day manual review scoring', () => {
  it('produces a final research score from the two core screenshot groups', () => {
    const result = scoreNextDayManualReview(candidate, {
      signalDate: '2026-08-27',
      code: '600479',
      source: '同花顺截图1+截图2',
      personality: {
        historySampleCount1y: 1,
        limitUpSuccessRateNonOnePct1y: 100,
        sealSuccessRateNonOnePct1y: 100,
        nextDayOpenHighRate1y: 100,
        nextDayPositiveCloseRate1y: 100,
        nextDayAvgOpenClosePct1y: 9.98,
      },
      current: {
        currentSingleOrderAmountWan: 3649,
        maxSingleOrderAmountWan: 18000,
        sealToVolumePct: 2.79,
        sealToFloatPct: 0.72,
        limitUpTurnoverAmountYi: 6.7,
      },
    })

    expect(result.status).toBe('reviewed')
    expect(result.finalScore).not.toBeNull()
    expect(result.coveragePct).toBe(85)
    expect(result.missingReasons).toContain('缺少主力净流入或资金排名字段')
  })

  it('keeps final score unavailable when a core screenshot group is missing', () => {
    const result = scoreNextDayManualReview(candidate, {
      signalDate: '2026-08-27',
      code: '600479',
      personality: {
        historySampleCount1y: 1,
        nextDayPositiveCloseRate1y: 100,
      },
    })

    expect(result.status).toBe('partial')
    expect(result.finalScore).toBeNull()
    expect(result.provisionalScore).not.toBeNull()
    expect(result.missingReasons).toContain('缺少当日封单/成交截图字段')
  })

  it('normalizes the payload and leaves explicit unknown values as null', () => {
    const payload = normalizeManualReviewPayload({
      signalDate: '2026-08-27',
      reviews: [
        {
          code: '600479',
          personality: { sealSuccessRateNonOnePct1y: '100' },
          current: { sealToVolumePct: null },
        },
      ],
    })

    expect(payload.reviews[0].code).toBe('600479')
    expect(payload.reviews[0].personality?.sealSuccessRateNonOnePct1y).toBe(100)
    expect(payload.reviews[0].current?.sealToVolumePct).toBeNull()
  })

  it('keeps evidence captured after the signal cutoff out of the final score', () => {
    const result = scoreNextDayManualReview(candidate, {
      signalDate: '2026-08-27',
      code: '600479',
      capturedAt: '2026-08-28T09:30:00+08:00',
      signalCutoffAt: '2026-08-27T15:10:00+08:00',
      personality: { sealSuccessRateNonOnePct1y: 80, historySampleCount1y: 20 },
      current: { sealToVolumePct: 2, sealToFloatPct: 0.5, limitUpTurnoverAmountYi: 2 },
    })
    expect(result.finalScore).toBeNull()
    expect(result.pointInTimeCausal).toBe(false)
    expect(result.missingReasons).toContain('人工证据晚于信号截止时间，仅用于事后解释')
  })
})
