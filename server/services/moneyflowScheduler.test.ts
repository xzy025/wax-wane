import { describe, expect, it } from 'vitest'
import { moneyFlowSchedulerMode } from './moneyflowScheduler'

describe('money flow scheduler windows', () => {
  it('keeps fixed poll points and supports post-close startup catch-up', () => {
    expect(moneyFlowSchedulerMode(Date.parse('2026-08-25T09:15:00+08:00'))).toBeNull()
    expect(moneyFlowSchedulerMode(Date.parse('2026-08-25T16:30:00+08:00'))).toBe('scheduled')
    expect(moneyFlowSchedulerMode(Date.parse('2026-08-25T16:31:00+08:00'))).toBe('catch-up')
  })

  it('does not schedule on a weekend', () => {
    expect(moneyFlowSchedulerMode(Date.parse('2026-08-29T16:31:00+08:00'))).toBeNull()
  })
})
