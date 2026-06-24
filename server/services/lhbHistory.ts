// 龙虎榜历史因子层 —— 把「龙虎榜净买入(尤其机构专用席位、多日连续买入)」做成可注入选股评分、
// 可历史回测的因子。索引 = 交易日 → 个股 → 当日龙虎榜信号;因子 = 在信号日前 K 个交易日窗口内的聚合。
//
// 取数:复用 moneyflow 的 fetchBillboardRows(全口径净买) + fetchInstitutionalNetByDate(机构专用净买)。
// 关联 [[screener-feature]] [[board-sectors-feature]]。纯聚合(lhbFactorFor)无网络,可单测。
import { fetchBillboardRows, fetchInstitutionalNetByDate } from './moneyflow'

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** 某交易日某股的龙虎榜信号(已按个股聚合)。金额单位:元。 */
export interface LhbDay {
  net: number // 全口径龙虎榜净买入(买-卖)
  instNet: number // 机构专用席位净买入(无机构=0)
  instBuy: boolean // 当日机构净买入 > 0
}

/** date(YYYY-MM-DD) → code → LhbDay。 */
export type LhbIndex = Map<string, Map<string, LhbDay>>

/** 信号日前 K 日窗口内某股的龙虎榜因子聚合。 */
export interface LhbFactor {
  onDays: number // 窗口内上榜天数
  netSum: number // 窗口内全口径净买入和
  instDays: number // 窗口内机构净买入天数
  instNetSum: number // 窗口内机构净买入和
  score01: number // 0..1 加分(机构多日 > 机构单日 > 全口径净买 > 无)
}

export const EMPTY_LHB_FACTOR: LhbFactor = { onDays: 0, netSum: 0, instDays: 0, instNetSum: 0, score01: 0 }

/** 受限并发 map(保序)。 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * 扫描一组交易日,构建 龙虎榜索引(date → code → LhbDay)。
 * institutional=true(默认)时每日额外取机构专用席位净买;false 则仅全口径净买(更快,机构字段=0)。
 */
export async function buildLhbIndex(
  dates: string[],
  opts: { institutional?: boolean; concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<LhbIndex> {
  const institutional = opts.institutional !== false
  const concurrency = opts.concurrency ?? 4
  const index: LhbIndex = new Map()
  let done = 0
  await mapLimit(dates, concurrency, async (date) => {
    try {
      const [rows, inst] = await Promise.all([
        fetchBillboardRows(date),
        institutional ? fetchInstitutionalNetByDate(date) : Promise.resolve(new Map()),
      ])
      const m = new Map<string, LhbDay>()
      for (const r of rows) {
        const i = inst.get(r.code)
        const instNet = i ? i.instNet : 0
        m.set(r.code, { net: r.netAmt, instNet, instBuy: instNet > 0 })
      }
      index.set(date, m)
    } catch {
      index.set(date, new Map()) // 取数失败给空,不阻塞其余日期
    } finally {
      done++
      opts.onProgress?.(done, dates.length)
    }
  })
  return index
}

/**
 * 在给定窗口交易日内聚合某股的龙虎榜因子。windowDates 应为信号日(含)及其前若干交易日。
 * score01(用于加分,单调):机构多日净买 > 机构单日净买 > 仅全口径净买>0 > 无榜。
 */
export function lhbFactorFor(code: string, windowDates: string[], index: LhbIndex): LhbFactor {
  let onDays = 0
  let netSum = 0
  let instDays = 0
  let instNetSum = 0
  for (const d of windowDates) {
    const day = index.get(d)?.get(code)
    if (!day) continue
    onDays++
    netSum += day.net
    if (day.instBuy) {
      instDays++
      instNetSum += day.instNet
    }
  }
  // 量级归一:1e7(千万)→0,~3e8(3亿)→1。
  const mag = (v: number) => clamp01(Math.log10(Math.max(v, 1) / 1e7) / 1.5)
  let score01 = 0
  if (instDays >= 2)
    score01 = 0.8 + 0.2 * mag(instNetSum) // 机构多日埋伏:最强 0.8~1.0
  else if (instDays === 1)
    score01 = 0.5 + 0.3 * mag(instNetSum) // 机构单日:0.5~0.8
  else if (onDays > 0 && netSum > 0)
    score01 = 0.2 + 0.2 * mag(netSum) // 仅全口径净买:0.2~0.4
  return { onDays, netSum: r2(netSum), instDays, instNetSum: r2(instNetSum), score01: r2(clamp01(score01)) }
}

// ── 磁盘缓存(序列化用;实际 fs 由回测脚本负责,服务层只做 Map↔JSON) ───────────
type LhbIndexJSON = Record<string, Record<string, LhbDay>>

export function serializeLhbIndex(index: LhbIndex): LhbIndexJSON {
  const obj: LhbIndexJSON = {}
  for (const [date, m] of index) {
    const inner: Record<string, LhbDay> = {}
    for (const [code, day] of m) inner[code] = day
    obj[date] = inner
  }
  return obj
}

export function deserializeLhbIndex(obj: LhbIndexJSON): LhbIndex {
  const index: LhbIndex = new Map()
  for (const date of Object.keys(obj)) {
    const inner = new Map<string, LhbDay>()
    for (const code of Object.keys(obj[date])) inner.set(code, obj[date][code])
    index.set(date, inner)
  }
  return index
}
