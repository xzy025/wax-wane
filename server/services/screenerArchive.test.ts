import { describe, it, expect } from 'vitest'
import { parseScreenerArchiveName, pickLatestArchiveName, isScreenerResult, shouldReplaceArchive } from './screenerArchive'
import type { ScreenerResult } from './screener'

describe('parseScreenerArchiveName', () => {
  it('parses a valid YYYY-MM-DD.json snapshot name', () => {
    expect(parseScreenerArchiveName('2026-06-24.json')).toEqual({
      filename: '2026-06-24.json',
      date: '2026-06-24',
    })
  })

  it('rejects backtest output, scratch caches, and malformed names', () => {
    expect(parseScreenerArchiveName('backtest-2026-06-24.json')).toBeNull()
    expect(parseScreenerArchiveName('.bars-400-700.json')).toBeNull()
    expect(parseScreenerArchiveName('.lhb-5-inst.json')).toBeNull()
    expect(parseScreenerArchiveName('.stock-boards-300.json')).toBeNull()
    expect(parseScreenerArchiveName('2026-6-4.json')).toBeNull() // non-padded
    expect(parseScreenerArchiveName('2026-06-24.json.bak')).toBeNull()
    expect(parseScreenerArchiveName('2026-06-24.txt')).toBeNull()
    expect(parseScreenerArchiveName('README.md')).toBeNull()
  })
})

describe('pickLatestArchiveName', () => {
  it('picks the newest valid snapshot, ignoring backtest/scratch/foreign files', () => {
    const files = [
      'backtest-2026-06-24.json',
      '.bars-400-700.json',
      '2026-06-22.json',
      '2026-06-24.json',
      '2026-06-23.json',
      'README.md',
    ]
    expect(pickLatestArchiveName(files)).toEqual({ filename: '2026-06-24.json', date: '2026-06-24' })
  })

  it('is order-independent and crosses the year boundary', () => {
    expect(pickLatestArchiveName(['2026-01-02.json', '2025-12-31.json'])).toEqual({
      filename: '2026-01-02.json',
      date: '2026-01-02',
    })
    expect(pickLatestArchiveName(['2025-12-31.json', '2026-01-02.json'])).toEqual({
      filename: '2026-01-02.json',
      date: '2026-01-02',
    })
  })

  it('returns null when there is no valid snapshot', () => {
    expect(pickLatestArchiveName([])).toBeNull()
    expect(pickLatestArchiveName(['backtest-2026-06-24.json', '.bars-400-700.json'])).toBeNull()
  })
})

describe('isScreenerResult', () => {
  const valid = { asof: '2026-06-24', breakout: [], trigger: [], pullback: [] }

  it('accepts a minimally valid result', () => {
    expect(isScreenerResult(valid)).toBe(true)
  })

  it('rejects null, non-objects, and malformed shapes', () => {
    expect(isScreenerResult(null)).toBe(false)
    expect(isScreenerResult(undefined)).toBe(false)
    expect(isScreenerResult('x')).toBe(false)
    expect(isScreenerResult({})).toBe(false)
    expect(isScreenerResult({ ...valid, asof: 20260624 })).toBe(false) // asof not a string
    expect(isScreenerResult({ ...valid, breakout: undefined })).toBe(false) // breakout not an array
  })
})

describe('shouldReplaceArchive — 同日快照择优(防部分降级覆盖)', () => {
  const snap = (over: Partial<ScreenerResult> = {}): ScreenerResult =>
    ({ asof: '2026-07-06', breakout: [], trigger: [], pullback: [], closed: true, fetched: 1000, ...over }) as ScreenerResult

  it('无旧档 → 写', () => {
    expect(shouldReplaceArchive(null, snap())).toBe(true)
  })

  it('旧档非同日(防御) → 写', () => {
    expect(shouldReplaceArchive(snap({ asof: '2026-07-03', fetched: 2000 }), snap())).toBe(true)
  })

  it('部分降级不覆盖优质档:同为盘后,新取K 951 < 旧 1027 → 拒', () => {
    expect(shouldReplaceArchive(snap({ fetched: 1027 }), snap({ fetched: 951 }))).toBe(false)
  })

  it('同盘态取K 持平或更高 → 写', () => {
    expect(shouldReplaceArchive(snap({ fetched: 1027 }), snap({ fetched: 1027 }))).toBe(true)
    expect(shouldReplaceArchive(snap({ fetched: 951 }), snap({ fetched: 1027 }))).toBe(true)
  })

  it('盘后档优先于盘中档,双向', () => {
    // 盘中旧档 + 盘后新档 → 写(哪怕取K更低,收盘定盘是终态)
    expect(shouldReplaceArchive(snap({ closed: false, fetched: 1027 }), snap({ closed: true, fetched: 951 }))).toBe(true)
    // 盘后旧档 + 盘中新档 → 拒
    expect(shouldReplaceArchive(snap({ closed: true, fetched: 951 }), snap({ closed: false, fetched: 1027 }))).toBe(false)
  })

  it('旧版快照缺 fetched → 允许覆盖(无从比较);新档缺 fetched(异常) → 保旧', () => {
    expect(shouldReplaceArchive(snap({ fetched: undefined }), snap({ fetched: 10 }))).toBe(true)
    expect(shouldReplaceArchive(snap({ fetched: 1027 }), snap({ fetched: undefined }))).toBe(false)
  })
})
