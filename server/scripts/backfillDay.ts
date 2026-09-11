/**
 * 时钟垫片回填:补指定交易日的五类当日档(选股快照/市场结构/节奏表/每日复盘/实盘战绩)。
 *
 * 适用窗口:上游行情仍等于目标日定盘数据时——目标日收盘后、或次日开盘竞价(09:15)前、
 * 或周末补周五。原理:把 globalThis.Date 整体换成偏移到「目标日 15:30 上海」的子类
 * (todayShanghai 走 Date.now、shanghaiClock 走 new Date,两条取时路径都要骗过),
 * 再动态 import 各服务调用其 fetch 入口:asof=目标日、isArchiveWindow(周一~五 15:30)
 * 放行落盘、shouldGenerateNarrative(≥15:10)放行 LLM 叙事,与目标日盘后实跑等价。
 *
 * 运行:  npm --prefix server exec -- tsx scripts/backfillDay.ts 2026-07-13
 * 不支持跨交易日强制回填；历史输入须走独立隔离验收。
 *
 * PG 快照入库 best-effort:连不上只落磁盘,事后可用 backfillScreenerSnapshots.ts 补灌。
 */
import { config } from 'dotenv'
import { getStrategy } from '../strategy/loader'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const SCREENER_DIR = join(__dirname, '..', '..', 'docs', 'screener')
const LADDER_ROOT = join(__dirname, '..', '..', 'docs', 'ladder')

// ── 参数与窗口校验(垫片安装前,全部用真实时钟) ──────────────────────────
const args = process.argv.slice(2)
const targetArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
const isolatedOutput = args.find((arg) => arg.startsWith('--output='))?.slice(9)
if (isolatedOutput) {
  const manifest = args.find((arg) => arg.startsWith('--input-manifest='))?.slice(17)
  if (!manifest) throw new Error('--output requires --input-manifest; live services cannot run in isolated mode')
  const { stageSettlement } = await import('../services/isolatedSettlement')
  const input = JSON.parse(readFileSync(manifest, 'utf8'))
  if (!targetArg || input.date !== targetArg) throw new Error('Target date must match input manifest')
  console.log(JSON.stringify(stageSettlement(input, isolatedOutput), null, 2))
  process.exit(0)
}
const onlyArg = args.find((a) => a.startsWith('--only='))
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null
if (!targetArg) {
  console.error('用法: tsx scripts/backfillDay.ts YYYY-MM-DD [--only=ladder,screener,structure,tempo,review,forward]')
  console.error('  步骤名: ladder / screener / structure / tempo / review / forward(默认全部,按此顺序)')
  process.exit(1)
}
const target = targetArg
const validStepKeys = new Set(['ladder', 'screener', 'structure', 'tempo', 'review', 'forward'])
if (only && [...only].some((key) => !validStepKeys.has(key))) {
  console.error(`[backfillDay] --only 包含未知步骤，仅支持: ${[...validStepKeys].join(',')}`)
  process.exit(1)
}
// 用上海正午取 weekday 避免时区边界:上海当日正午的 UTC weekday == 上海 weekday
const shDow = new Date(`${target}T12:00:00+08:00`).getUTCDay()
if (shDow === 0 || shDow === 6) {
  console.error(`[backfillDay] ${target} 是周末,非交易日,拒绝回填`)
  process.exit(1)
}

/** 真实上海时钟推算「上游数据当前对应的最近完结交易日」;盘中/竞价时段无完结数据。 */
function lastSettledTradingDay(): string | null {
  // epoch 本身就是 UTC,+8h 后用 getUTC* 读即上海墙钟;勿再加 getTimezoneOffset(在中国
  // 时区机器上会双重补偿,闸门等效"北京23:00后才认今天",下午盘后回填被误拒)。
  const sh = new Date(Date.now() + 8 * 3_600_000)
  const day = sh.getUTCDay()
  const minutes = sh.getUTCHours() * 60 + sh.getUTCMinutes()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const minusDays = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000)
  // 竞价开始(09:15)~收盘(15:00)之间:上游数据是目标日盘中态,不可回填
  if (day >= 1 && day <= 5 && minutes >= 9 * 60 + 15 && minutes < 15 * 60) return null
  // 工作日收盘后 → 今天;工作日竞价前 → 上一个工作日;周末 → 上周五
  let d: Date
  if (day >= 1 && day <= 5 && minutes >= 15 * 60) d = sh
  else if (day >= 1 && day <= 5) d = minusDays(sh, day === 1 ? 3 : 1)
  else d = minusDays(sh, day === 6 ? 1 : 2)
  return iso(d)
}

const settled = lastSettledTradingDay()
if (settled !== target) {
  console.error(
    `[backfillDay] 当前上游数据对应的完结交易日=${settled ?? '(盘中,无)'},与目标 ${target} 不符。` +
      `此脚本没有历史输入能力，--force 不能跳过；请使用经过验证的隔离输入。`,
  )
  process.exit(1)
}

// ── 时钟垫片:目标日 15:30 上海(盘后落盘窗口内、叙事闸门 15:10 后) ────────
const RealDate = globalThis.Date
const SHIM_OFFSET = RealDate.parse(`${target}T15:30:00+08:00`) - RealDate.now()
class ShimDate extends RealDate {
  constructor(...a: unknown[]) {
    if (a.length === 0) super(RealDate.now() + SHIM_OFFSET)
    else super(...(a as [number]))
  }
  static now(): number {
    return RealDate.now() + SHIM_OFFSET
  }
}
globalThis.Date = ShimDate as DateConstructor

// ── 垫片生效后再 import 服务(动态 import,避免任何模块级取时先于垫片) ──────
async function main() {
  console.log(`[backfillDay] 目标 ${target},垫片后 now=${new Date().toISOString()}(应为目标日 07:30Z)`)

  // PG best-effort:连上则选股快照同步入库,连不上仅磁盘
  try {
    const { initDatabase, isDbReady } = await import('../db/pgDatabase')
    await initDatabase()
    console.log(`[backfillDay] PG ${isDbReady() ? '已连接,快照将入库' : '未连接,仅落磁盘'}`)
  } catch (e) {
    console.warn('[backfillDay] PG 初始化失败(非致命,仅落磁盘):', e instanceof Error ? e.message : e)
  }

  // 每步必须先 clear 再 fetch:盘后冷启动 createCache 会直接端「磁盘种子」(最新历史档,
  // 如 07-10)而不跑 fetcher;clear() 解除种子武装,才能强制真算出目标日的档。
  type Step = { name: string; key: string; archivePath: string; run: () => Promise<{ asof: string }> }
  const latestLadderAnalysis = (): { path: string; asof?: string; archiveStage?: string; formalSignalEligible?: boolean } | null => {
    const [year, month, day] = target.split('-')
    const root = join(LADDER_ROOT, year, month, day)
    if (!existsSync(root)) return null
    const candidates = readdirSync(root)
      .map((name) => {
        const match = name.match(/^analysis-limit-ladder-v\d+(?:-r(\d+))?\.json$/i)
        return match ? { name, revision: Number(match[1] ?? 1) } : null
      })
      .filter((item): item is { name: string; revision: number } => !!item)
      .sort((a, b) => b.revision - a.revision)
    for (const candidate of candidates) {
      const path = join(root, candidate.name)
      try {
        const value = JSON.parse(readFileSync(path, 'utf8')) as {
          asof?: string
          archiveStage?: string
          formalSignalEligible?: boolean
        }
        if (value.asof === target) return { path, ...value }
      } catch {
        // Ignore a broken older revision and continue to the latest readable one.
      }
    }
    return null
  }

  const steps: Step[] = [
    {
      name: '连板天梯',
      key: 'ladder',
      archivePath: join(LADDER_ROOT, target.slice(0, 4), target.slice(5, 7), target.slice(8, 10), 'analysis-limit-ladder-v*.json'),
      run: async () => {
        const m = await import('../services/limitLadder')
        m.clearLimitLadderCache()
        const result = await m.fetchLimitLadderAnalysis(target)
        const archive = latestLadderAnalysis()
        if (!archive) {
          const quality = result.quality
          const details = [
            `source=${quality.source}`,
            `sourceDate=${quality.sourceDate || '缺失'}`,
            `sentiment=${quality.sentimentStatus}`,
            `limitFields=${quality.limitFieldsComplete}`,
            `core=${quality.coreDataComplete ?? '缺失'}`,
            `kline=${quality.klineComplete}/${quality.klineTotal}`,
            `settled=${quality.settled ?? '缺失'}`,
            `receivedAt=${quality.receivedAt ?? '缺失'}`,
            `adjustment=${quality.adjustment ?? '缺失'}`,
            ...(quality.warnings ?? []).slice(0, 8),
          ]
          throw new Error(`计算完成但未生成目标日期的连板分析归档；${details.join('；')}`)
        }
        if (archive.archiveStage !== 'core-settled' && archive.archiveStage !== 'enriched') {
          throw new Error(`连板归档阶段无效：${archive.archiveStage ?? '缺失'}`)
        }
        if (archive.archiveStage === 'core-settled' && archive.formalSignalEligible !== false) {
          throw new Error('core-settled 连板归档未明确标记 formalSignalEligible=false')
        }
        return { asof: result.asof }
      },
    },
    {
      name: '选股快照',
      key: 'screener',
      archivePath: join(SCREENER_DIR, `${target}.json`),
      run: async () => {
        const panels = getStrategy()?.panels
        if (!panels?.scanScreener) throw new Error('未安装私有战法层，选股快照无法回填')
        panels.clearScreenerCache?.()
        return panels.scanScreener('close')
      },
    },
    {
      name: '市场结构',
      key: 'structure',
      archivePath: join(SCREENER_DIR, `structure-${target}.json`),
      run: async () => {
        const m = await import('../services/marketStructure')
        m.clearMarketStructureCache()
        return m.fetchMarketStructure()
      },
    },
    {
      name: '节奏表',
      key: 'tempo',
      archivePath: join(SCREENER_DIR, `tempo-${target}.json`),
      run: async () => {
        const m = await import('../services/rotationTempo')
        m.clearRotationTempoCache()
        return m.fetchRotationTempo()
      },
    },
    {
      name: '每日复盘',
      key: 'review',
      archivePath: join(SCREENER_DIR, `review-${target}.json`),
      run: async () => {
        const m = await import('../services/dailyReview')
        m.clearDailyReviewCache()
        return m.fetchDailyReview()
      },
    },
    {
      name: '实盘战绩',
      key: 'forward',
      archivePath: join(SCREENER_DIR, `forward-${target}.json`),
      run: async () => {
        const screenerPath = join(SCREENER_DIR, `${target}.json`)
        const screenerAsof = existsSync(screenerPath)
          ? (JSON.parse(readFileSync(screenerPath, 'utf8')) as { asof?: string }).asof
          : undefined
        if (screenerAsof !== target) {
          throw new Error(`选股正式归档缺失或日期不符(asof=${screenerAsof ?? '缺失'})，禁止生成错标 forward`)
        }
        const panels = getStrategy()?.panels
        if (!panels?.fetchScreenerForward) throw new Error('未安装私有战法层，实盘战绩无法回填')
        panels.clearScreenerForwardCache?.()
        return (await panels.fetchScreenerForward()) as { asof: string }
      },
    },
  ]

  const summary: string[] = []
  for (const s of steps) {
    if (only && !only.has(s.key)) continue
    const t0 = RealDate.now()
    try {
      const r = await s.run()
      const secs = ((RealDate.now() - t0) / 1000).toFixed(1)
      const path = s.archivePath
      const archive = s.key === 'ladder' ? latestLadderAnalysis() : null
      const onDisk = s.key === 'ladder' ? !!archive : existsSync(path)
      const diskAsof = onDisk && !path.includes('*')
        ? (JSON.parse(readFileSync(path, 'utf8')) as { asof?: string }).asof
        : archive?.asof
      const ok = r.asof === target && onDisk && diskAsof === target
      summary.push(
        `${ok ? '✅' : '❌'} ${s.name}: 计算 asof=${r.asof} / 磁盘 ${s.key === 'ladder' ? archive?.path ?? '缺失' : s.archivePath} ${onDisk ? `asof=${diskAsof}` : '缺失'}${archive?.archiveStage ? ` stage=${archive.archiveStage} formal=${archive.formalSignalEligible ?? '缺失'}` : ''} (${secs}s)`,
      )
      if (!ok) process.exitCode = 1
    } catch (e) {
      summary.push(`❌ ${s.name}: 抛错 ${e instanceof Error ? e.message : e}`)
      process.exitCode = 1
    }
  }

  console.log('\n[backfillDay] 结果:')
  for (const line of summary) console.log('  ' + line)
  // 叙事是否生成(复盘档可 narrative=null 落盘,LLM 失败不算步骤失败,单独提示)
  try {
    const rv = JSON.parse(readFileSync(join(SCREENER_DIR, `review-${target}.json`), 'utf8')) as {
      narrative?: { markdown?: string } | string | null
    }
    const nlen = typeof rv.narrative === 'string' ? rv.narrative.length : (rv.narrative?.markdown?.length ?? 0)
    console.log(`  ℹ 复盘叙事: ${rv.narrative ? `已生成(${nlen}字)` : '未生成(可重跑或事后惰性补)'}`)
  } catch {
    /* review 档缺失时上面已标 ❌ */
  }
  process.exit(process.exitCode ?? 0)
}

main()
