import { describe, expect, it } from 'vitest'
import {
  buildBoardDayObservation,
  buildBoardSequenceEvidence,
  buildRelayExpectation,
  fitMultinomialLogisticModel,
  matchRelayExpectation,
  predictMultinomialLogisticModel,
} from './ladderExpectation'

function board(args: {
  date: string
  open: number
  high: number
  low: number
  close: number
  previousClose: number
  volume: number
  previousVolume: number
  board?: boolean
  firstSealTime?: string
}) {
  return buildBoardDayObservation({
    ...args,
    code: '600103',
    name: '青山纸业',
    amount: 100_000_000,
    limitPrice: args.close,
    isLimitUp: args.board ?? true,
    adjustment: 'raw',
    settled: true,
    firstSealTime: args.firstSealTime ?? '093000',
    previousVolume: args.previousVolume,
    source: 'fixture',
  })
}

describe('ladder expectation evidence', () => {
  it('classifies raw OHLC board shapes without guessing adjusted prices', () => {
    expect(board({ date: '2026-08-28', open: 4.2, high: 4.2, low: 4.2, close: 4.2, previousClose: 3.82, volume: 10, previousVolume: 5 }).boardType).toBe('one-price')
    expect(board({ date: '2026-08-28', open: 4.2, high: 4.2, low: 4.0, close: 4.2, previousClose: 3.82, volume: 10, previousVolume: 5 }).boardType).toBe('t-board')
    expect(board({ date: '2026-08-28', open: 4.0, high: 4.2, low: 3.95, close: 4.2, previousClose: 3.82, volume: 10, previousVolume: 5 }).boardType).toBe('gap-turnover')
    expect(buildBoardDayObservation({
      ...board({ date: '2026-08-28', open: 4.0, high: 4.2, low: 3.95, close: 4.2, previousClose: 3.82, volume: 10, previousVolume: 5 }),
      adjustment: 'qfq',
    }).boardType).toBe('unknown')
  })

  it('recognizes the Qingshan-style volume signature', () => {
    const observations = [
      board({ date: '2026-08-25', open: 3.0, high: 3.15, low: 2.95, close: 3.15, previousClose: 2.86, volume: 318, previousVolume: 100, firstSealTime: '095500' }),
      board({ date: '2026-08-26', open: 3.2, high: 3.47, low: 3.17, close: 3.47, previousClose: 3.15, volume: 432, previousVolume: 318, firstSealTime: '100000' }),
      board({ date: '2026-08-27', open: 3.71, high: 3.82, low: 3.61, close: 3.82, previousClose: 3.47, volume: 259, previousVolume: 432, firstSealTime: '101000' }),
    ]
    const sequence = buildBoardSequenceEvidence({ code: '600103', name: '青山纸业', observations })
    expect(sequence.volumeRatios).toEqual([3.18, 1.36, 0.6])
    expect(sequence.qingshanPattern).toBe(true)
    const expectation = buildRelayExpectation(sequence)
    expect(expectation.primaryPath).toBe('tradable-acceleration')
    expect(expectation.prohibitedPaths).toContain('one-price-untradeable')
    expect(expectation.modelStatus).toBe('shadow-heuristic')
  })

  it('fails closed when a sequence or intraday match is incomplete', () => {
    const sequence = buildBoardSequenceEvidence({
      code: '600103',
      observations: [board({ date: '2026-08-27', open: 3.71, high: 3.82, low: 3.61, close: 3.82, previousClose: 3.47, volume: 259, previousVolume: 432 })],
    })
    const expectation = buildRelayExpectation(sequence)
    expect(expectation.primaryPath).toBeNull()
    expect(matchRelayExpectation({ expectation })).toMatchObject({ status: 'unavailable', fit: null })
  })

  it('uses the prescribed Q25-Q75 full-fit band and 70% availability floor', () => {
    const sequence = buildBoardSequenceEvidence({ code: '600103', observations: [
      board({ date: '2026-08-25', open: 3.0, high: 3.15, low: 2.95, close: 3.15, previousClose: 2.86, volume: 318, previousVolume: 100 }),
      board({ date: '2026-08-26', open: 3.2, high: 3.47, low: 3.17, close: 3.47, previousClose: 3.15, volume: 432, previousVolume: 318 }),
      board({ date: '2026-08-27', open: 3.71, high: 3.82, low: 3.61, close: 3.82, previousClose: 3.47, volume: 259, previousVolume: 432 }),
    ] })
    const expectation = buildRelayExpectation(sequence)
    const match = matchRelayExpectation({
      expectation,
      openGapPct: 6,
      preSealAmountRatio: 1,
      firstTouchMinutes: 30,
      reopenCount: 0,
      themeStrength: 80,
      quantiles: {
        openGapPct: { q10: 0, q25: 4, q75: 8, q90: 10 },
        preSealAmountRatio: { q10: 0.5, q25: 0.8, q75: 1.2, q90: 1.5 },
        firstTouchMinutes: { q10: 10, q25: 20, q75: 40, q90: 60 },
        reopenCount: { q10: 0, q25: 0, q75: 1, q90: 3 },
        themeStrength: { q10: 40, q25: 60, q75: 90, q90: 100 },
      },
    })
    expect(match.status).toBe('met')
    expect(match.fit).toBe(100)
  })
})

describe('shadow multinomial logistic model', () => {
  it('trains and predicts normalized probabilities without future information', () => {
    const model = fitMultinomialLogisticModel({
      samples: [
        { features: [1, 0], label: 'tradable-acceleration' },
        { features: [0, 1], label: 'one-price-untradeable' },
        { features: [0.8, 0.1], label: 'tradable-acceleration' },
        { features: [0.1, 0.8], label: 'one-price-untradeable' },
      ],
      epochs: 80,
      learningRate: 0.1,
      l2: 0.01,
    })
    expect(model?.modelStatus).toBe('shadow-logistic')
    const prediction = model ? predictMultinomialLogisticModel(model, [1, 0]) : null
    expect(prediction).not.toBeNull()
    expect(Object.values(prediction ?? {}).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 2)
    expect(prediction?.['tradable-acceleration']).toBeGreaterThan(prediction?.['one-price-untradeable'] ?? 0)
  })
})
