import { todayShanghai } from '../lib/time'
import { isTradingDayAt, shanghaiClockAt } from './tradingCalendar'
import { clearMoneyFlowCache, fetchDragonTiger } from './moneyflow'
import { getStrategy } from '../strategy/loader'
import { buildLhbIndex } from './lhbHistory'

const POLL_MINUTES = new Set([
  16 * 60 + 30,
  16 * 60 + 50,
  17 * 60 + 10,
  17 * 60 + 30,
  18 * 60,
  18 * 60 + 30,
  19 * 60,
])
const TICK_MS = 30_000

let lastRunKey = ''
let moneyFlowScheduler: ReturnType<typeof setInterval> | null = null
/** 抓取今日已发布的龙虎榜，写单日展示快照与机构席位因子快照。 */
export async function refreshMoneyFlowSnapshot(): Promise<boolean> {
  clearMoneyFlowCache()
  const result = await fetchDragonTiger(undefined, 1)
  const today = todayShanghai()
  if (result.tradeDate !== today || result.buy.length + result.sell.length === 0) {
    console.log('[DragonTiger] 今日榜尚未发布（上游最新 ' + result.tradeDate + '），稍后重试')
    return false
  }

  await buildLhbIndex([today], { institutional: true, concurrency: 1, force: true })
  getStrategy()?.panels?.clearInstitutionAccumCache?.()
  const { clearHotListCache } = await import('./hotlist')
  clearHotListCache()
  console.log(
    '[DragonTiger] ' + today + ' 快照已更新：' + (result.buy.length + result.sell.length) + ' 只，状态 ' + result.status,
  )

  // 龙虎榜晚于 15:10 日报生成。发布后重算数据区，避免当日复盘永久缺失龙虎榜；
  // 已生成的叙事仍复用，不额外消耗 LLM。
  try {
    const { clearDailyReviewCache, fetchDailyReview } = await import('./dailyReview')
    clearDailyReviewCache()
    await fetchDailyReview()
  } catch (err) {
    console.warn('[DragonTiger] 每日复盘回填失败(非致命):', err instanceof Error ? err.message : err)
  }
  return true
}

export type MoneyFlowSchedulerMode = 'scheduled' | 'catch-up' | null

export function moneyFlowSchedulerMode(nowMs = Date.now()): MoneyFlowSchedulerMode {
  const { minutes } = shanghaiClockAt(nowMs)
  if (!isTradingDayAt(nowMs)) return null
  if (POLL_MINUTES.has(minutes)) return 'scheduled'
  return minutes >= 16 * 60 + 30 ? 'catch-up' : null
}

export async function runMoneyFlowSchedulerTick(nowMs = Date.now()): Promise<void> {
  const mode = moneyFlowSchedulerMode(nowMs)
  const { minutes } = shanghaiClockAt(nowMs)
  const tradeDate = todayShanghai(nowMs)
  if (!mode) return
  if (mode === 'catch-up' && lastRunKey.startsWith(tradeDate + ':')) return
  const key = tradeDate + ':' + (mode === 'scheduled' ? minutes : 'catch-up')
  if (key === lastRunKey) return
  lastRunKey = key
  await refreshMoneyFlowSnapshot().catch((err) => {
    console.warn('[DragonTiger] 定时快照失败:', err instanceof Error ? err.message : err)
  })
}

/** 服务进程内调度；进程未运行时需由 Windows 任务计划程序负责拉起服务。 */
export function startMoneyFlowScheduler(): boolean {
  if (moneyFlowScheduler) return false

  // 若服务在盘后轮询窗口内才启动，立即补一次，不必等下一个固定时间点。
  const { minutes } = shanghaiClockAt()
  if (isTradingDayAt() && minutes >= 16 * 60 + 30) {
    setTimeout(() => {
      void runMoneyFlowSchedulerTick()
    }, 2_000).unref()
  }

  moneyFlowScheduler = setInterval(() => void runMoneyFlowSchedulerTick(), TICK_MS)
  moneyFlowScheduler.unref()
  return true
}

export function resetMoneyFlowScheduler(): void {
  if (moneyFlowScheduler) {
    clearInterval(moneyFlowScheduler)
    moneyFlowScheduler = null
  }
  lastRunKey = ''
}
