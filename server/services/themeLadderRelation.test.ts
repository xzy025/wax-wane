import { describe, expect, it } from 'vitest'
import { scoreThemeLadderRelation, type ThemeLadderStockInput } from './themeLadderRelation'

function stock(overrides: Partial<ThemeLadderStockInput>): ThemeLadderStockInput {
  return {
    code: '000001',
    name: '候选',
    consecutiveDays: 3,
    themes: ['创新药'],
    primaryTheme: '创新药',
    score: 70,
    changePct: 10,
    onePrice: false,
    ...overrides,
  }
}

describe('theme ladder relation scoring', () => {
  it('adds a replenishment bonus only when a lower-board candidate has a higher same-theme leader', () => {
    const candidate = stock({ consecutiveDays: 3 })
    const leader = stock({
      code: '000002',
      name: '医药龙头',
      consecutiveDays: 5,
      primaryTheme: '医药',
      themes: ['医药'],
      score: 90,
    })
    const result = scoreThemeLadderRelation({
      stock: candidate,
      peers: [candidate, leader],
      theme: {
        name: '创新药',
        grade: 'A',
        count: 4,
        firstBoardCount: 2,
        multiBoardCount: 2,
        maxBoards: 5,
        continuity: 80,
        promotionRate: 50,
      },
    })

    expect(result.relation).toBe('replenishment')
    expect(result.bonus).toBeGreaterThan(0)
    expect(result.leader?.code).toBe('000002')
  })

  it('does not treat an isolated lower-board concept as replenishment', () => {
    const candidate = stock({ consecutiveDays: 2 })
    const unrelated = stock({
      code: '000003',
      name: '通信龙头',
      consecutiveDays: 5,
      primaryTheme: '通信',
      themes: ['通信'],
    })
    const result = scoreThemeLadderRelation({
      stock: candidate,
      peers: [candidate, unrelated],
    })

    expect(result.relation).toBe('isolated')
    expect(result.bonus).toBe(0)
  })

  it('adds a leader-driven bonus only when a 5-board leader has a lower same-theme ladder', () => {
    const leader = stock({
      code: '000010',
      name: '空间龙头',
      consecutiveDays: 5,
      themes: ['CPO'],
      primaryTheme: 'CPO',
      score: 95,
    })
    const lower = stock({
      code: '000011',
      name: '下方梯队',
      consecutiveDays: 2,
      themes: ['光通信'],
      primaryTheme: '光通信',
    })
    const result = scoreThemeLadderRelation({
      stock: leader,
      peers: [leader, lower],
      theme: {
        name: 'CPO',
        grade: 'B',
        count: 3,
        firstBoardCount: 1,
        multiBoardCount: 2,
        maxBoards: 5,
        continuity: 60,
        promotionRate: null,
      },
    })

    expect(result.relation).toBe('leader-driven')
    expect(result.bonus).toBeGreaterThan(0)
    expect(result.lowerLadderCodes).toEqual(['000011'])
  })

  it('does not award leader-driven points when a higher same-theme leader still exists', () => {
    const follower = stock({ consecutiveDays: 5 })
    const higher = stock({
      code: '000012',
      name: '更高龙头',
      consecutiveDays: 6,
      score: 96,
    })
    const lower = stock({ code: '000013', consecutiveDays: 2 })
    const result = scoreThemeLadderRelation({
      stock: follower,
      peers: [follower, higher, lower],
      theme: {
        name: '创新药',
        grade: 'A',
        count: 4,
        firstBoardCount: 2,
        multiBoardCount: 2,
        maxBoards: 6,
        continuity: 80,
        promotionRate: 50,
      },
    })

    expect(result.relation).toBe('follower')
    expect(result.bonus).toBe(0)
  })
})
