// /api/ops 运维诊断接口。全部只读,不得触发抓取或修改归档。

import { Router } from 'express'
import { todayShanghai } from '../lib/time'
import {
  buildSchedulerStatusSnapshot,
  CHECKPOINT_SCHEDULE,
} from '../services/schedulerCheckpoints'
import { readCrossMarketSnapshot } from '../services/crossMarketMapping'
import type { CrossMarketPhase } from '../services/crossMarketMapping'
import { buildPremarketWorkbench } from '../services/premarketWorkbench'
import { getSettledArchiveSchedulerStatus } from '../services/settlementArchive'
import { getSchedulerCoordinatorStatus } from '../services/schedulerCoordinator'
import { getFirstBoardProviderHealth } from '../services/firstBoardScan'
import { getQuickTinyMcpHealth, probeQuickTinyMcp } from '../services/quicktinyMcp'

const router = Router()

const CROSS_PHASES: CrossMarketPhase[] = ['premarket', 'auction', 'open']

router.get('/api/ops/premarket-workbench', (_req, res) => {
  try {
    res.json(buildPremarketWorkbench())
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
})

router.get('/api/ops/scheduler-status', (_req, res) => {
  const now = new Date()
  const tradeDate = todayShanghai(now.getTime())
  const scheduler = buildSchedulerStatusSnapshot(now.getTime(), tradeDate)
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
    ...scheduler,
    schedule: CHECKPOINT_SCHEDULE.map((row) => row.checkpoint),
    crossMarketSnapshots: crossMarket,
    settledArchive: getSettledArchiveSchedulerStatus(),
    coordinator: getSchedulerCoordinatorStatus(),
    firstBoardProviders: getFirstBoardProviderHealth(),
    quicktinyMcp: getQuickTinyMcpHealth(),
  })
})

// Explicitly requested read-only probe. Unlike scheduler-status this endpoint
// performs one external tools/list request and never invokes a market-data tool.
router.get('/api/ops/quicktiny-mcp-probe', async (_req, res) => {
  try {
    const status = await probeQuickTinyMcp()
    res.status(status.state === 'unavailable' ? 503 : 200).json(status)
  } catch {
    res.status(503).json(getQuickTinyMcpHealth())
  }
})

export default router
