import { describe, expect, it } from 'vitest'
import { mapTencentHKRows } from './hk'

describe('mapTencentHKRows', () => {
  it('maps HK rows and derives change/amplitude without inventing turnover', () => {
    const bars = mapTencentHKRows([
      ['2026-08-06', '217.8', '231', '251.2', '216.2', '11002153'],
      ['2026-08-07', '236', '256.2', '262.8', '234', '11197507'],
    ])
    expect(bars).toHaveLength(2)
    expect(bars[1]).toMatchObject({
      date: '2026-08-07',
      open: 236,
      close: 256.2,
      high: 262.8,
      low: 234,
      volume: 11197507,
      turnover: 0,
    })
    expect(bars[1].changePct).toBeCloseTo(10.91, 2)
    expect(bars[1].amplitude).toBeCloseTo(12.47, 2)
  })

  it('skips malformed rows', () => {
    expect(mapTencentHKRows([['bad'], ['2026-08-07', 1, 0, 1, 1, 1]])).toEqual([])
  })
})
