// 资金共振榜(Top10,纯排行·非战法·非买点·未回测)——与 FUNDRES 第6战法(classifyFundResonance)完全独立。
// 成交额前200 ∩ 主力净流入前200 的"共振"交集,按净流入金额降序取前10,叠加当日/近期龙虎榜数据(best-effort)。
import { createCache, sessionTtl } from '../lib/cache'
import { fetchInflowRankTop, fetchTurnoverRankTop, isFundFlowEnabled, type TurnoverRankEntry } from './fundFlow'
import { fetchDragonTiger, type Seat } from './moneyflow'
import { FUND_RESONANCE_BOARD } from '../config/screener'

export interface FundResonanceBoardRow {
  code: string
  name: string
  price: number
  changePct: number
  netInflow: number
  netInflowPct: number
  turnoverRank: number
  inflowRank: number
  lhb?: { netAmt: number; buyAmt: number; sellAmt: number; buySeats: Seat[]; sellSeats: Seat[]; reason: string }
}

/** 纯函数,可单测:turnover-top-N ∩ inflow-top-N,按 netInflow 降序取前 topK。不修改传入的 Map。 */
export function buildResonanceRows(
  turnover: Map<string, TurnoverRankEntry>,
  inflowRank: Map<string, number>,
  topK = 10,
): Omit<FundResonanceBoardRow, 'lhb'>[] {
  const rows: Omit<FundResonanceBoardRow, 'lhb'>[] = []
  for (const [code, t] of turnover) {
    const inRank = inflowRank.get(code)
    if (inRank == null) continue // 未进净流入前N → 不算"共振"
    rows.push({
      code, name: t.name, price: t.price, changePct: t.changePct,
      netInflow: t.netInflow, netInflowPct: t.netInflowPct,
      turnoverRank: t.rank, inflowRank: inRank,
    })
  }
  return rows.sort((a, b) => b.netInflow - a.netInflow).slice(0, topK)
}

async function fetchFresh(): Promise<FundResonanceBoardRow[]> {
  if (!isFundFlowEnabled()) return [] // 整个"共振"概念依赖净流入数据,门控关闭时直接空
  const [turnover, inflowRank] = await Promise.all([
    fetchTurnoverRankTop(FUND_RESONANCE_BOARD.TOPN),
    fetchInflowRankTop(FUND_RESONANCE_BOARD.TOPN),
  ])
  const base = buildResonanceRows(turnover, inflowRank, FUND_RESONANCE_BOARD.TOP_K)
  if (base.length === 0) return base
  let lhbByCode = new Map<string, { netAmt: number; buyAmt: number; sellAmt: number; buySeats: Seat[]; sellSeats: Seat[]; reason: string }>()
  try {
    const dt = await fetchDragonTiger()
    lhbByCode = new Map(
      [...dt.buy, ...dt.sell].map((s) => [
        s.code,
        { netAmt: s.netAmt, buyAmt: s.buyAmt, sellAmt: s.sellAmt, buySeats: s.buySeats, sellSeats: s.sellSeats, reason: s.reason },
      ]),
    )
  } catch {
    /* 叠加best-effort,查不到不报错 */
  }
  return base.map((r) => {
    const lhb = lhbByCode.get(r.code)
    return lhb ? { ...r, lhb } : r
  })
}

const boardCache = createCache<FundResonanceBoardRow[]>({
  name: 'FundResonanceBoard',
  ttl: sessionTtl(5 * 60_000, 30 * 60_000),
  fetcher: fetchFresh,
})

export function fetchFundResonanceBoard(): Promise<FundResonanceBoardRow[]> {
  return boardCache.get()
}

export function clearFundResonanceBoardCache(): void {
  boardCache.clear()
}
