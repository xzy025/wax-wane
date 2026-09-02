// 核心 300 美股三年调整日频回填 CLI。
//
// 用法:
//   npm run backfill:us-daily                          # 全量核心 300
//   npm --prefix server run backfill:us-daily -- --limit 12
//   npm --prefix server run backfill:us-daily -- --tickers SPY,AXTI,LITE,MRNA
//   npm --prefix server run backfill:us-daily -- --force --years 3
//
// 输出:docs/cross-market/raw/<source>/<YYYY-MM-DD>/<ticker>.json 原始归档
//       docs/cross-market/reports/us-daily-backfill-<YYYY-MM-DD>.json 覆盖率审计
// 以非零退出码表示存在覆盖率缺口或全部不可用,便于接入调度告警。

import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORE_US_ASSET_UNIVERSE } from '../services/crossMarketMapping'
import { runUsDailyBackfill } from '../services/crossMarketBackfill'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, '..', '.env') })

function parseArgs(): { limit: number | null; tickers: string[]; force: boolean; skipEm: boolean; years: number; concurrency: number; reference: string } {
  const args = process.argv.slice(2)
  const result = { limit: null as number | null, tickers: [] as string[], force: false, skipEm: false, years: 3, concurrency: 6, reference: 'SPY' }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--limit') result.limit = Number(args[++index])
    else if (arg === '--tickers') result.tickers = (args[++index] ?? '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean)
    else if (arg === '--force') result.force = true
    else if (arg === '--skip-em') result.skipEm = true
    else if (arg === '--years') result.years = Number(args[++index])
    else if (arg === '--concurrency') result.concurrency = Number(args[++index])
    else if (arg === '--reference') result.reference = String(args[++index]).toUpperCase()
  }
  return result
}

async function main() {
  const args = parseArgs()
  const universeTickers = CORE_US_ASSET_UNIVERSE.map((asset) => asset.ticker)
  const tickers = args.tickers.length
    ? args.tickers
    : args.limit != null && args.limit > 0
      ? universeTickers.slice(0, args.limit)
      : universeTickers

  console.log(`[backfill:us-daily] ${tickers.length} tickers · years=${args.years} · reference=${args.reference} · force=${args.force} · skipEm=${args.skipEm} · concurrency=${args.concurrency}`)
  const startedAt = Date.now()
  const report = await runUsDailyBackfill({
    tickers,
    referenceTicker: args.reference,
    force: args.force,
    skipEastmoney: args.skipEm,
    years: args.years,
    concurrency: args.concurrency,
    onTickerDone: (ticker, row) => {
      console.log(`  ✓ ${ticker} ${row.source ?? '无来源'} bars=${row.sessionCount} coverage=${row.coveragePct ?? '-'}% (${((Date.now() - startedAt) / 1000).toFixed(1)}s)` + (row.warnings.length ? ` · ${row.warnings[0]}` : ''))
    },
    onReferenceDone: (reference, barCount) => {
      console.log(`[backfill:us-daily] 参考日历 ${reference} 完成 · 可用=${barCount > 0} · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
    },
  })

  console.log(`[backfill:us-daily] runDate=${report.runDate} 请求=${report.requestedTickers}`)
  console.log(`  full=${report.summary.fullCount} degraded=${report.summary.degradedCount} unavailable=${report.summary.unavailableCount}`)
  console.log(`  adjusted=${report.summary.adjustedOnlyCount} raw=${report.summary.rawOnlyCount} 来源=`, JSON.stringify(report.summary.sources))
  for (const warning of report.summary.warnings) console.log(`  ! ${warning}`)
  const problemRows = report.rows.filter((row) => row.source == null || row.status === 'unavailable' || row.coveragePct == null || row.coveragePct < 95)
  for (const row of problemRows) {
    console.log(`  ✗ ${row.ticker} ${row.source ?? '无来源'} sessions=${row.sessionCount} coverage=${row.coveragePct}% ${row.warnings.join(' ; ')}`)
  }
  if (problemRows.length) console.log(`[backfill:us-daily] ${problemRows.length} 行存在覆盖率/来源缺口`)
  const gatePassed = report.rows.filter((row) => row.source != null && row.coveragePct != null && row.coveragePct >= 95).length / Math.max(1, report.rows.length) >= 0.95
  console.log(gatePassed ? '[backfill:us-daily] 覆盖率 ≥95% 门槛通过' : '[backfill:us-daily] 未达 95% 覆盖率门槛，仅 research 可用')
  process.exit(0)
}

main().catch((error) => {
  console.error('[backfill:us-daily] 失败:', error)
  process.exit(1)
})