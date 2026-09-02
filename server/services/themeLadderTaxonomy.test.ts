import { describe, expect, it } from 'vitest'
import { scoreThemeLadderRelation, type ThemeLadderStockInput } from './themeLadderRelation'

function stock(overrides: Partial<ThemeLadderStockInput>): ThemeLadderStockInput {
  return {
    code: '000001',
    name: '候选',
    consecutiveDays: 5,
    themes: ['CPO'],
    primaryTheme: 'CPO',
    score: 80,
    changePct: 10,
    onePrice: false,
    ...overrides,
  }
}

describe('theme ladder taxonomy integration', () => {
  it('uses stable theme ids for CPO, optical communication and fiber aliases', () => {
    const leader = stock({ code: '000001', themes: ['CPO'], primaryTheme: 'CPO' })
    const lower = stock({
      code: '000002',
      name: '光通信梯队',
      consecutiveDays: 2,
      themes: ['光通信'],
      primaryTheme: '光通信',
    })
    const fiber = stock({
      code: '000003',
      name: '光纤梯队',
      consecutiveDays: 1,
      themes: ['光纤概念'],
      primaryTheme: '光纤概念',
    })

    const result = scoreThemeLadderRelation({
      stock: leader,
      peers: [leader, lower, fiber],
      theme: {
        name: '通信',
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
    expect(result.lowerLadderCodes).toEqual(['000002', '000003'])
    expect(result.parentTheme).toBe('通信')
  })

  it('fails closed for an unknown candidate label instead of fuzzy matching it', () => {
    const candidate = stock({
      primaryTheme: '未知新概念',
      themes: ['未知新概念'],
    })
    const result = scoreThemeLadderRelation({ stock: candidate, peers: [] })

    expect(result.relation).toBe('unavailable')
    expect(result.score).toBeNull()
    expect(result.missingReasons.some((reason) => reason.includes('未知题材标签'))).toBe(true)
  })
})
