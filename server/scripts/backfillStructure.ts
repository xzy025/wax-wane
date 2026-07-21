/**
 * structure-<date>.json 历史重构:东财K线断供期间缺档的市场结构日报,事后从
 * 日期可寻址源复算落盘(实时源已无法回到当日,这是断供缺档的唯一修复路径)。
 *
 * 板块日线双路径(探针自动选择):
 *  - em-kline(精确):getBoardBars 板块日K活着时,全宇宙按目标日成交额(f57)排
 *    top BOARD_CAP,截断到目标日算长60/短5窗(boardStrengthAsOf,与实跑/回测同数学)。
 *  - recon-eqw(近似):板块日K断供时(push2his 族 IP 级封锁),按当前成交额取前
 *    BOARD_CAP 板,每板前 RECON_STOCKS 成分的个股日K(腾讯兜底抗断供)等权平均日涨跌,
 *    复利成合成收盘序列再算窗——tempo 服务同款重构思路(C2 探针 4/5 日与游资表一致),
 *    60日长窗有等权vs市值加权漂移,象限零轴附近的板块可能错分,档内 boardSource 标明。
 *
 * 情绪块:优先当日存档真值(review-<date>.json ashare 涨跌停/涨跌家数 + 快照
 * regime 破板率,均为当日实时捕获);无存档日走 push2ex 历史涨跌停池(date= 官方
 * 历史参数,炸板率=zb/(zb+zt));涨跌家数无免费历史源时置 0(sentimentNote 说明)。
 *
 * 重构档带 reconstructed:true + boardSource + sentimentSource,generatedAt=真实
 * 时间,与当日实跑档可区分;已存在的档默认跳过(--overwrite 才覆盖,如事后拿到
 * 精确板块日K想替换 recon-eqw 近似档)。
 *
 * 运行(cwd=server):
 *   npx tsx scripts/backfillStructure.ts 2026-07-13 2026-07-14 ... [--overwrite]
 */
import { config } from 'dotenv'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { MarketStructureSummary, MarketStructureBoard } from '../services/marketStructure'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const SCREENER_DIR = join(__dirname, '..', '..', 'docs', 'screener')
const LONG_WIN = 60
const SHORT_WIN = 5
const TOP_N = 5
const RECON_STOCKS = 15 // 每板等权重构用成交额前 N 成分(对齐 TEMPO_SVC.RECON_STOCKS)
const RECON_COVERAGE = 8 // 当日 ≥N 只成分有数才算有效日(对齐 TEMPO_SVC.RECON_COVERAGE)
const RECON_KLINE = 100 // 个股日K根数:99个chg日,最早目标日也够 60 日长窗

const args = process.argv.slice(2)
const overwrite = args.includes('--overwrite')
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)).sort()
if (dates.length === 0) {
  console.error('用法: tsx scripts/backfillStructure.ts YYYY-MM-DD [...] [--overwrite]')
  process.exit(1)
}

interface SentimentBlock {
  limitUp: number
  limitDown: number
  advanceCount: number
  declineCount: number
  breakRate: number
  source: string
  note: string
}

/** 统一的板块序列:dates/closes 升序对齐;chgAt=逐日涨跌;amountAt=bars 模式的逐日成交额。 */
interface BoardSeries {
  code: string
  name: string
  curAmount: number
  dates: string[]
  closes: number[]
  chgAt: Map<string, number>
  amountAt: Map<string, number> | null // null=recon 模式(排名退当前成交额)
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(join(SCREENER_DIR, file), 'utf8')) as T
  } catch {
    return null
  }
}

/** 当日存档真值:review 档 ashare 块(涨跌停/涨跌家数) + 快照 regime(破板率)。 */
function sentimentFromArchives(date: string): SentimentBlock | null {
  const review = readJson<{ ashare?: { limitUp?: number; limitDown?: number; advance?: number; decline?: number } }>(
    `review-${date}.json`,
  )
  const a = review?.ashare
  if (!a || typeof a.limitUp !== 'number') return null
  const snap = readJson<{ regime?: { breakRate?: number } }>(`${date}.json`)
  const breakRate = typeof snap?.regime?.breakRate === 'number' ? snap.regime.breakRate : 0
  return {
    limitUp: a.limitUp,
    limitDown: a.limitDown ?? 0,
    advanceCount: a.advance ?? 0,
    declineCount: a.decline ?? 0,
    breakRate,
    source: 'archives(review.ashare+snapshot.regime.breakRate)',
    note: '当日存档真值回填',
  }
}

async function main() {
  // 动态 import:确保 dotenv 先于任何读 env 的模块初始化(对齐 backfillDay 姿势)
  const { fetchBoardUniverse, fetchBoardConstituents, getBoardBars, mapLimit, ROTATION } = await import(
    '../services/rotation'
  )
  const { boardStrengthAsOf, dailyChanges } = await import('../services/rotationRules')
  const { fetchStockKline } = await import('../services/ashare')
  const { emFetch } = await import('../lib/emFetch')
  const { EM_HEADERS } = await import('../lib/emHeaders')

  /** push2ex 历史池家数(date=YYYYMMDD 官方历史参数);tc 缺失退 pool 长度。 */
  async function poolCount(endpoint: string, date: string): Promise<number> {
    const url =
      `https://push2ex.eastmoney.com/${endpoint}?ut=7eea3edcaed734bea9cb3fce871cbecd&dpt=wz.ztzt` +
      `&date=${date.replace(/-/g, '')}&_=${Date.now()}`
    const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 8000 })
    if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}`)
    const json = (await res.json()) as { data?: { tc?: number; pool?: unknown[] } }
    const n = json.data?.tc ?? json.data?.pool?.length
    if (typeof n !== 'number') throw new Error(`${endpoint} 空 data(源暂不可用)`)
    return n
  }

  async function sentimentFromPools(date: string): Promise<SentimentBlock> {
    const [zt, dt, zb] = await Promise.all([
      poolCount('getTopicZTPool', date),
      poolCount('getTopicDTPool', date),
      poolCount('getTopicZBPool', date).catch(() => -1),
    ])
    const breakRate = zb >= 0 && zb + zt > 0 ? Math.round((zb / (zb + zt)) * 10000) / 100 : 0
    return {
      limitUp: zt,
      limitDown: dt,
      advanceCount: 0,
      declineCount: 0,
      breakRate,
      source: 'push2ex-pools(date=历史参数)',
      note: '涨跌家数无免费历史源,advance/decline=0 为缺失非事实',
    }
  }

  // ── 个股逐日涨跌缓存(跨板块成分去重;tempo stockChgCache 同思路,脚本内存版)──
  const stockChgMemo = new Map<string, Map<string, number>>()
  async function getStockChg(code: string): Promise<Map<string, number>> {
    const hit = stockChgMemo.get(code)
    if (hit) return hit
    const byDate = new Map<string, number>()
    try {
      const { klines } = await fetchStockKline(code, 101, RECON_KLINE)
      for (const d of dailyChanges(klines)) byDate.set(d.date, d.chg)
    } catch {
      /* 单股失败容忍 */
    }
    stockChgMemo.set(code, byDate)
    return byDate
  }

  /** 成分股等权重构 → 合成收盘序列(复利)。覆盖不足的日子丢弃。 */
  async function reconSeries(meta: { code: string; name: string; amount: number }): Promise<BoardSeries | null> {
    const members = (await fetchBoardConstituents(meta.code)).slice(0, RECON_STOCKS)
    if (members.length < RECON_COVERAGE) return null
    const byDate = new Map<string, number[]>()
    for (const m of members) {
      const chg = await getStockChg(m.code)
      for (const [date, v] of chg) {
        const arr = byDate.get(date) ?? []
        arr.push(v)
        byDate.set(date, arr)
      }
    }
    const days = [...byDate.entries()]
      .filter(([, arr]) => arr.length >= Math.min(RECON_COVERAGE, members.length))
      .sort((a, b) => a[0].localeCompare(b[0]))
    if (days.length < SHORT_WIN + 1) return null
    const chgAt = new Map<string, number>()
    const datesArr: string[] = []
    const closes: number[] = []
    let level = 100
    for (const [date, arr] of days) {
      const chg = arr.reduce((s, x) => s + x, 0) / arr.length
      level *= 1 + chg / 100
      datesArr.push(date)
      closes.push(level)
      chgAt.set(date, chg)
    }
    return { code: meta.code, name: meta.name, curAmount: meta.amount, dates: datesArr, closes, chgAt, amountAt: null }
  }

  console.log(`[backfillStructure] 目标 ${dates.join(', ')}`)
  console.log('[backfillStructure] 取行业板块宇宙...')
  const universe = await fetchBoardUniverse('industry')
  if (universe.length === 0) {
    console.error('[backfillStructure] 板块宇宙取数失败,放弃')
    process.exit(1)
  }
  console.log(`[backfillStructure] 板块 ${universe.length} 个;探测板块日K可用性...`)

  // 探针:3 个板块日K全空 → 断供,整轮走 recon-eqw(省 ~500 次注定失败的调用)
  const probeBoards = universe.slice(0, 3)
  const probed = await Promise.all(probeBoards.map((b) => getBoardBars(`90.${b.code}`).catch(() => [])))
  const emKlineAlive = probed.some((bars) => bars.length > 0)
  console.log(`[backfillStructure] 板块日K ${emKlineAlive ? '活着 → em-kline 精确路径' : '断供 → recon-eqw 等权重构路径'}`)

  let series: BoardSeries[]
  let boardSource: string
  if (emKlineAlive) {
    boardSource = 'em-kline'
    let done = 0
    const all = await mapLimit(universe, 6, async (b) => {
      const bars = await getBoardBars(`90.${b.code}`).catch(() => [])
      done++
      if (done % 100 === 0) console.log(`[backfillStructure]   日线进度 ${done}/${universe.length}`)
      if (bars.length === 0) return null
      const closes = bars.map((x) => x.close)
      const chgAt = new Map<string, number>()
      const amountAt = new Map<string, number>()
      for (let i = 0; i < bars.length; i++) {
        if (i > 0 && closes[i - 1] > 0) chgAt.set(bars[i].date, (closes[i] / closes[i - 1] - 1) * 100)
        amountAt.set(bars[i].date, bars[i].amount ?? 0)
      }
      return {
        code: b.code, name: b.name, curAmount: b.amount,
        dates: bars.map((x) => x.date), closes, chgAt, amountAt,
      } as BoardSeries
    })
    series = all.filter((x): x is BoardSeries => x != null)
  } else {
    boardSource = 'recon-eqw'
    // 断供时全量重构太贵:按当前成交额取前 BOARD_CAP(排名近似,档内已标注)
    const capped = [...universe].sort((a, b) => b.amount - a.amount).slice(0, ROTATION.BOARD_CAP)
    let done = 0
    const all = await mapLimit(capped, 6, async (b) => {
      const s = await reconSeries(b).catch(() => null)
      done++
      if (done % 20 === 0) console.log(`[backfillStructure]   重构进度 ${done}/${capped.length}(个股K缓存 ${stockChgMemo.size})`)
      return s
    })
    series = all.filter((x): x is BoardSeries => x != null)
  }
  console.log(`[backfillStructure] 有效板块序列 ${series.length}(${boardSource})`)
  if (series.length === 0) {
    console.error('[backfillStructure] 无任何有效板块序列,放弃')
    process.exit(1)
  }

  const r2 = (n: number) => Math.round(n * 100) / 100
  let failed = false

  for (const date of dates) {
    const file = `structure-${date}.json`
    const exists = existsSync(join(SCREENER_DIR, file))
    if (exists && !overwrite) {
      console.log(`\n[${date}] 已有 ${file},跳过(--overwrite 才覆盖)`)
      continue
    }

    // 目标日在场的板块,按 成交额(bars=当日f57 / recon=当前clist) 排 top BOARD_CAP
    const atDate = series
      .map((s) => {
        const idx = s.dates.indexOf(date)
        if (idx < 0) return null
        return { s, idx, rankAmount: s.amountAt ? (s.amountAt.get(date) ?? 0) : s.curAmount }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
    if (atDate.length === 0) {
      console.error(`\n[${date}] 所有板块序列均无该日(非交易日或数据缺失),跳过`)
      failed = true
      continue
    }
    const capped = [...atDate].sort((a, b) => b.rankAmount - a.rankAmount).slice(0, ROTATION.BOARD_CAP)

    const quads: Record<string, number> = { hs: 0, ls: 0, hw: 0, lw: 0 }
    const rowsFull: (MarketStructureBoard & { quadrant: string })[] = []
    for (const { s, idx } of capped) {
      const st = boardStrengthAsOf(s.closes, idx, LONG_WIN, SHORT_WIN)
      if (!st) continue
      const todayChg = r2(s.chgAt.get(date) ?? 0)
      quads[st.quadrant]++
      rowsFull.push({ code: s.code, name: s.name, longChg: st.longChg, shortChg: st.shortChg, todayChg, quadrant: st.quadrant })
    }
    rowsFull.sort((a, b) => b.shortChg - a.shortChg)
    const topBy = (q: string): MarketStructureBoard[] =>
      rowsFull.filter((b) => b.quadrant === q).slice(0, TOP_N).map(({ quadrant: _q, ...rest }) => rest)
    const shortUp = rowsFull.filter((b) => b.shortChg >= 0).length

    let sentiment = sentimentFromArchives(date)
    if (!sentiment) {
      try {
        sentiment = await sentimentFromPools(date)
      } catch (e) {
        sentiment = {
          limitUp: 0, limitDown: 0, advanceCount: 0, declineCount: 0, breakRate: 0,
          source: 'none',
          note: `情绪历史源均不可用(${e instanceof Error ? e.message : e}),全 0 为缺失非事实`,
        }
      }
    }

    const result: MarketStructureSummary & {
      reconstructed: true
      boardSource: string
      sentimentSource: string
      sentimentNote: string
    } = {
      asof: date,
      generatedAt: new Date().toISOString(),
      limitUp: sentiment.limitUp,
      limitDown: sentiment.limitDown,
      advanceCount: sentiment.advanceCount,
      declineCount: sentiment.declineCount,
      breakRate: sentiment.breakRate,
      boardTotal: rowsFull.length,
      hsCount: quads.hs,
      lsCount: quads.ls,
      hwCount: quads.hw,
      lwCount: quads.lw,
      shortUpPct: rowsFull.length ? r2((shortUp / rowsFull.length) * 100) : 0,
      topHs: topBy('hs'),
      topLs: topBy('ls'),
      reconstructed: true,
      boardSource,
      sentimentSource: sentiment.source,
      sentimentNote: sentiment.note,
    }

    console.log(
      `\n[${date}] 重构完成: 板块${result.boardTotal}(${boardSource}) 象限 hs${result.hsCount}/ls${result.lsCount}/hw${result.hwCount}/lw${result.lwCount}` +
        ` 宽度${result.shortUpPct}% | 涨停${result.limitUp}/跌停${result.limitDown} 破板率${result.breakRate}% (${sentiment.source})`,
    )
    writeFileSync(join(SCREENER_DIR, file), JSON.stringify(result, null, 2))
    console.log(`[${date}] 已落盘 ${file}${exists ? '(覆盖)' : ''}`)
  }
  process.exit(failed ? 1 : 0)
}

main()
