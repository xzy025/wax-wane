import { defaultCheckpointHandlers } from './checkpointHandlers'
import {
  runCheckpointSchedulerTick,
  type CheckpointHandlers,
} from './schedulerCheckpoints'
import {
  runCrossMarketSchedulerTick,
} from './crossMarketRuntime'
import {
  runLimitLadderAuctionSchedulerTick,
} from './limitLadder'
import { runMoneyFlowSchedulerTick } from './moneyflowScheduler'
import { runFirstBoardScanSchedulerTick } from './firstBoardScan'
import { runSettledArchiveSchedulerTick } from './settlementArchive'

export type SchedulerJob = (nowMs: number) => Promise<void> | void

export interface SchedulerCoordinatorJobs {
  checkpoint: SchedulerJob
  crossMarket: SchedulerJob
  limitLadder: SchedulerJob
  moneyFlow: SchedulerJob
  firstBoard: SchedulerJob
  /** 盘后五类复盘/连板/晋级归档；可选以兼容已有测试与外部注入。 */
  settlement?: SchedulerJob
}

export interface SchedulerCoordinatorOptions {
  intervalMs?: number
  runImmediately?: boolean
  jobs?: Partial<SchedulerCoordinatorJobs>
  checkpointHandlers?: CheckpointHandlers
}

let coordinatorTimer: ReturnType<typeof setInterval> | null = null
let coordinatorBusy = false

function defaultJobs(handlers: CheckpointHandlers): SchedulerCoordinatorJobs {
  return {
    checkpoint: (nowMs) => runCheckpointSchedulerTick(handlers, nowMs),
    crossMarket: (nowMs) => runCrossMarketSchedulerTick(nowMs),
    limitLadder: (nowMs) => runLimitLadderAuctionSchedulerTick(nowMs),
    moneyFlow: (nowMs) => runMoneyFlowSchedulerTick(nowMs),
    firstBoard: (nowMs) => runFirstBoardScanSchedulerTick(nowMs),
    settlement: (nowMs) => runSettledArchiveSchedulerTick(nowMs),
  }
}

export function startSchedulerCoordinator(options: SchedulerCoordinatorOptions = {}): boolean {
  if (coordinatorTimer) return false
  const jobs = {
    ...defaultJobs(options.checkpointHandlers ?? defaultCheckpointHandlers),
    ...options.jobs,
  }
  const intervalMs = options.intervalMs ?? 5_000
  const tick = async () => {
    if (coordinatorBusy) return
    coordinatorBusy = true
    const nowMs = Date.now()
    try {
      await Promise.allSettled(Object.values(jobs).map((job) => job(nowMs)))
    } finally {
      coordinatorBusy = false
    }
  }
  coordinatorTimer = setInterval(() => void tick(), intervalMs)
  coordinatorTimer.unref?.()
  if (options.runImmediately !== false) void tick()
  return true
}

export function resetSchedulerCoordinator(): void {
  if (coordinatorTimer) {
    clearInterval(coordinatorTimer)
    coordinatorTimer = null
  }
  coordinatorBusy = false
}
