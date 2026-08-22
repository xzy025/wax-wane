import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  checkpointInWindowAt,
  checkpointsForPhase,
  listCheckpointStatuses,
  newRunId,
  nextCheckpointAt,
  phaseOfCheckpoint,
  readCheckpointStatus,
  resetCheckpointScheduler,
  resolveCheckpointStatus,
  startCheckpointScheduler,
  writeCheckpointStatus,
  type SchedulerCheckpoint,
  type SchedulerStatus,
} from './schedulerCheckpoints'

const withTempStatus = async (fn: (root: string) => Promise<void> | void): Promise<void> => {
  const previousRoot = process.env.SCHEDULER_STATUS_ROOT
  const root = mkdtempSync(join(tmpdir(), 'scheduler-status-'))
  process.env.SCHEDULER_STATUS_ROOT = root
  try {
    await fn(root)
  } finally {
    resetCheckpointScheduler()
    if (previousRoot == null) delete process.env.SCHEDULER_STATUS_ROOT
    else process.env.SCHEDULER_STATUS_ROOT = previousRoot
    rmSync(root, { recursive: true, force: true })
  }
}

const statusFor = (
  checkpoint: SchedulerCheckpoint,
  overrides: Partial<SchedulerStatus> = {},
): SchedulerStatus => ({
  runId: newRunId('2026-08-21', checkpoint),
  tradeDate: '2026-08-21',
  phase: phaseOfCheckpoint(checkpoint),
  checkpoint,
  status: 'success',
  captureStatus: 'on-time',
  sourceStatus: 'full',
  startedAt: '2026-08-21T01:20:05.000Z',
  finishedAt: '2026-08-21T01:20:06.000Z',
  warnings: [],
  ...overrides,
})

describe('scheduler checkpoints windows', () => {
  const at = (hms: string) => Date.parse(`2026-08-21T${hms}+08:00`)

  it('classifies on-time windows across the exact schedule boundaries', () => {
    expect(checkpointInWindowAt(at('07:50:30'))).toBe('overnight-context')
    expect(checkpointInWindowAt(at('08:00:30'))).toBe('asia-open')
    expect(checkpointInWindowAt(at('08:30:30'))).toBe('asia-0830')
    expect(checkpointInWindowAt(at('09:00:30'))).toBe('asia-0900')
    expect(checkpointInWindowAt(at('09:14:40'))).toBe('pre-auction')
    expect(checkpointInWindowAt(at('09:15:30'))).toBe('auction-initial')
    expect(checkpointInWindowAt(at('09:20:30'))).toBe('auction-lock')
    expect(checkpointInWindowAt(at('09:25:30'))).toBe('auction-final')
    expect(checkpointInWindowAt(at('09:30:30'))).toBe('open-initial')
    expect(checkpointInWindowAt(at('09:35:30'))).toBe('open-confirm')
    expect(checkpointInWindowAt(at('15:10:30'))).toBe('settled')
  })

  it('does not collision between adjacent auction windows', () => {
    expect(checkpointInWindowAt(at('09:18:00'))).toBe('auction-probe')
    expect(checkpointInWindowAt(at('09:19:55'))).toBe('auction-prelock')
    expect(checkpointInWindowAt(at('09:20:30'))).toBe('auction-lock')
    expect(checkpointInWindowAt(at('09:22:40'))).toBe('auction-locked-mid')
    expect(checkpointInWindowAt(at('09:24:55'))).toBe('auction-prefinal')
  })

  it('returns null on weekends and outside schedule', () => {
    expect(checkpointInWindowAt(Date.parse('2026-08-22T09:25:00+08:00'))).toBeNull()
    expect(checkpointInWindowAt(Date.parse('2026-08-21T12:00:00+08:00'))).toBeNull()
  })

  it('nextCheckpointAt exposes the next upcoming window', () => {
    const next = nextCheckpointAt(Date.parse('2026-08-21T09:01:00+08:00'))
    expect(next?.checkpoint).toBe('pre-auction')
  })
})

describe('checkpoint status archive', () => {
  it('writes and reads a per-checkpoint status atomically', () => {
    void withTempStatus(async () => {
      const status = statusFor('auction-final')
      writeCheckpointStatus(status)
      expect(readCheckpointStatus('2026-08-21', 'auction-final')).toMatchObject(status)
      expect(listCheckpointStatuses('2026-08-21')['auction-final']).toMatchObject(status)
    })
  })

  it('resolveCheckpointStatus returns unavailable without backfilling', () => {
    void withTempStatus(async () => {
      writeCheckpointStatus(statusFor('auction-final'))
      const resolved = resolveCheckpointStatus('2026-08-21', 'auction-prelock')
      expect(resolved.captureStatus).toBe('unavailable')
      expect(resolved.status).toBe('skipped')
      expect(resolved.warnings.join(' ')).toContain('unavailable')
      const files = readdirSync(join(process.env.SCHEDULER_STATUS_ROOT as string, '2026-08-21'))
      expect(files).toEqual(['auction-final.json'])
    })
  })
})

describe('checkpoint scheduler single instance', () => {
  it('starts only one monitor and stays idempotent for an in-window checkpoint', async () => {
    await withTempStatus(async () => {
      const first = startCheckpointScheduler(async () => ({
        status: 'success',
        sourceStatus: 'full',
        warnings: [],
      }))
      const second = startCheckpointScheduler(async () => ({ status: 'success', sourceStatus: 'full', warnings: [] }))
      expect(first).toBe(true)
      expect(second).toBe(false)
    })
  })

  it('honours the dev-mode disable switch', () => {
    process.env.SCHEDULER_CHECKPOINTS_DISABLED = 'true'
    try {
      expect(startCheckpointScheduler(async () => null)).toBe(false)
    } finally {
      delete process.env.SCHEDULER_CHECKPOINTS_DISABLED
      resetCheckpointScheduler()
    }
  })
})

describe('checkpoint phase mapping', () => {
  it('groups checkpoints under compatible top-level phases', () => {
    expect(checkpointsForPhase('premarket')).toEqual([
      'overnight-context',
      'asia-open',
      'asia-0830',
      'asia-0900',
      'pre-auction',
    ])
    expect(checkpointsForPhase('auction')).toContain('auction-initial')
    expect(checkpointsForPhase('auction')).toContain('auction-final')
    expect(checkpointsForPhase('open')).toEqual(['open-initial', 'open-confirm'])
    expect(checkpointsForPhase('settled')).toEqual(['settled'])
    expect(phaseOfCheckpoint('auction-lock')).toBe('auction')
    expect(phaseOfCheckpoint('asia-open')).toBe('premarket')
  })
})