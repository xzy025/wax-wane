import type { ParsedTrade } from '../types'
import { reconstructPositions } from './position'

/**
 * A current holding (一只持仓股). Auto holdings are reconstructed from the
 * imported trade ledger; manual holdings let the user patch in off-app /
 * not-yet-imported / brand-new positions. See [[holdings-review-board]].
 */
export interface Holding {
  code: string
  name: string
  quantity: number
  avgCost: number
  costBasis: number
  source: 'auto' | 'manual'
}

/**
 * A user-maintained override layer persisted to localStorage. A `hidden` entry
 * removes an auto-derived holding from the board (e.g. sold off-app); a normal
 * entry overrides quantity/cost for its code, or adds a brand-new position.
 */
export interface ManualHolding {
  code: string
  name: string
  quantity: number
  avgCost: number
  hidden?: boolean
}

/** Latest known display name per code, from the trade ledger. */
function buildNameMap(trades: readonly ParsedTrade[]): Map<string, string> {
  const names = new Map<string, string>()
  const sorted = [...trades].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
  for (const t of sorted) {
    if (t.stockName) names.set(t.stockCode, t.stockName)
  }
  return names
}

/**
 * Reconstruct current holdings from the trade ledger: any code whose net
 * position is still positive after replaying all trades. Reuses the
 * moving-weighted-average cost engine in src/engine/position.ts.
 */
export function deriveAutoHoldings(trades: readonly ParsedTrade[]): Holding[] {
  const positions = reconstructPositions(trades)
  const names = buildNameMap(trades)
  const holdings: Holding[] = []
  for (const [code, pos] of positions) {
    if (pos.quantity > 1e-6) {
      holdings.push({
        code,
        name: names.get(code) ?? code,
        quantity: pos.quantity,
        avgCost: pos.avgCost,
        costBasis: pos.costBasis,
        source: 'auto',
      })
    }
  }
  return holdings.sort((a, b) => a.code.localeCompare(b.code))
}

/**
 * Merge auto-derived holdings with the manual override layer. Keyed by code:
 * a manual `hidden` entry removes the code; any other manual entry overrides
 * (or adds) that code with `source: 'manual'`.
 */
export function mergeHoldings(auto: readonly Holding[], manual: readonly ManualHolding[]): Holding[] {
  const byCode = new Map<string, Holding>()
  for (const h of auto) byCode.set(h.code, h)

  for (const m of manual) {
    if (m.hidden) {
      byCode.delete(m.code)
      continue
    }
    byCode.set(m.code, {
      code: m.code,
      name: m.name || byCode.get(m.code)?.name || m.code,
      quantity: m.quantity,
      avgCost: m.avgCost,
      costBasis: m.avgCost * m.quantity,
      source: 'manual',
    })
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
}
