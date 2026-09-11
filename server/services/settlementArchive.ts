import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { todayShanghai } from '../lib/time'
import { validSettlementArchive, type ArchiveKind } from './settlementQuality'
import type { ScreenerSnapshot } from './screenerDataContract'
import { getStrategy } from '../strategy/loader'
import { isTradingDayAt, shanghaiClockAt } from './tradingCalendar'
import {
  clearMarketStructureCache,
  fetchMarketStructure,
  type MarketStructureSummary,
} from './marketStructure'
import {
  clearRotationTempoCache,
  fetchRotationTempo,
  type RotationTempoResult,
} from './rotationTempo'
import {
  clearDailyReviewCache,
  fetchDailyReview,
  type DailyReviewData,
} from './dailyReview'
import {
  clearLimitLadderCache,
  LadderFormalEligibilityError,
  fetchLimitLadderAnalysis,
  fetchLimitLadderNextDay,
  listLimitLadderArchiveDates,
  type LimitLadderAnalysis,
} from './limitLadder'
import {
  buildPromotionReview,
  loadPromotionInputs,
  writePromotionReview,
  type PromotionReview,
} from './promotionReview'
import { syncDailyJournal, type DailyJournalResult } from './dailyJournal'
import {
  SETTLEMENT_ARCHIVE_ATTEMPT_TIMEOUT_MS,
  SETTLEMENT_ARCHIVE_DEADLINE_MINUTES,
  SETTLEMENT_ARCHIVE_START_MINUTES,
  SETTLEMENT_ARCHIVE_STEP_TIMEOUT_MS,
  settlementDeadlineAt,
  settlementNextRetryAt,
} from './settlementArchiveRetry'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENER_ROOT = join(__dirname, '..', '..', 'docs', 'screener')
const LADDER_ROOT = join(__dirname, '..', '..', 'docs', 'ladder')
const SETTLEMENT_RUNTIME_PATH = join(__dirname, '..', '..', '.runtime', 'settlement-archive-scheduler.json')

export type SettlementStepName =
  | 'screener'
  | 'structure'
  | 'tempo'
  | 'review'
  | 'forward'
  | 'ladder'
  | 'previous-outcome'
  | 'promotion-review'
  | 'daily-journal'

export interface SettlementStepStatus {
  name: SettlementStepName
  status: 'completed' | 'skipped' | 'failed'
  reason?: string
}

export interface SettledArchiveSchedulerStatus {
  tradeDate: string | null
  lastAttemptAt: string | null
  nextRetryAt: string | null
  action: 'idle' | 'running' | 'partial' | 'completed'
  completionLevel?: 'core-incomplete' | 'core-complete-with-gaps' | 'complete'
  steps: SettlementStepStatus[]
  error: string | null
  attemptCount?: number
  deadlineAt?: string | null
  terminalReason?: 'deadline-exceeded' | 'historical-replay-required' | null
}

interface PersistedSettlementSchedulerState {
  version: 1
  statuses: Record<string, SettledArchiveSchedulerStatus>
}

export interface SettlementArchiveDeps {
  hasScreenerArchive: (date: string) => boolean
  hasStructureArchive: (date: string) => boolean
  hasTempoArchive: (date: string) => boolean
  hasReviewArchive: (date: string) => boolean
  hasForwardArchive: (date: string) => boolean
  hasLadderArchive: (date: string) => boolean
  scanScreener?: () => Promise<ScreenerSnapshot>
  fetchMarketStructure: () => Promise<MarketStructureSummary>
  fetchRotationTempo: () => Promise<RotationTempoResult>
  fetchDailyReview: () => Promise<DailyReviewData>
  fetchScreenerForward?: () => Promise<{ asof: string }>
  fetchLimitLadderAnalysis: (date: string) => Promise<LimitLadderAnalysis>
  fetchLimitLadderNextDay: (date: string) => Promise<unknown>
  listLimitLadderArchiveDates: (limit: number) => string[]
  loadPromotionInputs: () => ReturnType<typeof loadPromotionInputs>
  buildPromotionReview: (inputs: ReturnType<typeof loadPromotionInputs>) => PromotionReview
  writePromotionReview: (review: PromotionReview) => unknown
  syncDailyJournal: (date: string) => DailyJournalResult
}


/** Presence + date is not enough: reject legacy/weak archives so retries can
 * repair them instead of treating them as permanently complete. */
const readAsOf = (path: string, date: string, kind?: ArchiveKind): boolean => {
  if (!existsSync(path)) return false
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { asof?: string }
    return kind ? validSettlementArchive(value, date, kind) : value.asof === date
  } catch {
    return false
  }
}

function screenerArchive(date: string): boolean {
  return readAsOf(join(SCREENER_ROOT, `${date}.json`), date, 'screener')
}

function datedArchive(root: string, prefix: string, date: string): boolean {
  const kind = prefix as ArchiveKind
  return readAsOf(join(root, `${prefix}-${date}.json`), date, kind)
}

function ladderArchive(date: string): boolean {
  const [year, month, day] = date.split('-')
  const root = join(LADDER_ROOT, year, month, day)
  if (!existsSync(root)) return false
  return readdirSync(root).some((name) => {
    if (!/^analysis-limit-ladder-v\d+(?:-r\d+)?\.json$/i.test(name)) return false
    return readAsOf(join(root, name), date, 'ladder')
  })
}

const defaultDeps: SettlementArchiveDeps = {
  hasScreenerArchive: screenerArchive,
  hasStructureArchive: (date) => datedArchive(SCREENER_ROOT, 'structure', date),
  hasTempoArchive: (date) => datedArchive(SCREENER_ROOT, 'tempo', date),
  hasReviewArchive: (date) => datedArchive(SCREENER_ROOT, 'review', date),
  hasForwardArchive: (date) => datedArchive(SCREENER_ROOT, 'forward', date),
  hasLadderArchive: ladderArchive,
  fetchMarketStructure: async () => {
    clearMarketStructureCache()
    return fetchMarketStructure()
  },
  fetchRotationTempo: async () => {
    clearRotationTempoCache()
    return fetchRotationTempo()
  },
  fetchDailyReview: async () => {
    clearDailyReviewCache()
    return fetchDailyReview()
  },
  fetchLimitLadderAnalysis: async (date) => {
    clearLimitLadderCache()
    return fetchLimitLadderAnalysis(date)
  },
  fetchLimitLadderNextDay,
  listLimitLadderArchiveDates,
  loadPromotionInputs: () => loadPromotionInputs(LADDER_ROOT),
  buildPromotionReview,
  writePromotionReview: (review) => writePromotionReview(LADDER_ROOT, review),
  syncDailyJournal: (date) => syncDailyJournal(date, SCREENER_ROOT),
}

/**
 * 把私有战法层提供的面板接到 deps 上。
 *
 * 公开侧只认「有没有这个能力」；具体实现（选股扫描 / 前瞻战绩）在私有包里，
 * 未安装时保持 undefined，对应步骤在 runStep 里降级为 skipped。
 */
function withStrategy(deps: SettlementArchiveDeps): SettlementArchiveDeps {
  const panels = getStrategy()?.panels
  return {
    ...deps,
    scanScreener:
      deps.scanScreener ??
      (panels?.scanScreener
        ? async () => {
            panels.clearScreenerCache?.()
            return panels.scanScreener!('close')
          }
        : undefined),
    fetchScreenerForward:
      deps.fetchScreenerForward ??
      (panels?.fetchScreenerForward
        ? async () => {
            panels.clearScreenerForwardCache?.()
            return panels.fetchScreenerForward!()
          }
        : undefined),
  }
}

function emptyStatus(tradeDate: string | null = null): SettledArchiveSchedulerStatus {
  return {
    tradeDate,
    lastAttemptAt: null,
    nextRetryAt: null,
    action: 'idle',
    steps: [],
    error: null,
    attemptCount: 0,
    deadlineAt: tradeDate ? new Date(settlementDeadlineAt(tradeDate)).toISOString() : null,
    terminalReason: null,
  }
}

function readPersistedState(): PersistedSettlementSchedulerState {
  try {
    const parsed = JSON.parse(readFileSync(SETTLEMENT_RUNTIME_PATH, 'utf8')) as Partial<PersistedSettlementSchedulerState>
    if (parsed.version !== 1 || !parsed.statuses || typeof parsed.statuses !== 'object') {
      return { version: 1, statuses: {} }
    }
    return { version: 1, statuses: parsed.statuses as Record<string, SettledArchiveSchedulerStatus> }
  } catch {
    return { version: 1, statuses: {} }
  }
}

function persistStatus(next: SettledArchiveSchedulerStatus): void {
  if (!next.tradeDate) return
  const state = readPersistedState()
  const statuses = {
    ...state.statuses,
    [next.tradeDate]: {
      ...next,
      steps: next.steps.map((step) => ({ ...step })),
    },
  }
  // Keep enough history for an operator to inspect recent missed dates while
  // preventing this runtime file from growing without bound.
  const retainedDates = Object.keys(statuses).sort().slice(-30)
  const retained = Object.fromEntries(retainedDates.map((date) => [date, statuses[date]]))
  mkdirSync(dirname(SETTLEMENT_RUNTIME_PATH), { recursive: true })
  const temp = `${SETTLEMENT_RUNTIME_PATH}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify({ version: 1, statuses: retained }, null, 2), 'utf8')
  renameSync(temp, SETTLEMENT_RUNTIME_PATH)
}

function persistStatusSafely(next: SettledArchiveSchedulerStatus): void {
  try {
    persistStatus(next)
  } catch (error) {
    // Runtime diagnostics must never turn a recoverable market-data failure
    // into a process failure. The in-memory status remains available to the
    // read-only endpoint for this process.
    console.warn(`[SettledArchive] 无法保存调度状态: ${errorMessage(error)}`)
  }
}

function persistedStatusFor(date: string): SettledArchiveSchedulerStatus | null {
  const candidate = readPersistedState().statuses[date]
  return candidate?.tradeDate === date
    ? { ...candidate, steps: Array.isArray(candidate.steps) ? candidate.steps.map((step) => ({ ...step })) : [] }
    : null
}

let busy = false
let status: SettledArchiveSchedulerStatus = persistedStatusFor(todayShanghai()) ?? emptyStatus()

export function getSettledArchiveSchedulerStatus(): SettledArchiveSchedulerStatus {
  return { ...status, steps: status.steps.map((step) => ({ ...step })) }
}

export function isSettledArchiveWindowAt(nowMs = Date.now()): boolean {
  const clock = shanghaiClockAt(nowMs)
  return isTradingDayAt(nowMs) &&
    clock.minutes >= SETTLEMENT_ARCHIVE_START_MINUTES &&
    clock.minutes < SETTLEMENT_ARCHIVE_DEADLINE_MINUTES
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runBounded<T>(label: string, run: () => Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) throw new Error(`${label} 已达到本次尝试截止时间`)
  let timeout: ReturnType<typeof setTimeout> | null = null
  const operation = run()
  void operation.catch(() => undefined)
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} 任务超过 ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function runStep<T extends { asof?: string }>(
  date: string,
  step: SettlementStepName,
  hasArchive: (date: string) => boolean,
  run: (() => Promise<T>) | undefined,
  timeoutMs: number,
): Promise<SettlementStepStatus> {
  // 该步骤由私有战法层提供；未安装时跳过，不算失败。
  if (!run) return { name: step, status: 'skipped', reason: '未安装私有战法层，该步骤跳过' }
  if (hasArchive(date)) {
    return { name: step, status: 'skipped', reason: '当日归档已存在' }
  }
  if (timeoutMs <= 0) {
    return { name: step, status: 'failed', reason: `${step} 已达到本次尝试截止时间` }
  }
  try {
    // The provider adapters own request-level AbortSignal timeouts. This
    // second boundary protects the scheduler when a whole adapter hangs or a
    // fan-out forgets to settle; a late rejection is consumed below so it
    // cannot become an unhandled process-level error.
    const result = await runBounded(step, run, timeoutMs)
    if (result.asof !== date) {
      throw new Error(`结果 asof=${result.asof ?? '未知'} 与 ${date} 不一致`)
    }
    if (!hasArchive(date)) {
      throw new Error('计算完成但目标归档未生成')
    }
    return { name: step, status: 'completed' }
  } catch (error) {
    return { name: step, status: 'failed', reason: errorMessage(error) }
  }
}

interface SettlementPipelineOptions {
  nowMs?: number
  attemptCount?: number
  deadlineAt?: number
  /** Scheduler-provided hard cutoff for this one pipeline attempt. */
  attemptDeadlineAt?: number
  stepTimeoutMs?: number
}

/**
 * 结算后物化所有依赖链。每一步都验证 asof 与目标归档，避免 cache fallback
 * 把最近旧档误报成今日成功；缺数据时保留 partial 并在下一次 tick 重试。
 */
export async function runSettledArchivePipeline(
  date: string,
  deps: SettlementArchiveDeps = defaultDeps,
  options: SettlementPipelineOptions = {},
): Promise<SettledArchiveSchedulerStatus> {
  // 选股快照 / 实盘战绩来自私有战法层 —— 在这里接上，缺失时上面两个步骤跳过。
  deps = withStrategy(deps)
  const nowMs = options.nowMs ?? Date.now()
  const attemptCount = Math.max(1, options.attemptCount ?? 1)
  const deadlineMs = options.deadlineAt ?? settlementDeadlineAt(date)
  const stepTimeoutMs = options.stepTimeoutMs ?? SETTLEMENT_ARCHIVE_STEP_TIMEOUT_MS
  const timeoutForNextStep = (): number => {
    if (options.attemptDeadlineAt === undefined) return stepTimeoutMs
    return Math.max(0, Math.min(stepTimeoutMs, options.attemptDeadlineAt - Date.now()))
  }

  // The ladder is a smaller, independent settled snapshot. Run it first so a
  // slow full-market screener scan cannot postpone the ladder archive and its
  // outcome/promotion refresh indefinitely.
  // The five source captures are independent. Running them as a bounded
  // all-settled batch prevents a slow screener or narrative request from
  // delaying the ladder retry window.
  const [ladder, screener, structure, tempo, review] = await Promise.all([
    runStep(date, 'ladder', deps.hasLadderArchive, () => deps.fetchLimitLadderAnalysis(date), timeoutForNextStep()),
    runStep(date, 'screener', deps.hasScreenerArchive, deps.scanScreener, timeoutForNextStep()),
    runStep(date, 'structure', deps.hasStructureArchive, deps.fetchMarketStructure, timeoutForNextStep()),
    runStep(date, 'tempo', deps.hasTempoArchive, deps.fetchRotationTempo, timeoutForNextStep()),
    runStep(date, 'review', deps.hasReviewArchive, deps.fetchDailyReview, timeoutForNextStep()),
  ])
  const steps: SettlementStepStatus[] = [ladder, screener, structure, tempo, review]
  const ladderOk = ladder.status === 'completed' || ladder.status === 'skipped'
  const screenerOk = screener.status === 'completed' || screener.status === 'skipped'
  const structureOk = structure.status === 'completed' || structure.status === 'skipped'
  const tempoOk = tempo.status === 'completed' || tempo.status === 'skipped'
  const reviewOk = review.status === 'completed' || review.status === 'skipped'

  if (screenerOk) {
    steps.push(await runStep(date, 'forward', deps.hasForwardArchive, deps.fetchScreenerForward, timeoutForNextStep()))
  } else {
    steps.push({ name: 'forward', status: 'skipped', reason: '选股正式归档缺失，禁止生成错标 forward' })
  }

  if (ladderOk) {
    const previous = deps.listLimitLadderArchiveDates(200)
      .filter((item) => item < date)
      .sort()
      .at(-1)
    if (previous) {
      try {
        await runBounded('previous-outcome', () => deps.fetchLimitLadderNextDay(previous), timeoutForNextStep())
        steps.push({ name: 'previous-outcome', status: 'completed', reason: `已尝试结算 ${previous} 的次日结果` })
      } catch (error) {
        steps.push({ name: 'previous-outcome', status: error instanceof LadderFormalEligibilityError ? 'skipped' : 'failed', reason: errorMessage(error) })
      }
    } else {
      steps.push({ name: 'previous-outcome', status: 'skipped', reason: '没有更早的连板分析归档' })
    }

  } else {
    steps.push({ name: 'previous-outcome', status: 'skipped', reason: '今日连板归档缺失，禁止回填隔日结果' })
  }

  // 晋级复盘只读取已经存在的 settled outcome；今日 signal 即使因质量
  // 门槛未归档，也不应阻断历史统计刷新，更不能把今日预览混入分母。
  try {
    const inputs = deps.loadPromotionInputs()
    if (!inputs.length) {
      steps.push({ name: 'promotion-review', status: 'skipped', reason: '没有已结算 outcome 归档' })
    } else {
      deps.writePromotionReview(deps.buildPromotionReview(inputs))
      steps.push({ name: 'promotion-review', status: 'completed' })
    }
  } catch (error) {
    steps.push({ name: 'promotion-review', status: 'failed', reason: errorMessage(error) })
  }

  if (reviewOk) {
    try {
      const journal = deps.syncDailyJournal(date)
      steps.push({
        name: 'daily-journal',
        status: journal.written ? 'completed' : 'skipped',
        reason: journal.written ? undefined : journal.reason ?? '日报叙事未生成',
      })
    } catch (error) {
      steps.push({ name: 'daily-journal', status: 'failed', reason: errorMessage(error) })
    }
  } else {
    steps.push({ name: 'daily-journal', status: 'skipped', reason: '复盘归档缺失，禁止生成日报条目' })
  }

  const required = [screenerOk, structureOk, tempoOk, reviewOk, ladderOk]
  const nextAction = required.every(Boolean) ? 'completed' : 'partial'
  const lastAttemptAt = new Date(nowMs).toISOString()
  const nextRetry = nextAction === 'completed'
    ? null
    : settlementNextRetryAt(date, attemptCount, nowMs)
  return {
    tradeDate: date,
    lastAttemptAt,
    nextRetryAt: nextRetry === null ? null : new Date(nextRetry).toISOString(),
    action: nextAction,
    completionLevel: nextAction !== 'completed' ? 'core-incomplete'
      : steps.some((step) => step.status !== 'completed' && step.reason !== '当日归档已存在') ? 'core-complete-with-gaps' : 'complete',
    steps,
    error: steps.find((step) => step.status === 'failed')?.reason ?? null,
    attemptCount,
    deadlineAt: Number.isFinite(deadlineMs) ? new Date(deadlineMs).toISOString() : null,
    terminalReason: nextAction === 'partial' && nextRetry === null ? 'deadline-exceeded' : null,
  }
}

export async function runSettledArchiveSchedulerTick(nowMs = Date.now()): Promise<void> {
  const date = todayShanghai(nowMs)
  if (!isTradingDayAt(nowMs)) return
  if (status.tradeDate !== date) {
    status = persistedStatusFor(date) ?? emptyStatus(date)
  }
  if (status.action === 'completed') {
    const checks = [defaultDeps.hasScreenerArchive, defaultDeps.hasStructureArchive, defaultDeps.hasTempoArchive,
      defaultDeps.hasReviewArchive, defaultDeps.hasLadderArchive]
    if (checks.every((check) => check(date))) return
    status = { ...status, action: 'partial', completionLevel: 'core-incomplete', nextRetryAt: null, error: '归档重新验收失败' }
    persistStatusSafely(status)
  }
  const deadlineMs = settlementDeadlineAt(date)
  if (Number.isFinite(deadlineMs) && nowMs >= deadlineMs) {
    if (status.action !== 'completed' && status.terminalReason !== 'deadline-exceeded') {
      status = {
        ...status,
        action: 'partial',
        nextRetryAt: null,
        deadlineAt: new Date(deadlineMs).toISOString(),
        terminalReason: 'deadline-exceeded',
        error: status.error ?? '当日归档截止时间已到，等待次日历史回放',
      }
      persistStatusSafely(status)
    }
    return
  }
  if (!isSettledArchiveWindowAt(nowMs) || busy) return
  if (status.nextRetryAt && Date.parse(status.nextRetryAt) > nowMs) return

  const attemptCount = (status.attemptCount ?? 0) + 1
  busy = true
  status = {
    ...status,
    action: 'running',
    attemptCount,
    lastAttemptAt: new Date(nowMs).toISOString(),
    deadlineAt: new Date(deadlineMs).toISOString(),
    terminalReason: null,
    error: null,
  }
  persistStatusSafely(status)
  try {
    status = await runSettledArchivePipeline(date, withStrategy(defaultDeps), {
      nowMs,
      attemptCount,
      deadlineAt: deadlineMs,
      attemptDeadlineAt: Math.min(deadlineMs, nowMs + SETTLEMENT_ARCHIVE_ATTEMPT_TIMEOUT_MS),
    })
    // The pipeline is bounded per step. Re-evaluate the wall-clock deadline
    // after it returns so a slow final step cannot schedule a retry over the
    // Shanghai date boundary.
    const effectiveNowMs = Math.max(nowMs, Date.now())
    if (status.action !== 'completed' && effectiveNowMs >= deadlineMs) {
      status = {
        ...status,
        nextRetryAt: null,
        terminalReason: 'deadline-exceeded',
        error: status.error ?? '当日归档截止时间已到，等待次日历史回放',
      }
    }
    console.log(`[SettledArchive] ${date} action=${status.action}`)
    for (const step of status.steps) {
      console.log(`[SettledArchive] ${step.status} ${step.name}${step.reason ? `: ${step.reason}` : ''}`)
    }
  } catch (error) {
    status = {
      ...status,
      action: 'partial',
      nextRetryAt: (() => {
        const next = settlementNextRetryAt(date, attemptCount, Math.max(nowMs, Date.now()))
        return next === null ? null : new Date(next).toISOString()
      })(),
      attemptCount,
      deadlineAt: new Date(deadlineMs).toISOString(),
      terminalReason: settlementNextRetryAt(date, attemptCount, Math.max(nowMs, Date.now())) === null
        ? 'deadline-exceeded'
        : null,
      error: errorMessage(error),
    }
    console.warn(`[SettledArchive] ${date} action=partial: ${status.error}`)
  } finally {
    busy = false
    persistStatusSafely(status)
  }
}

/** 测试钩子；不影响生产归档。 */
export function resetSettledArchiveScheduler(): void {
  busy = false
  status = {
    tradeDate: null,
    lastAttemptAt: null,
    nextRetryAt: null,
    action: 'idle',
    steps: [],
    error: null,
  }
}
