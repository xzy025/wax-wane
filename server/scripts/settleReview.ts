/**
 * 单次执行盘后复盘物化流水线。
 *
 * 生产服务由 schedulerCoordinator 自动调用；这个入口用于服务未运行、
 * 或需要立即重试某个盘后归档日的本地恢复。只接受当前上海日期，历史日请用
 * backfillDay.ts 的结算时钟垫片，避免把实时数据写成历史信号。
 */
import { todayShanghai } from '../lib/time'
import {
  getSettledArchiveSchedulerStatus,
  isSettledArchiveWindowAt,
  runSettledArchiveSchedulerTick,
} from '../services/settlementArchive'

const requested = process.argv.slice(2).find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg))
const today = todayShanghai()
if (requested && requested !== today) {
  console.error(`[settle-review] 只允许当前交易日 ${today}，收到 ${requested}；历史日期请使用 backfillDay.ts`)
  process.exit(1)
}
if (!isSettledArchiveWindowAt()) {
  console.error('[settle-review] 当前不在交易日 15:10 后的结算归档窗口')
  process.exit(1)
}

await runSettledArchiveSchedulerTick()
const status = getSettledArchiveSchedulerStatus()
console.log(`[settle-review] ${status.tradeDate} action=${status.action}`)
for (const step of status.steps) {
  console.log(`  ${step.status === 'completed' ? '✅' : step.status === 'skipped' ? '⏭️' : '❌'} ${step.name}${step.reason ? `: ${step.reason}` : ''}`)
}
if (status.action !== 'completed') process.exitCode = 1
