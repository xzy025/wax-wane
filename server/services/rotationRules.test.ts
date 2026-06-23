import { describe, it, expect } from 'vitest'
import { changeOverWindow, classifyQuadrant } from './rotationRules'

describe('changeOverWindow', () => {
  it('computes pct change over n bars (ascending closes)', () => {
    expect(changeOverWindow([10, 11, 12], 2)).toBeCloseTo(20, 6) // 12/10-1
    expect(changeOverWindow([10, 11, 12], 1)).toBeCloseTo((12 / 11 - 1) * 100, 6)
  })
  it('returns NaN when history is insufficient or base non-positive', () => {
    expect(Number.isNaN(changeOverWindow([10, 11], 5))).toBe(true)
    expect(Number.isNaN(changeOverWindow([0, 11], 1))).toBe(true)
    expect(Number.isNaN(changeOverWindow([12], 1))).toBe(true)
  })
})

describe('classifyQuadrant', () => {
  it('maps long×short to the four quadrants (≥0 = up/high/strong)', () => {
    expect(classifyQuadrant(5, 2)).toBe('hs') // 高强 强势延续
    expect(classifyQuadrant(-5, 2)).toBe('ls') // 低强 底部反转
    expect(classifyQuadrant(5, -2)).toBe('hw') // 高弱 高位回调
    expect(classifyQuadrant(-5, -2)).toBe('lw') // 低弱 持续走弱
  })
  it('treats exactly 0 as up/strong (boundary)', () => {
    expect(classifyQuadrant(0, 0)).toBe('hs')
    expect(classifyQuadrant(-0.01, 0)).toBe('ls')
  })
})
