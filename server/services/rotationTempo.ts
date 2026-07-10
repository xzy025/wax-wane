// 板块轮动节奏表 —— 板块×最近5交易日 的 启动/调整 状态网格(游资复盘表口径)。
// 状态机纯函数在 rotationRules.ts(computeTempoSeries);本层负责双源装配/富注记/滚动归档/降级。
//
// 分类源:① 东财 行业+概念(板块日K=getBoardBars;**push2his 慢性封锁时自动降级成分股等权重构**,
// C2 探针实测重构路径 4/5 日与游资表一致) ② 开盘啦精选题材(kplThemes,探针 PASS 后接入,
// 题材无历史K线,恒走成分重构)。个股K线有腾讯兜底 → 重构路径天然抗 push2his 断供。
// 定位:监控/复盘功能,非战法不进回测(trendwatch 先例)。
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createCache, sessionTtl } from '../lib/cache'
import { todayShanghai } from '../lib/time'
import { fetchStockKline } from './ashare'
import {
  ROTATION,
  fetchBoardUniverse,
  fetchBoardConstituents,
  getBoardBars,
  mapLimit,
  type BoardMeta,
} from './rotation'
import {
  dailyChanges,
  volRatios,
  computeTempoSeries,
  tempoHeat,
  hasStrongLaunch,
  TEMPO,
  type TempoCell,
  type TempoDayInput,
} from './rotationRules'
import { fetchBoardInflow } from './fundFlow'
import { fetchKplThemes, isKplThemesEnabled } from './kplThemes'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENER_DIR = join(__dirname, '..', '..', 'docs', 'screener')
const TEMPO_RE = /^tempo-(\d{4}-\d{2}-\d{2})\.json$/
const CLOSED_TTL = 30 * 60_000 // 盘后 TTL 同 rotation

export const TEMPO_SVC = {
  BENCHMARK_SECID: '1.000001',
  BENCHMARK_NAME: '上证指数',
  CAT_CAP: 60, // 行业/概念各取成交额前 N(合计≈rotation BOARD_CAP 量级)
  RECON_CAP: 40, // 板块日K挂时,成分重构的板块数上限(按成交额;全量重构太贵)
  RECON_STOCKS: 15, // 每板块/题材重构用成交额前 N 成分
  RECON_KLINE: 70, // 重构用个股K线根数(69个chg日,dayN 计数足够)
  RECON_COVERAGE: 8, // 重构有效日:当日 ≥N 只成分有数,否则该日格缺席
  NOTES_CAP: 30, // 富注记只算 heat 前 N 行(+pins 增补),控 clist/ulist 调用量
  SOLO_STRONG_PCT: 5, // 个别强:调整日成分有涨 ≥ 此%
  SPLIT_LO: 0.45, // 板块分化:成分上涨占比落在 [LO,HI]
  SPLIT_HI: 0.55,
  ARCHIVE_KEEP: 5, // 归档只留最近 N 个交易日(用户口径:永远只保留最新5天)
} as const

export type TempoSource = 'em-industry' | 'em-concept' | 'kpl-theme'
export type TempoNoteKind = 'soloStrong' | 'split' | 'inflow'
export interface TempoNote {
  kind: TempoNoteKind
  date: string
  detail?: string // soloStrong=领涨股名+涨幅;inflow=净额(亿)
}

export interface TempoRow {
  code: string // 'BKxxxx' 或 'kpl:<id>'(命名空间防碰撞;钉选/归档同用)
  name: string
  source: TempoSource
  recon: boolean // true=成分股等权重构(无量比,tier 仅按涨幅)
  cells: TempoCell[] // ≤5 格升序;板块某日缺数据该格缺席
  heat: number
  active: boolean // 近5日出现过强启动(默认行集合过滤条件)
  notes: TempoNote[] // 当日富注记
}

export interface RotationTempoResult {
  asof: string
  dates: string[] // 5 列表头 = 基准指数末 5 个交易日(权威列集)
  benchmark: { name: string; cells: { date: string; chg: number }[] }
  rows: TempoRow[] // 全量;前端过滤(active/pins)排序展示
  sources: { em: 'live' | 'recon' | 'down'; kpl: 'live' | 'off' | 'down' }
  fromArchive?: boolean // 本次响应来自磁盘归档兜底(仅内存标记,不落盘)
}

const r2 = (n: number) => Math.round(n * 100) / 100

// ── 个股逐日涨跌缓存(EM 重构 + kpl 题材共享;跨板块成分高度重叠,dedup 后取数大幅缩水)──
const stockChgCache = new Map<string, { byDate: Map<string, number>; expires: number }>()
const STOCK_CHG_TTL = 24 * 3600_000

async function getStockChg(code: string): Promise<Map<string, number>> {
  const hit = stockChgCache.get(code)
  if (hit && hit.expires > Date.now()) return hit.byDate
  const byDate = new Map<string, number>()
  try {
    const { klines } = await fetchStockKline(code, 101, TEMPO_SVC.RECON_KLINE)
    for (const d of dailyChanges(klines)) byDate.set(d.date, d.chg)
  } catch {
    /* 单股失败容忍,返回空(不缓存,同 barsCache 纪律) */
  }
  if (byDate.size > 0) stockChgCache.set(code, { byDate, expires: Date.now() + STOCK_CHG_TTL })
  return byDate
}

/** 成分股等权重构逐日涨跌:每日取覆盖到的成分 chg 均值,覆盖 < RECON_COVERAGE 只的日子丢弃。 */
async function reconstructChg(codes: string[]): Promise<Map<string, number>> {
  const byDate = new Map<string, number[]>()
  await mapLimit(codes, 8, async (code) => {
    const chg = await getStockChg(code)
    for (const [date, v] of chg) {
      const arr = byDate.get(date) ?? []
      arr.push(v)
      byDate.set(date, arr)
    }
  })
  const out = new Map<string, number>()
  for (const [date, arr] of byDate) {
    if (arr.length >= Math.min(TEMPO_SVC.RECON_COVERAGE, codes.length)) {
      out.set(date, arr.reduce((s, x) => s + x, 0) / arr.length)
    }
  }
  return out
}

function buildRow(
  code: string,
  name: string,
  source: TempoSource,
  recon: boolean,
  days: TempoDayInput[],
  dates: string[],
): TempoRow | null {
  if (days.length < TEMPO.WINDOW) return null
  const cells = computeTempoSeries(days)
  const shown = cells.filter((c) => dates.includes(c.date))
  if (shown.length === 0) return null
  return { code, name, source, recon, cells: shown, heat: tempoHeat(cells), active: hasStrongLaunch(cells), notes: [] }
}

// ── 富注记(当日;每板块独立 5min 缓存,失败→[] 绝不拖垮主结果)──────────────
const notesCache = new Map<string, { notes: TempoNote[]; expires: number }>()
const NOTES_TTL = 5 * 60_000

/** EM 板块当日富注记:个别强/分化(成分快照)+资金回流(f62,由调用方传入)。 */
async function boardNotes(row: TempoRow, asof: string, inflow: number | undefined): Promise<TempoNote[]> {
  const hit = notesCache.get(row.code)
  if (hit && hit.expires > Date.now()) return hit.notes
  const notes: TempoNote[] = []
  try {
    const today = row.cells[row.cells.length - 1]
    if (today?.date === asof) {
      const members = await fetchBoardConstituents(row.code)
      if (members.length > 0) {
        if (today.state === 'adjust') {
          const solo = members.filter((m) => m.changePct >= TEMPO_SVC.SOLO_STRONG_PCT)
          if (solo.length > 0) {
            const top = solo.sort((a, b) => b.changePct - a.changePct)[0]
            notes.push({ kind: 'soloStrong', date: asof, detail: `${top.name} +${r2(top.changePct)}%` })
          }
        }
        const upShare = members.filter((m) => m.changePct > 0).length / members.length
        if (upShare >= TEMPO_SVC.SPLIT_LO && upShare <= TEMPO_SVC.SPLIT_HI) {
          notes.push({ kind: 'split', date: asof })
        }
      }
      if (inflow !== undefined && inflow > 0) {
        notes.push({ kind: 'inflow', date: asof, detail: `${r2(inflow / 1e8)}亿` })
      }
    }
  } catch {
    /* 注记失败静默,格子照常 */
  }
  notesCache.set(row.code, { notes, expires: Date.now() + NOTES_TTL })
  return notes
}

/** 对 heat 前 NOTES_CAP 行 + 指定增补行(pins)做当日富注记(仅 EM 行;kpl 行留待实装时支持)。 */
async function enrichNotes(rows: TempoRow[], asof: string, extraCodes: string[] = []): Promise<void> {
  const byHeat = [...rows].filter((x) => x.source !== 'kpl-theme').sort((a, b) => b.heat - a.heat)
  const selected = new Map<string, TempoRow>()
  for (const x of byHeat.slice(0, TEMPO_SVC.NOTES_CAP)) selected.set(x.code, x)
  for (const c of extraCodes) {
    const x = rows.find((rw) => rw.code === c && rw.source !== 'kpl-theme')
    if (x) selected.set(x.code, x)
  }
  if (selected.size === 0) return
  const inflowMap = await fetchBoardInflow([...selected.keys()]).catch(() => new Map<string, number>())
  await mapLimit([...selected.values()], 6, async (row) => {
    row.notes = await boardNotes(row, asof, inflowMap.get(row.code))
  })
}

// ── 主装配 ────────────────────────────────────────────────────────────
async function computeTempoFresh(): Promise<RotationTempoResult> {
  // 基准指数挂(有 Sina 兜底,极少)→ throw → serve-stale/磁盘归档。
  const idxBars = await getBoardBars(TEMPO_SVC.BENCHMARK_SECID)
  const idxChgs = dailyChanges(idxBars)
  if (idxChgs.length < TEMPO.WINDOW) throw new Error('[Tempo] 基准指数日线不足')
  const idxByDate = new Map(idxChgs.map((d) => [d.date, d.chg]))
  const dates = idxChgs.slice(-TEMPO.WINDOW).map((d) => d.date)
  const benchmark = {
    name: TEMPO_SVC.BENCHMARK_NAME,
    cells: idxChgs.slice(-TEMPO.WINDOW).map((d) => ({ date: d.date, chg: r2(d.chg) })),
  }

  const [industry, concept] = await Promise.all([
    fetchBoardUniverse('industry').catch(() => [] as BoardMeta[]),
    fetchBoardUniverse('concept').catch(() => [] as BoardMeta[]),
  ])
  const cap = (a: BoardMeta[]) => [...a].sort((x, y) => y.amount - x.amount).slice(0, TEMPO_SVC.CAT_CAP)
  const universe: { meta: BoardMeta; source: TempoSource }[] = [
    ...cap(industry).map((meta) => ({ meta, source: 'em-industry' as const })),
    ...cap(concept).map((meta) => ({ meta, source: 'em-concept' as const })),
  ]

  // 波1:东财板块日K(便宜,EM 活着时全走这条)。
  const rows: TempoRow[] = []
  const failed: { meta: BoardMeta; source: TempoSource }[] = []
  await mapLimit(universe, ROTATION.CONCURRENCY, async (b) => {
    try {
      const bars = await getBoardBars(`90.${b.meta.code}`)
      if (bars.length < TEMPO.WINDOW + 2) throw new Error('bars 不足')
      const chgs = dailyChanges(bars)
      const vrs = volRatios(bars.map((x) => x.volume)) // chgs 从 bars[1] 起 → vrs[i+1] 对齐
      const days = chgs
        .map((d, i) => ({ date: d.date, boardChg: d.chg, indexChg: idxByDate.get(d.date) ?? NaN, volRatio: vrs[i + 1] }))
        .filter((d) => Number.isFinite(d.indexChg))
      const row = buildRow(b.meta.code, b.meta.name, b.source, false, days, dates)
      if (row) rows.push(row)
      else failed.push(b)
    } catch {
      failed.push(b)
    }
  })

  // 波2:成分股等权重构(push2his 慢性封锁的实战路径;只重构成交额前 RECON_CAP,控个股K线量)。
  let reconUsed = 0
  if (failed.length > 0) {
    const targets = [...failed].sort((x, y) => y.meta.amount - x.meta.amount).slice(0, TEMPO_SVC.RECON_CAP)
    await mapLimit(targets, 4, async (b) => {
      try {
        const members = (await fetchBoardConstituents(b.meta.code)).slice(0, TEMPO_SVC.RECON_STOCKS)
        if (members.length < TEMPO_SVC.RECON_COVERAGE) return
        const chgByDate = await reconstructChg(members.map((m) => m.code))
        const days = [...chgByDate.entries()]
          .filter(([date]) => idxByDate.has(date))
          .sort((a, b2) => a[0].localeCompare(b2[0]))
          .map(([date, chg]) => ({ date, boardChg: chg, indexChg: idxByDate.get(date) ?? NaN }))
        const row = buildRow(b.meta.code, b.meta.name, b.source, true, days, dates)
        if (row) {
          rows.push(row)
          reconUsed++
        }
      } catch {
        /* 该板块放弃 */
      }
    })
  }
  const emAlive = rows.filter((x) => x.source !== 'kpl-theme').length
  const em: RotationTempoResult['sources']['em'] = emAlive === 0 ? 'down' : reconUsed > emAlive / 2 ? 'recon' : 'live'

  // 开盘啦题材(门控;探针 PASS 实装前恒为空)。恒走成分重构,量比缺席。
  let kpl: RotationTempoResult['sources']['kpl'] = isKplThemesEnabled() ? 'down' : 'off'
  if (isKplThemesEnabled()) {
    try {
      const themes = await fetchKplThemes()
      for (const t of themes) {
        const codes = t.stocks.slice(0, TEMPO_SVC.RECON_STOCKS).map((s) => s.code)
        if (codes.length < 3) continue
        const chgByDate = await reconstructChg(codes)
        const days = [...chgByDate.entries()]
          .filter(([date]) => idxByDate.has(date))
          .sort((a, b2) => a[0].localeCompare(b2[0]))
          .map(([date, chg]) => ({ date, boardChg: chg, indexChg: idxByDate.get(date) ?? NaN }))
        const row = buildRow(`kpl:${t.id}`, t.name, 'kpl-theme', true, days, dates)
        if (row) rows.push(row)
      }
      if (themes.length > 0) kpl = 'live'
    } catch {
      kpl = 'down'
    }
  }

  // 空壳保护:两源全灭不落盘不进缓存(对齐 marketStructure 语义)。
  if (rows.length === 0) throw new Error('[Tempo] 双源均无有效板块行,保留既有缓存/归档')

  const result: RotationTempoResult = {
    asof: todayShanghai(),
    dates,
    benchmark,
    rows,
    sources: { em, kpl },
  }
  await enrichNotes(rows, result.asof)
  writeTempoDisk(result)
  return result
}

// ── 磁盘归档四件套(仿 structure-<date>.json)+ 滚动裁剪 ─────────────────
function writeTempoDisk(result: RotationTempoResult): void {
  try {
    mkdirSync(SCREENER_DIR, { recursive: true })
    writeFileSync(join(SCREENER_DIR, `tempo-${result.asof}.json`), JSON.stringify(result, null, 2))
    trimTempoArchives()
  } catch (err) {
    console.warn('[Tempo] 归档失败(非致命):', err)
  }
}

/** 只保留最近 ARCHIVE_KEEP 个归档(用户口径:永远只保留最新5天)。 */
function trimTempoArchives(): void {
  try {
    const dated = readdirSync(SCREENER_DIR)
      .map((f) => ({ f, m: TEMPO_RE.exec(f) }))
      .filter((x): x is { f: string; m: RegExpExecArray } => x.m !== null)
      .sort((a, b) => b.m[1].localeCompare(a.m[1]))
    for (const x of dated.slice(TEMPO_SVC.ARCHIVE_KEEP)) unlinkSync(join(SCREENER_DIR, x.f))
  } catch {
    /* 裁剪失败非致命 */
  }
}

export function isTempoResult(v: unknown): v is RotationTempoResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.asof === 'string' && Array.isArray(r.dates) && Array.isArray(r.rows)
}

function loadLatestTempoDisk(): RotationTempoResult | null {
  let files: string[]
  try {
    files = readdirSync(SCREENER_DIR)
  } catch {
    return null
  }
  let latest = ''
  for (const f of files) {
    const m = TEMPO_RE.exec(f)
    if (m && m[1] > latest) latest = m[1]
  }
  if (!latest) return null
  try {
    const raw = JSON.parse(readFileSync(join(SCREENER_DIR, `tempo-${latest}.json`), 'utf8'))
    return isTempoResult(raw) ? { ...raw, fromArchive: true } : null
  } catch {
    return null
  }
}

const tempoCache = createCache<RotationTempoResult>({
  name: 'RotationTempo',
  ttl: sessionTtl(120_000, CLOSED_TTL),
  fetcher: computeTempoFresh,
  fallback: loadLatestTempoDisk,
})

/** 取节奏表;pins 只影响富注记增补(不进主缓存 key):钉选行不在 heat 前30 时按需补算注记。 */
export async function fetchRotationTempo(pins: string[] = []): Promise<RotationTempoResult> {
  const base = await tempoCache.get()
  const missing = pins.filter((p) => {
    const row = base.rows.find((x) => x.code === p)
    return row !== undefined && row.notes.length === 0 && row.source !== 'kpl-theme'
  })
  if (missing.length > 0 && !base.fromArchive) {
    await enrichNotes(base.rows, base.asof, missing) // notesCache 5min,重复调用便宜
  }
  return base
}

export function clearRotationTempoCache(): void {
  tempoCache.clear()
  notesCache.clear()
}
