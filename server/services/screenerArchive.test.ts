import { describe, it, expect } from 'vitest'
import { parseScreenerArchiveName, pickLatestArchiveName, isScreenerResult } from './screenerArchive'

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
