import { describe, it, expect } from 'vitest'
import { formatMoney, translateMap, isInDateRange, getDateRange } from './utils'

describe('formatMoney', () => {
  it('formats positive number', () => {
    expect(formatMoney(1234)).toBe('¥1,234')
  })

  it('formats negative number', () => {
    expect(formatMoney(-5000)).toBe('¥5,000')
  })

  it('adds sign when withSign is true', () => {
    expect(formatMoney(100, { withSign: true })).toBe('+¥100')
    expect(formatMoney(-100, { withSign: true })).toBe('-¥100')
    expect(formatMoney(0, { withSign: true })).toBe('¥0')
  })

  it('formats zero', () => {
    expect(formatMoney(0)).toBe('¥0')
  })
})

describe('translateMap', () => {
  it('returns translated value', () => {
    expect(translateMap({ foo: 'bar' }, 'foo')).toBe('bar')
  })

  it('returns key when not found', () => {
    expect(translateMap({ foo: 'bar' }, 'baz')).toBe('baz')
  })
})

describe('isInDateRange', () => {
  it('returns true for date within range', () => {
    expect(isInDateRange('2026-05-15', '2026-05-01', '2026-05-31')).toBe(true)
  })

  it('returns true for boundary dates', () => {
    expect(isInDateRange('2026-05-01', '2026-05-01', '2026-05-31')).toBe(true)
    expect(isInDateRange('2026-05-31', '2026-05-01', '2026-05-31')).toBe(true)
  })

  it('returns false for date outside range', () => {
    expect(isInDateRange('2026-06-01', '2026-05-01', '2026-05-31')).toBe(false)
    expect(isInDateRange('2026-04-30', '2026-05-01', '2026-05-31')).toBe(false)
  })
})

describe('getDateRange', () => {
  it('returns week range', () => {
    const { start, end } = getDateRange('week')
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(start <= end).toBe(true)
  })

  it('returns month range', () => {
    const { start, end } = getDateRange('month')
    expect(start <= end).toBe(true)
  })

  it('returns quarter range', () => {
    const { start, end } = getDateRange('quarter')
    expect(start <= end).toBe(true)
  })
})
