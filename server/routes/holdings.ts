// 持仓深度技术分析路由。持仓在前端合成(manual 在 localStorage),服务端不知情——
// 客户端上报代码列表;avgCost 属个人数据,走 POST body 不进 URL/访问日志。
import { Router } from 'express'
import {
  fetchHoldingsTA,
  listHoldingsTaArchiveDates,
  loadHoldingsTaArchiveByDate,
  type HoldingsTAPosition,
} from '../services/holdingsTA'
import { HOLDINGS } from '../config/screener'
import { normalizeSecurityCode } from '../services/securityCode'

const router = Router()

export function parseHoldingPosition(value: unknown): HoldingsTAPosition | null {
  if (typeof value !== 'object' || value === null) return null
  const { code, market, avgCost } = value as { code?: unknown; market?: unknown; avgCost?: unknown }
  const normalized = normalizeSecurityCode(code, market)
  if (!normalized) return null
  return {
    code: normalized.canonicalCode,
    market: normalized.market,
    symbol: normalized.symbol,
    avgCost: typeof avgCost === 'number' && avgCost > 0 ? avgCost : undefined,
  }
}

// POST /api/holdings/ta {positions:[{code,avgCost?}]} → 深度TA整包(空持仓直接空包,不打上游)。
router.post('/api/holdings/ta', async (req, res) => {
  const raw = (req.body as { positions?: unknown } | undefined)?.positions
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: 'positions 数组必填' })
    return
  }
  const seen = new Set<string>()
  const positions: HoldingsTAPosition[] = []
  for (const p of raw) {
    const position = parseHoldingPosition(p)
    if (!position) continue
    const key = `${position.market}:${position.symbol}`
    if (seen.has(key)) continue
    seen.add(key)
    positions.push(position)
  }
  if (positions.length > HOLDINGS.MAX_CODES) {
    res.status(400).json({ error: `持仓代码过多(上限 ${HOLDINGS.MAX_CODES})` })
    return
  }
  try {
    res.json(await fetchHoldingsTA(positions))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// GET /api/holdings/ta/archive → {dates:[]} 历史存档日期(倒序)。
router.get('/api/holdings/ta/archive', (_req, res) => {
  res.json({ dates: listHoldingsTaArchiveDates() })
})

// GET /api/holdings/ta/archive/:date → 指定日期存档(严格日期正则防路径穿越)。
router.get('/api/holdings/ta/archive/:date', (req, res) => {
  const date = req.params.date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'date 需为 YYYY-MM-DD' })
    return
  }
  const data = loadHoldingsTaArchiveByDate(date)
  if (!data) {
    res.status(404).json({ error: `无 ${date} 存档` })
    return
  }
  res.json(data)
})

export default router
