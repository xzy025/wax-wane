import { expect, it, vi } from 'vitest'

const memory = vi.hoisted(() => ({ writes: [] as string[] }))
vi.mock('fs', async (original) => ({
  ...await original<typeof import('fs')>(),
  existsSync: () => false,
  readFileSync: (path: unknown) => {
    if (String(path).endsWith('settlement-archive-scheduler.json')) return JSON.stringify({
      version: 1, statuses: { '2026-08-31': {
        tradeDate: '2026-08-31', action: 'completed', steps: [], error: null,
        lastAttemptAt: null, nextRetryAt: null,
      } },
    })
    throw new Error('Fixture has no archive')
  },
  mkdirSync: vi.fn(),
  writeFileSync: (_path: unknown, content: string) => memory.writes.push(content),
  renameSync: vi.fn(),
}))

import { getSettledArchiveSchedulerStatus, resetSettledArchiveScheduler, runSettledArchiveSchedulerTick } from './settlementArchive'

it('revalidates persisted completed state even after the retry deadline', async () => {
  resetSettledArchiveScheduler()
  await runSettledArchiveSchedulerTick(Date.parse('2026-08-31T23:40:00+08:00'))
  expect(getSettledArchiveSchedulerStatus()).toMatchObject({
    action: 'partial', completionLevel: 'core-incomplete', terminalReason: 'deadline-exceeded',
  })
  expect(memory.writes.length).toBeGreaterThan(0)
  expect(JSON.parse(memory.writes.at(-1) ?? '{}').statuses['2026-08-31'].action).toBe('partial')
})
