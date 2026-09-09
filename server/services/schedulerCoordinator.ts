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
type SchedulerJobName = keyof SchedulerCoordinatorJobs

export interface SchedulerJobRuntimeStatus {
  running: boolean
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastError: string | null
}

const jobBusy = new Set<SchedulerJobName>()
const jobRuntime = new Map<SchedulerJobName, SchedulerJobRuntimeStatus>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runJob(
  name: SchedulerJobName,
  job: SchedulerJob,
  nowMs: number,
): Promise<void> {
  // A slow source is isolated to its own job. Other jobs still get a chance
  // on every coordinator tick, while the same job remains single-flight.
  if (jobBusy.has(name)) return
  jobBusy.add(name)
  const previous = jobRuntime.get(name)
  jobRuntime.set(name, {
    running: true,
    lastStartedAt: new Date(nowMs).toISOString(),
    lastFinishedAt: previous?.lastFinishedAt ?? null,
    lastError: null,
  })
  try {
    await job(nowMs)
    const current = jobRuntime.get(name)
    jobRuntime.set(name, {
      running: false,
      lastStartedAt: current?.lastStartedAt ?? new Date(nowMs).toISOString(),
      lastFinishedAt: new Date().toISOString(),
      lastError: null,
    })
  } catch (error) {
    const current = jobRuntime.get(name)
    jobRuntime.set(name, {
      running: false,
      lastStartedAt: current?.lastStartedAt ?? new Date(nowMs).toISOString(),
      lastFinishedAt: new Date().toISOString(),
      lastError: errorMessage(error),
    })
  } finally {
    jobBusy.delete(name)
  }
}

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
    const nowMs = Date.now()
    await Promise.all(Object.entries(jobs).map(([name, job]) =>
      runJob(name as SchedulerJobName, job, nowMs),
    ))
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
  jobBusy.clear()
  jobRuntime.clear()
}

/** Read-only diagnostics for the scheduler status endpoint and operator UI. */
export function getSchedulerCoordinatorStatus(): {
  running: boolean
  jobs: Record<string, SchedulerJobRuntimeStatus>
} {
  return {
    running: coordinatorTimer !== null,
    jobs: Object.fromEntries(
      [...jobRuntime.entries()].map(([name, status]) => [name, { ...status, running: jobBusy.has(name) }]),
    ),
  }
}
