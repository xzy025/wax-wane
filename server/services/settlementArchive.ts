import { existsSync, readdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { todayShanghai } from '../lib/time'
import { isTradingDayAt, shanghaiClockAt } from './tradingCalendar'
import {
  clearScreenerCache,
  scanScreener,
  type ScreenerResult,
} from './screener'
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
  clearScreenerForwardCache,
  fetchScreenerForward,
  type ScreenerForwardResult,
} from './screenerForward'
import {
  clearLimitLadderCache,
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

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENER_ROOT = join(__dirname, '..', '..', 'docs', 'screener')
const LADDER_ROOT = join(__dirname, '..', '..', 'docs', 'ladder')
const RETRY_MS = 5 * 60_000

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
  steps: SettlementStepStatus[]
  error: string | null
}

export interface SettlementArchiveDeps {
  hasScreenerArchive: (date: string) => boolean
  hasStructureArchive: (date: string) => boolean
  hasTempoArchive: (date: string) => boolean
  hasReviewArchive: (date: string) => boolean
  hasForwardArchive: (date: string) => boolean
  hasLadderArchive: (date: string) => boolean
  scanScreener: () => Promise<ScreenerResult>
  fetchMarketStructure: () => Promise<MarketStructureSummary>
  fetchRotationTempo: () => Promise<RotationTempoResult>
  fetchDailyReview: () => Promise<DailyReviewData>
  fetchScreenerForward: () => Promise<ScreenerForwardResult>
  fetchLimitLadderAnalysis: (date: string) => Promise<LimitLadderAnalysis>
  fetchLimitLadderNextDay: (date: string) => Promise<unknown>
  listLimitLadderArchiveDates: (limit: number) => string[]
  loadPromotionInputs: () => ReturnType<typeof loadPromotionInputs>
  buildPromotionReview: (inputs: ReturnType<typeof loadPromotionInputs>) => PromotionReview
  writePromotionReview: (review: PromotionReview) => unknown
  syncDailyJournal: (date: string) => DailyJournalResult
}

const readAsOf = (path: string, date: string): boolean => {
  if (!existsSync(path)) return false
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { asof?: unknown }
    return value.asof === date
  } catch {
    return false
  }
}

function screenerArchive(date: string): boolean {
  return readAsOf(join(SCREENER_ROOT, `${date}.json`), date)
}

function datedArchive(root: string, prefix: string, date: string): boolean {
  return readAsOf(join(root, `${prefix}-${date}.json`), date)
}

function ladderArchive(date: string): boolean {
  const [year, month, day] = date.split('-')
  const root = join(LADDER_ROOT, year, month, day)
  if (!existsSync(root)) return false
  return readdirSync(root).some((name) => {
    if (!/^analysis-limit-ladder-v\d+(?:-r\d+)?\.json$/i.test(name)) return false
    return readAsOf(join(root, name), date)
  })
}

const defaultDeps: SettlementArchiveDeps = {
  hasScreenerArchive: screenerArchive,
  hasStructureArchive: (date) => datedArchive(SCREENER_ROOT, 'structure', date),
  hasTempoArchive: (date) => datedArchive(SCREENER_ROOT, 'tempo', date),
  hasReviewArchive: (date) => datedArchive(SCREENER_ROOT, 'review', date),
  hasForwardArchive: (date) => datedArchive(SCREENER_ROOT, 'forward', date),
  hasLadderArchive: ladderArchive,
  scanScreener: async () => {
    clearScreenerCache()
    return scanScreener('close')
  },
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
  fetchScreenerForward: async () => {
    clearScreenerForwardCache()
    return fetchScreenerForward()
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

let busy = false
let status: SettledArchiveSchedulerStatus = {
  tradeDate: null,
  lastAttemptAt: null,
  nextRetryAt: null,
  action: 'idle',
  steps: [],
  error: null,
}

export function getSettledArchiveSchedulerStatus(): SettledArchiveSchedulerStatus {
  return { ...status, steps: status.steps.map((step) => ({ ...step })) }
}

export function isSettledArchiveWindowAt(nowMs = Date.now()): boolean {
  const clock = shanghaiClockAt(nowMs)
  return isTradingDayAt(nowMs) && clock.minutes >= 15 * 60 + 10
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runStep<T extends { asof?: string }>(
  date: string,
  step: SettlementStepName,
  hasArchive: (date: string) => boolean,
  run: () => Promise<T>,
  steps: SettlementStepStatus[],
): Promise<boolean> {
  if (hasArchive(date)) {
    steps.push({ name: step, status: 'skipped', reason: '当日归档已存在' })
    return true
  }
  try {
    const result = await run()
    if (result.asof !== date) {
      throw new Error(`结果 asof=${result.asof ?? '未知'} 与 ${date} 不一致`)
    }
    if (!hasArchive(date)) {
      throw new Error('计算完成但目标归档未生成')
    }
    steps.push({ name: step, status: 'completed' })
    return true
  } catch (error) {
    steps.push({ name: step, status: 'failed', reason: errorMessage(error) })
    return false
  }
}

/**
 * 结算后物化所有依赖链。每一步都验证 asof 与目标归档，避免 cache fallback
 * 把最近旧档误报成今日成功；缺数据时保留 partial 并在下一次 tick 重试。
 */
export async function runSettledArchivePipeline(
  date: string,
  deps: SettlementArchiveDeps = defaultDeps,
): Promise<SettledArchiveSchedulerStatus> {
  const steps: SettlementStepStatus[] = []
  // The ladder is a smaller, independent settled snapshot. Run it first so a
  // slow full-market screener scan cannot postpone the ladder archive and its
  // outcome/promotion refresh indefinitely.
  const ladderOk = await runStep(
    date,
    'ladder',
    deps.hasLadderArchive,
    () => deps.fetchLimitLadderAnalysis(date),
    steps,
  )
  const screenerOk = await runStep(date, 'screener', deps.hasScreenerArchive, deps.scanScreener, steps)
  const structureOk = await runStep(date, 'structure', deps.hasStructureArchive, deps.fetchMarketStructure, steps)
  const tempoOk = await runStep(date, 'tempo', deps.hasTempoArchive, deps.fetchRotationTempo, steps)
  const reviewOk = await runStep(date, 'review', deps.hasReviewArchive, deps.fetchDailyReview, steps)

  if (screenerOk) {
    await runStep(date, 'forward', deps.hasForwardArchive, deps.fetchScreenerForward, steps)
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
        await deps.fetchLimitLadderNextDay(previous)
        steps.push({ name: 'previous-outcome', status: 'completed', reason: `已尝试结算 ${previous} 的次日结果` })
      } catch (error) {
        steps.push({ name: 'previous-outcome', status: 'failed', reason: errorMessage(error) })
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
  return {
    tradeDate: date,
    lastAttemptAt: new Date().toISOString(),
    nextRetryAt: nextAction === 'completed' ? null : new Date(Date.now() + RETRY_MS).toISOString(),
    action: nextAction,
    steps,
    error: steps.find((step) => step.status === 'failed')?.reason ?? null,
  }
}

export async function runSettledArchiveSchedulerTick(nowMs = Date.now()): Promise<void> {
  if (!isSettledArchiveWindowAt(nowMs) || busy) return
  const date = todayShanghai(nowMs)
  if (status.tradeDate !== date) {
    status = { tradeDate: date, lastAttemptAt: null, nextRetryAt: null, action: 'idle', steps: [], error: null }
  }
  if (status.action === 'completed') return
  if (status.nextRetryAt && Date.parse(status.nextRetryAt) > nowMs) return
  busy = true
  status = { ...status, action: 'running', lastAttemptAt: new Date(nowMs).toISOString(), error: null }
  try {
    status = await runSettledArchivePipeline(date)
    console.log(`[SettledArchive] ${date} action=${status.action}`)
    for (const step of status.steps) {
      console.log(`[SettledArchive] ${step.status} ${step.name}${step.reason ? `: ${step.reason}` : ''}`)
    }
  } catch (error) {
    status = {
      ...status,
      action: 'partial',
      nextRetryAt: new Date(nowMs + RETRY_MS).toISOString(),
      error: errorMessage(error),
    }
    console.warn(`[SettledArchive] ${date} action=partial: ${status.error}`)
  } finally {
    busy = false
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
