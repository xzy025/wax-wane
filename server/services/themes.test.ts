import { describe, it, expect } from 'vitest'
import { computeThemeSummary, peerSecid, type ThemeRow } from './themes'

/** Minimal ThemeRow factory — only the fields the summary reads matter. */
function row(over: Partial<ThemeRow>): ThemeRow {
  return {
    code: '000000',
    name: 'stub',
    label: '',
    price: 10,
    changePct: 0,
    pe: null,
    pb: null,
    marketCap: 0,
    chg60: null,
    chgYtd: null,
    found: true,
    limitUp: false,
    boards: 0,
    ...over,
  }
}

describe('computeThemeSummary', () => {
  it('computes averages, up/down counts, leader (with code) and divergence over live rows', () => {
    const rows = [
      row({ code: '600522', changePct: 10 }),
      row({ code: '600487', changePct: -2 }),
      row({ code: '601869', changePct: 4 }),
    ]
    const s = computeThemeSummary(rows)
    expect(s.count).toBe(3)
    expect(s.avgChangePct).toBeCloseTo((10 - 2 + 4) / 3, 6)
    expect(s.upCount).toBe(2)
    expect(s.downCount).toBe(1)
    expect(s.leader).toEqual({ name: 'stub', code: '600522', changePct: 10 })
    expect(s.divergencePct).toBeCloseTo(12, 6) // 10 − (−2)
  })

  it('excludes rows without a quote (found=false) from live stats', () => {
    const rows = [
      row({ code: 'a', changePct: 8, found: true }),
      row({ code: 'b', changePct: 99, found: false }), // no quote → ignored
    ]
    const s = computeThemeSummary(rows)
    expect(s.count).toBe(1)
    expect(s.leader?.code).toBe('a')
    expect(s.divergencePct).toBe(0) // single live row → zero spread
  })

  it('counts limit-ups and reports the highest board across all rows', () => {
    const rows = [
      row({ code: 'a', changePct: 10, limitUp: true, boards: 1 }), // 首板
      row({ code: 'b', changePct: 10, limitUp: true, boards: 3 }), // 三板
      row({ code: 'c', changePct: 2, limitUp: false, boards: 0 }),
    ]
    const s = computeThemeSummary(rows)
    expect(s.limitUpCount).toBe(2)
    expect(s.maxBoards).toBe(3)
  })

  it('degrades to zeros / null leader when no rows are live', () => {
    const s = computeThemeSummary([row({ found: false }), row({ found: false })])
    expect(s.count).toBe(0)
    expect(s.avgChangePct).toBe(0)
    expect(s.leader).toBeNull()
    expect(s.divergencePct).toBe(0)
    expect(s.limitUpCount).toBe(0)
    expect(s.maxBoards).toBe(0)
  })
})

describe('peerSecid', () => {
  it('fans US tickers out across NASDAQ/NYSE/AMEX and uppercases', () => {
    expect(peerSecid('US', 'mu')).toEqual(['105.MU', '106.MU', '107.MU'])
  })

  it('pads HK codes to 5 digits under the 116. prefix', () => {
    expect(peerSecid('HK', '1888')).toEqual(['116.01888'])
    expect(peerSecid('HK', '00700')).toEqual(['116.00700'])
  })

  it('maps JP/KR/TW to their unique EastMoney global prefixes (176/177/178, no fan-out)', () => {
    // Each market has ONE prefix and must not fan out: 176.2327 is a Japanese stock,
    // 178.2327 is Taiwan's Yageo — the explicit market is what disambiguates them.
    expect(peerSecid('JP', '6981')).toEqual(['176.6981'])
    expect(peerSecid('KR', '000660')).toEqual(['177.000660']) // Korea's 6-digit code passes through verbatim
    expect(peerSecid('TW', '2327')).toEqual(['178.2327'])
    expect(peerSecid('JP', '285a')).toEqual(['176.285A']) // alphanumeric code uppercased
  })
})
