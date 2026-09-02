import { describe, expect, it } from 'vitest'
import {
  buildLadderSentimentQuantSnapshot,
  computeEmotionScore,
  computeMarketScore,
  computeCrowding,
  percentile,
} from './ladderSentimentQuant'

function marks(prefix: string, count: number, changePct = 2, isLimitUp = true) {
  return Array.from({ length: count }, (_, index) => ({
    code: `${prefix}${String(index).padStart(4, '0')}`,
    changePct,
    isLimitUp,
  }))
}

describe('ladder sentiment quantization', () => {
  it('reproduces the five-point emotion examples and the 22-point sum', () => {
    const current: Record<string, { code: string; changePct: number; isLimitUp: boolean }> = {}
    for (const row of marks('F', 5)) current[row.code] = row
    for (const row of marks('L', 5)) current[row.code] = row
    const emotion = computeEmotionScore({
      previousFirstBoards: marks('F', 5),
      previousLadderBoards: marks('L', 5),
      currentMarks: current,
      currentLadderCount: 15,
      previousLadderCount: 10,
    })
    const market = computeMarketScore({
      limitUpCount: 50,
      ladderCount: 15,
      previousLadderCount: 10,
      down5Count: 10,
      advanceCount: 800,
      declineCount: 800,
      flatCount: 400,
    })
    expect(emotion.score).toBe(12)
    expect(market.score).toBe(10)
    expect(buildLadderSentimentQuantSnapshot({
      asof: '2026-08-28',
      market: {
        limitUpCount: 50,
        ladderCount: 15,
        previousLadderCount: 10,
        down5Count: 10,
        advanceCount: 800,
        declineCount: 800,
        flatCount: 400,
      },
      previousFirstBoards: marks('F', 5),
      previousLadderBoards: marks('L', 5),
      currentMarks: current,
      crowding: null,
    })).toMatchObject({ B: 12, M: 10, C: 22, gateState: 'JOINT_CLIMAX', nextDayRelayWeight: 0, noNewRelay: true })
  })

  it('matches the planned heat gate bands', () => {
    const current: Record<string, { code: string; changePct: number; isLimitUp: boolean }> = {}
    for (const row of marks('F', 5)) current[row.code] = row
    for (const row of marks('L', 5)) current[row.code] = row
    const base = {
      asof: '2026-08-28',
      previousFirstBoards: marks('F', 5),
      previousLadderBoards: marks('L', 5),
      currentMarks: current,
      crowding: null,
    }
    const hot = buildLadderSentimentQuantSnapshot({
      ...base,
      market: { limitUpCount: 40, ladderCount: 11, previousLadderCount: 10, down5Count: 80, advanceCount: 800, declineCount: 800, flatCount: 400 },
    })
    expect(hot).toMatchObject({ B: 12, M: 10, gateState: 'JOINT_CLIMAX', nextDayRelayWeight: 0 })
    const ordinary = buildLadderSentimentQuantSnapshot({
      ...base,
      market: { limitUpCount: 20, ladderCount: 5, previousLadderCount: 10, down5Count: 10, advanceCount: 200, declineCount: 800, flatCount: 200 },
    })
    expect(ordinary.gateState).toBe('NORMAL')
    expect(ordinary.nextDayRelayWeight).toBe(1)
  })

  it('does not turn insufficient denominators into neutral permission', () => {
    const score = computeEmotionScore({
      previousFirstBoards: marks('F', 4),
      previousLadderBoards: marks('L', 5),
      currentMarks: Object.fromEntries(marks('L', 5).map((row) => [row.code, row])),
      currentLadderCount: 12,
      previousLadderCount: 10,
    })
    expect(score.score).toBeNull()
    const snapshot = buildLadderSentimentQuantSnapshot({
      asof: '2026-08-28',
      market: { limitUpCount: 50, ladderCount: 12, previousLadderCount: 10, down5Count: null, advanceCount: 800, declineCount: 800, flatCount: 400 },
      crowding: null,
    })
    expect(snapshot).toMatchObject({ status: 'unavailable', gateState: 'UNAVAILABLE', nextDayRelayWeight: null, noNewRelay: false })
    expect(snapshot.warnings.join(' ')).toContain('不按中性值放行')
  })
})

describe('experimental crowding percentile', () => {
  it('requires a sufficiently long same-time baseline and keeps the ratios visible', () => {
    expect(percentile(1, [1, 2, 3])).toBeNull()
    const history = Array.from({ length: 20 }, (_, index) => index / 10)
    const result = computeCrowding({
      currentMidAmount: 3,
      previousMidAmount: 2,
      currentCloseAmount: 4,
      previousCloseAmount: 2,
      historicalMidRatios: history,
      historicalCloseRatios: history,
    })
    expect(result.status).toBe('available')
    expect(result.rMid).toBe(1.5)
    expect(result.rClose).toBe(2)
    expect(result.percentile).toBeGreaterThan(75)
  })
})
