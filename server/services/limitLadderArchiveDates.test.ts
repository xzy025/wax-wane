import { describe, expect, it } from 'vitest'
import { listLimitLadderArchiveDates } from './limitLadder'

describe('limit ladder archive dates', () => {
  it('returns descending dates backed by ladder analysis archives', () => {
    const dates = listLimitLadderArchiveDates(10)
    expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)))
    expect(dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))).toBe(true)
  })

  it('clamps the requested date count', () => {
    expect(listLimitLadderArchiveDates(0).length).toBeLessThanOrEqual(1)
    expect(listLimitLadderArchiveDates(999).length).toBeLessThanOrEqual(200)
  })
})
