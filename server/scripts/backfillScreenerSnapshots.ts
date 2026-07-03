/**
 * 一次性回填：把磁盘上的历史选股快照(docs/screener/YYYY-MM-DD.json)灌入
 * PostgreSQL 的 screener_snapshots 表,使「连续出现天数」/「实盘战绩」等
 * DB 优先路径立即拥有历史(而非依赖磁盘兜底)。
 *
 * 运行(cwd=server,以加载 server/.env 的 PG 配置):
 *   npm --prefix server exec -- tsx scripts/backfillScreenerSnapshots.ts
 *
 * 幂等:upsertScreenerSnapshot 用 ON CONFLICT(asof) DO UPDATE,重复运行只覆盖。
 */
import { readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { isDbReady, initDatabase, upsertScreenerSnapshot } from '../db/pgDatabase'

const SCREENER_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../docs/screener')
const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/

async function main() {
  // 触发连接(同时确保表存在);失败则退出
  await initDatabase()
  if (!isDbReady()) {
    console.error('[backfill] PostgreSQL 未连接,放弃回填')
    process.exit(1)
  }

  let files: string[]
  try {
    files = readdirSync(SCREENER_DIR)
  } catch {
    console.error('[backfill] 找不到目录', SCREENER_DIR)
    process.exit(1)
  }

  const dates = files
    .map((f) => f.match(DATE_RE)?.[1])
    .filter((d): d is string => !!d)
    .sort()

  let ok = 0
  let skip = 0
  for (const date of dates) {
    try {
      const raw = JSON.parse(readFileSync(join(SCREENER_DIR, `${date}.json`), 'utf8'))
      if (!raw || typeof raw.asof !== 'string') {
        skip++
        console.warn(`[backfill] 跳过(形状不符): ${date}`)
        continue
      }
      await upsertScreenerSnapshot({
        asof: raw.asof,
        resultJson: JSON.stringify(raw),
        regimePhase: raw.regime?.phase,
        universe: raw.universe,
        scanned: raw.scanned,
        closed: raw.closed,
      })
      ok++
      console.log(`[backfill] 入库 ${date} (universe=${raw.universe ?? '?'} scanned=${raw.scanned ?? '?'})`)
    } catch (err) {
      skip++
      console.warn(`[backfill] 跳过(损坏/读取失败): ${date}`, err)
    }
  }
  console.log(`[backfill] 完成: 入库 ${ok} 天, 跳过 ${skip} 天`)
  process.exit(0)
}

main()
