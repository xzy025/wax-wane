// 精确检查点调度(阶段 2)。
//
// 顶层阶段保持兼容:premarket | auction | open | settled。
// 检查点是「正式可比较快照」的固化时刻;底层采集频率不受检查点限制。
//
// 时间规则:
//   - 每个检查点在 [atSec, cutoffSec) 窗口内首次运行并按 on-time 落盘;
//   - tradeDate + checkpoint 只能有一个正式成功归档,重复 tick 幂等;
//   - 服务重启后只读已有归档,错过且无归档 → unavailable,不用实时数据补写历史;
//   - 晚到实时数据只标 late-live,不进入历史基线;
//   - 归档使用临时文件加原子替换,失败不得覆盖 last-good;
//   - 调度器单实例,提供开发环境关闭开关。
//
// 错过时间点:09:15 后不得伪造 auction-initial;09:20 后不得补建 auction-prelock;
// 09:25 后不得补建任何竞价阶段;缺失检查点返回 unavailable。

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { todayShanghai } from '../lib/time'
import { isTradingDayAt } from './tradingCalendar'

export const SCHEDULER_CHECKPOINTS_VERSION = 'scheduler-checkpoints-v1'

export type SchedulerPhase = 'premarket' | 'auction' | 'open' | 'settled'

export type SchedulerCheckpoint =
  | 'overnight-context'
  | 'asia-open'
  | 'asia-0830'
  | 'asia-0900'
  | 'pre-auction'
  | 'auction-initial'
  | 'auction-probe'
  | 'auction-prelock'
  | 'auction-lock'
  | 'auction-locked-mid'
  | 'auction-prefinal'
  | 'auction-final'
  | 'open-initial'
  | 'open-confirm'
  | 'settled'

export type SchedulerRunStatus =
  | 'scheduled'
  | 'running'
  | 'success'
  | 'degraded'
  | 'failed'
  | 'skipped'

export type SchedulerCaptureStatus = 'on-time' | 'late-live' | 'unavailable'
export type SchedulerSourceStatus = 'full' | 'degraded' | 'unavailable'

export interface SchedulerStatus {
  runId: string
  tradeDate: string
  phase: SchedulerPhase
  checkpoint: SchedulerCheckpoint
  status: SchedulerRunStatus
  captureStatus: SchedulerCaptureStatus
  sourceStatus: SchedulerSourceStatus
  provider?: string
  providerTimestamp?: string
  startedAt: string
  finishedAt?: string
  dataAsOf?: string
  warnings: string[]
  error?: string
}

export interface SchedulerNextWindow {
  checkpoint: SchedulerCheckpoint
  phase: SchedulerPhase
  label: string
  atSecondsOfDay: number
}

export interface SchedulerCheckpointView {
  checkpoint: SchedulerCheckpoint
  phase: SchedulerPhase
  label: string
  atSecondsOfDay: number
  cutoffSecondsOfDay: number
  status: SchedulerRunStatus | 'missing'
  captureStatus: SchedulerCaptureStatus
  sourceStatus: SchedulerSourceStatus
  runId?: string
  provider?: string
  providerTimestamp?: string
  finishedAt?: string
  dataAsOf?: string
  warnings: string[]
}

export interface SchedulerStatusSnapshot {
  now: string
  tradeDate: string
  currentPhase: SchedulerPhase | null
  currentCheckpoint: SchedulerCheckpoint | null
  lastRuns: Record<string, SchedulerStatus>
  missingCheckpoints: SchedulerCheckpoint[]
  nextWindow: SchedulerNextWindow | null
  checkpoints: Record<string, SchedulerCheckpointView>
  lastGood: Record<string, SchedulerStatus>
  warnings: string[]
}

export interface CheckpointSpec {
  checkpoint: SchedulerCheckpoint
  phase: SchedulerPhase
  label: string
  /** Asia/Shanghai 计划触发时刻(自 0 点起的秒数)。 */
  atSec: number
  /** 计入 on-time 的截止时刻(秒)。 */
  cutoffSec: number
}

export const CHECKPOINT_SCHEDULE: readonly CheckpointSpec[] = [
  { checkpoint: 'overnight-context', phase: 'premarket', label: '07:50 隔夜环境固化', atSec: 7 * 3600 + 50 * 60, cutoffSec: 7 * 3600 + 55 * 60 },
  { checkpoint: 'asia-open', phase: 'premarket', label: '08:00 日韩开盘跟踪', atSec: 8 * 3600 + 5, cutoffSec: 8 * 3600 + 75 },
  { checkpoint: 'asia-0830', phase: 'premarket', label: '08:30 日韩30分钟变化', atSec: 8 * 3600 + 30 * 60, cutoffSec: 8 * 3600 + 32 * 60 },
  { checkpoint: 'asia-0900', phase: 'premarket', label: '09:00 日韩60分钟变化', atSec: 9 * 3600, cutoffSec: 9 * 3600 + 90 },
  { checkpoint: 'pre-auction', phase: 'premarket', label: '09:14 竞价前最终外部环境', atSec: 9 * 3600 + 14 * 60 + 30, cutoffSec: 9 * 3600 + 15 * 60 },
  { checkpoint: 'auction-initial', phase: 'auction', label: '09:15 首次聚合申报', atSec: 9 * 3600 + 15 * 60 + 5, cutoffSec: 9 * 3600 + 16 * 60 },
  { checkpoint: 'auction-probe', phase: 'auction', label: '09:17 可撤单试盘结构', atSec: 9 * 3600 + 17 * 60 + 30, cutoffSec: 9 * 3600 + 18 * 60 + 30 },
  { checkpoint: 'auction-prelock', phase: 'auction', label: '09:19 锁价前峰值结构', atSec: 9 * 3600 + 19 * 60 + 50, cutoffSec: 9 * 3600 + 20 * 60 + 5 },
  { checkpoint: 'auction-lock', phase: 'auction', label: '09:20 不可撤单初始', atSec: 9 * 3600 + 20 * 60 + 5, cutoffSec: 9 * 3600 + 21 * 60 },
  { checkpoint: 'auction-locked-mid', phase: 'auction', label: '09:22 锁定阶段持续性', atSec: 9 * 3600 + 22 * 60 + 30, cutoffSec: 9 * 3600 + 23 * 60 + 30 },
  { checkpoint: 'auction-prefinal', phase: 'auction', label: '09:24 竞价结束前状态', atSec: 9 * 3600 + 24 * 60 + 50, cutoffSec: 9 * 3600 + 25 * 60 + 5 },
  { checkpoint: 'auction-final', phase: 'auction', label: '09:25 正式开盘价固化', atSec: 9 * 3600 + 25 * 60 + 5, cutoffSec: 9 * 3600 + 26 * 60 },
  { checkpoint: 'open-initial', phase: 'open', label: '09:30 首笔成交确认', atSec: 9 * 3600 + 30 * 60 + 5, cutoffSec: 9 * 3600 + 31 * 60 },
  { checkpoint: 'open-confirm', phase: 'open', label: '09:35 五分钟承接确认', atSec: 9 * 3600 + 35 * 60, cutoffSec: 9 * 3600 + 36 * 60 },
  { checkpoint: 'settled', phase: 'settled', label: '15:10 结算归档', atSec: 15 * 3600 + 10 * 60, cutoffSec: 15 * 3600 + 12 * 60 },
]

export function checkpointSpec(checkpoint: SchedulerCheckpoint): CheckpointSpec {
  const spec = CHECKPOINT_SCHEDULE.find((row) => row.checkpoint === checkpoint)
  if (!spec) throw new Error(`未知检查点: ${checkpoint}`)
  return spec
}

/** 检查点 → 顶层阶段。 */
export function phaseOfCheckpoint(checkpoint: SchedulerCheckpoint): SchedulerPhase {
  return checkpointSpec(checkpoint).phase
}

/** 某阶段的全部检查点。 */
export function checkpointsForPhase(phase: SchedulerPhase): SchedulerCheckpoint[] {
  return CHECKPOINT_SCHEDULE.filter((row) => row.phase === phase).map((row) => row.checkpoint)
}

function shanghaiClockAt(nowMs: number): { day: number; sec: number } {
  const sh = new Date(nowMs + 8 * 3_600_000)
  return {
    day: sh.getUTCDay(),
    sec: sh.getUTCHours() * 3600 + sh.getUTCMinutes() * 60 + sh.getUTCSeconds(),
  }
}

/** 当前正处于 on-time 窗口的检查点(无则 null)。仅供内部与测试。 */
export function checkpointInWindowAt(nowMs: number): SchedulerCheckpoint | null {
  const clock = shanghaiClockAt(nowMs)
  if (!isTradingDayAt(nowMs)) return null
  const found = CHECKPOINT_SCHEDULE.find(
    (row) => clock.sec >= row.atSec && clock.sec < row.cutoffSec,
  )
  return found?.checkpoint ?? null
}

/** 下一个尚未开始的检查点(用于状态接口展示)。 */
export function nextCheckpointAt(nowMs: number): CheckpointSpec | null {
  const clock = shanghaiClockAt(nowMs)
  if (!isTradingDayAt(nowMs)) return null
  const upcoming = CHECKPOINT_SCHEDULE.find((row) => clock.sec < row.atSec)
  return upcoming ?? null
}

function isWeekdayAt(nowMs: number): boolean {
  const day = shanghaiClockAt(nowMs).day
  return day !== 0 && day !== 6
}

function isUsableCheckpointStatus(status: SchedulerStatus | undefined): status is SchedulerStatus {
  return Boolean(
    status &&
      (status.status === 'success' || status.status === 'degraded') &&
      status.captureStatus !== 'unavailable',
  )
}

/** 成功或最终降级才阻止同一窗口的重复运行;失败状态允许继续重试。 */
export function isTerminalCheckpointStatus(status: SchedulerStatus | null): boolean {
  return status?.status === 'success' || status?.status === 'degraded'
}

function currentPhaseAt(nowMs: number): SchedulerPhase | null {
  if (!isWeekdayAt(nowMs)) return null
  const clock = shanghaiClockAt(nowMs)
  const active = CHECKPOINT_SCHEDULE.find(
    (row) => clock.sec >= row.atSec && clock.sec < row.cutoffSec,
  )
  if (active) return active.phase
  const latest = CHECKPOINT_SCHEDULE.filter((row) => clock.sec >= row.atSec).at(-1)
  return latest?.phase ?? 'premarket'
}

function checkpointView(
  spec: CheckpointSpec,
  status: SchedulerStatus | undefined,
  nowMs: number,
): SchedulerCheckpointView {
  const clock = shanghaiClockAt(nowMs)
  const windowEnded = isWeekdayAt(nowMs) && clock.sec >= spec.cutoffSec
  return {
    checkpoint: spec.checkpoint,
    phase: spec.phase,
    label: spec.label,
    atSecondsOfDay: spec.atSec,
    cutoffSecondsOfDay: spec.cutoffSec,
    status: status?.status ?? (windowEnded ? 'missing' : 'scheduled'),
    captureStatus: status?.captureStatus ?? 'unavailable',
    sourceStatus: status?.sourceStatus ?? 'unavailable',
    runId: status?.runId || undefined,
    provider: status?.provider,
    providerTimestamp: status?.providerTimestamp,
    finishedAt: status?.finishedAt,
    dataAsOf: status?.dataAsOf,
    warnings: status?.warnings ?? (windowEnded ? [`${spec.checkpoint} 尚无归档`] : []),
  }
}

/** 只读汇总调度状态,不触发采集、不写入归档。 */
export function buildSchedulerStatusSnapshot(
  nowMs = Date.now(),
  tradeDate = todayShanghai(nowMs),
): SchedulerStatusSnapshot {
  const lastRuns = listCheckpointStatuses(tradeDate)
  const next = nextCheckpointAt(nowMs)
  const checkpoints = Object.fromEntries(
    CHECKPOINT_SCHEDULE.map((spec) => [
      spec.checkpoint,
      checkpointView(spec, lastRuns[spec.checkpoint], nowMs),
    ]),
  ) as Record<string, SchedulerCheckpointView>
  const missingCheckpoints = CHECKPOINT_SCHEDULE.filter((spec) => {
    const view = checkpoints[spec.checkpoint]
    return view.status === 'missing' ||
      view.status === 'failed' ||
      view.status === 'skipped' ||
      (view.captureStatus === 'unavailable' && view.status !== 'scheduled')
  }).map((spec) => spec.checkpoint)
  const lastGood = Object.fromEntries(
    Object.entries(lastRuns).filter(([, status]) => isUsableCheckpointStatus(status)),
  )
  const warnings = [
    ...missingCheckpoints.map((checkpoint) => `${checkpoint} 缺少可用归档`),
    ...Object.values(lastRuns).flatMap((status) => status.warnings),
  ].filter((warning, index, all) => all.indexOf(warning) === index).slice(0, 40)
  return {
    now: new Date(nowMs).toISOString(),
    tradeDate,
    currentPhase: currentPhaseAt(nowMs),
    currentCheckpoint: checkpointInWindowAt(nowMs),
    lastRuns,
    missingCheckpoints,
    nextWindow: next
      ? {
          checkpoint: next.checkpoint,
          phase: next.phase,
          label: next.label,
          atSecondsOfDay: next.atSec,
        }
      : null,
    checkpoints,
    lastGood,
    warnings,
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url))

export function checkpointStatusRoot(): string {
  return process.env.SCHEDULER_STATUS_ROOT ??
    join(__dirname, '..', '..', 'docs', 'scheduler', 'status')
}

function safeDate(tradeDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(tradeDate)
}

export function checkpointStatusPath(tradeDate: string, checkpoint: SchedulerCheckpoint): string {
  if (!safeDate(tradeDate)) throw new Error(`tradeDate 必须是 YYYY-MM-DD，收到 ${tradeDate}`)
  return join(checkpointStatusRoot(), tradeDate, `${checkpoint}.json`)
}

/** 写入检查点状态:临时文件 + 原子替换。调用方负责 on-time 判定。 */
export function writeCheckpointStatus(status: SchedulerStatus): SchedulerStatus {
  const target = checkpointStatusPath(status.tradeDate, status.checkpoint)
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(status, null, 2), 'utf8')
  renameSync(temp, target)
  return status
}

export function readCheckpointStatus(
  tradeDate: string,
  checkpoint: SchedulerCheckpoint,
): SchedulerStatus | null {
  const path = checkpointStatusPath(tradeDate, checkpoint)
  if (!safeDate(tradeDate) || !existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SchedulerStatus
  } catch {
    return null
  }
}

export function listCheckpointStatuses(
  tradeDate: string,
): Record<string, SchedulerStatus> {
  const root = join(checkpointStatusRoot(), tradeDate)
  if (!safeDate(tradeDate) || !existsSync(root)) return {}
  const out: Record<string, SchedulerStatus> = {}
  for (const file of readdirSync(root)) {
    if (!file.endsWith('.json')) continue
    const checkpoint = file.slice(0, -5) as SchedulerCheckpoint
    const status = readCheckpointStatus(tradeDate, checkpoint)
    if (status) out[checkpoint] = status
  }
  return out
}

/**
 * 只读解析检查点状态:优先返回已有归档,归档缺失返回 unavailable。
 * 永不用当前实时数据补建过去阶段的正式快照。
 */
export function resolveCheckpointStatus(
  tradeDate: string,
  checkpoint: SchedulerCheckpoint,
): SchedulerStatus {
  const archived = readCheckpointStatus(tradeDate, checkpoint)
  if (archived) return archived
  return {
    runId: '',
    tradeDate,
    phase: phaseOfCheckpoint(checkpoint),
    checkpoint,
    status: 'skipped',
    captureStatus: 'unavailable',
    sourceStatus: 'unavailable',
    startedAt: '',
    warnings: [`${checkpoint} 冻结窗口已过或无归档，返回 unavailable`],
  }
}

export function newRunId(tradeDate: string, checkpoint: SchedulerCheckpoint): string {
  return `${checkpoint}-${tradeDate}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 检查点调度器默认的采集句柄;外部可按检查点覆盖(测试注入)。 */
export interface CheckpointHandlers {
  (checkpoint: SchedulerCheckpoint, tradeDate: string): Promise<
    Record<string, unknown> | null
  >
}

let checkpointMonitor: ReturnType<typeof setInterval> | null = null
let checkpointMonitorBusy = false

export async function runCheckpointSchedulerTick(
  handlers: CheckpointHandlers,
  nowMs = Date.now(),
): Promise<void> {
  if (checkpointMonitorBusy) return
  const tradeDate = todayShanghai(nowMs)
  const checkpoint = checkpointInWindowAt(nowMs)
  if (!checkpoint) return
  if (isTerminalCheckpointStatus(readCheckpointStatus(tradeDate, checkpoint))) return
  checkpointMonitorBusy = true
  const runId = newRunId(tradeDate, checkpoint)
  const startedAt = new Date(nowMs).toISOString()
  const captureStatus: SchedulerCaptureStatus = 'on-time'
  try {
    const partial = (await handlers(checkpoint, tradeDate)) ?? {}
    const sourceStatus = (partial.sourceStatus as SchedulerSourceStatus | undefined) ??
      'unavailable'
    const result: SchedulerStatus = {
      runId,
      tradeDate,
      phase: phaseOfCheckpoint(checkpoint),
      checkpoint,
      status:
        partial.status === 'success' || partial.status === 'degraded' || partial.status === 'failed'
          ? (partial.status as SchedulerRunStatus)
          : sourceStatus === 'full'
            ? 'success'
            : sourceStatus === 'degraded'
              ? 'degraded'
              : 'failed',
      captureStatus,
      sourceStatus,
      provider: partial.provider as string | undefined,
      providerTimestamp: partial.providerTimestamp as string | undefined,
      startedAt,
      finishedAt: new Date(nowMs).toISOString(),
      dataAsOf: partial.dataAsOf as string | undefined,
      warnings: Array.isArray(partial.warnings)
        ? (partial.warnings as string[])
        : [],
      error: typeof partial.error === 'string' ? partial.error : undefined,
    }
    writeCheckpointStatus(result)
  } catch {
    const result: SchedulerStatus = {
      runId,
      tradeDate,
      phase: phaseOfCheckpoint(checkpoint),
      checkpoint,
      status: 'failed',
      captureStatus,
      sourceStatus: 'unavailable',
      startedAt,
      finishedAt: new Date(nowMs).toISOString(),
      warnings: [checkpoint + ' 采集失败，等待下一次 tick 重试'],
    }
    writeCheckpointStatus(result)
  } finally {
    checkpointMonitorBusy = false
  }
}

/**
 * 启动单实例检查点调度器。
 *
 * 每个正式检查点被处理句柄驱动;句柄返回部分状态,由调度器补齐时间戳并幂等落盘。
 * 任何时刻只允许一个检查点在 on-time 窗口内运行;错过窗口的检查点不补建。
 * 开发环境可用 SCHEDULER_CHECKPOINTS_DISABLED=true 关闭。
 */
export function startCheckpointScheduler(handlers: CheckpointHandlers): boolean {
  if (process.env.SCHEDULER_CHECKPOINTS_DISABLED === 'true') return false
  if (checkpointMonitor) return false
  checkpointMonitor = setInterval(() => void runCheckpointSchedulerTick(handlers), 5_000)
  checkpointMonitor.unref?.()
  void runCheckpointSchedulerTick(handlers)
  return true
}
/** 测试钩子:重置单实例状态。 */
export function resetCheckpointScheduler(): void {
  if (checkpointMonitor) {
    clearInterval(checkpointMonitor)
    checkpointMonitor = null
  }
  checkpointMonitorBusy = false
}