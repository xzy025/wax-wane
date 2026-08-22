// /api/ops 运维诊断接口。全部只读,不得触发抓取或修改归档。

import { Router } from 'express'
import { todayShanghai } from '../lib/time'
import {
  listCheckpointStatuses,
  nextCheckpointAt,
  CHECKPOINT_SCHEDULE,
} from '../services/schedulerCheckpoints'
import { readCrossMarketSnapshot } from '../services/crossMarketMapping'
import type { CrossMarketPhase } from '../services/crossMarketMapping'

const router = Router()

const CROSS_PHASES: CrossMarketPhase[] = ['premarket', 'auction', 'open']

router.get('/api/ops/scheduler-status', (_req, res) => {
  const now = new Date()
  const tradeDate = todayShanghai(now.getTime())
  const lastRuns = listCheckpointStatuses(tradeDate)
  const next = nextCheckpointAt(now.getTime())
  const crossMarket = Object.fromEntries(
    CROSS_PHASES.map((phase) => {
      const snapshot = readCrossMarketSnapshot(tradeDate, phase)
      return [
        phase,
        snapshot
          ? {
              captureStatus: snapshot.captureStatus,
              capturedAt: snapshot.capturedAt,
              scheduledCutoffAt: snapshot.scheduledCutoffAt,
              sourceQuality: snapshot.dataQuality?.status ?? null,
            }
          : null,
      ]
    }),
  )
  res.json({
    now: now.toISOString(),
    tradeDate,
    currentCheckpoint: lastRuns,
    nextWindow: next
      ? {
          checkpoint: next.checkpoint,
          phase: next.phase,
          label: next.label,
          atSecondsOfDay: next.atSec,
        }
      : null,
    schedule: CHECKPOINT_SCHEDULE.map((row) => row.checkpoint),
    crossMarketSnapshots: crossMarket,
    warnings: Object.values(lastRuns)
      .flatMap((status) => status.warnings)
      .slice(0, 20),
  })
})

export default router