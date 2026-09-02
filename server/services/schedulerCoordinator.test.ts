import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resetSchedulerCoordinator,
  startSchedulerCoordinator,
  type SchedulerCoordinatorJobs,
} from './schedulerCoordinator'

afterEach(() => {
  resetSchedulerCoordinator()
  vi.useRealTimers()
})

describe('scheduler coordinator', () => {
  it('owns one timer and prevents overlapping job batches', async () => {
    vi.useFakeTimers()
    let active = 0
    let maxActive = 0
    let calls = 0
    const jobs: SchedulerCoordinatorJobs = {
      checkpoint: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        calls += 1
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
        active -= 1
      },
      crossMarket: () => undefined,
      limitLadder: () => undefined,
      moneyFlow: () => undefined,
      firstBoard: () => undefined,
      settlement: () => undefined,
    }

    expect(startSchedulerCoordinator({ intervalMs: 1000, runImmediately: false, jobs })).toBe(true)
    expect(startSchedulerCoordinator({ intervalMs: 1000, runImmediately: false, jobs })).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toBe(1)
    expect(maxActive).toBe(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toBe(2)
  })
})

