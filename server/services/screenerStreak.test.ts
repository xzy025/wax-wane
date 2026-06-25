import { describe, it, expect } from 'vitest'
import { computeStreaks } from './screenerStreak'

const S = (...codes: string[]) => new Set(codes)

describe('computeStreaks', () => {
  it('counts today alone as streak 1 when no history', () => {
    const r = computeStreaks(S('600000', '000001'), [])
    expect(r.get('600000')).toBe(1)
    expect(r.get('000001')).toBe(1)
  })

  it('accumulates across consecutive prior snapshots', () => {
    // 600000 出现在今天 + 前 3 天 → 连 4;000001 仅今天 → 连 1
    const prior = [S('600000'), S('600000'), S('600000'), S('300750')]
    const r = computeStreaks(S('600000', '000001'), prior)
    expect(r.get('600000')).toBe(4)
    expect(r.get('000001')).toBe(1)
  })

  it('breaks the streak at the first absence', () => {
    // 出现 今天/昨天,前天缺席,大前天又出现 → 仍只连 2(第一次缺席即断)
    const prior = [S('600000'), S('999999'), S('600000')]
    const r = computeStreaks(S('600000'), prior)
    expect(r.get('600000')).toBe(2)
  })

  it('ignores prior codes that are not in today', () => {
    const prior = [S('600000', '000001'), S('000001')]
    const r = computeStreaks(S('600000'), prior)
    expect(r.has('000001')).toBe(false) // 000001 今天没出现,不计
    expect(r.get('600000')).toBe(2)
  })

  it('handles an empty today set', () => {
    expect(computeStreaks(S(), [S('600000')]).size).toBe(0)
  })
})
