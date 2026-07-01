// 新高战法选股器路由。GET /api/screener → 两组候选 + 市场 regime。
import { Router } from 'express'
import { fetchScreener } from '../services/screener'
import { fetchMarketStructure } from '../services/marketStructure'

const router = Router()

router.get('/api/screener', async (_req, res) => {
  try {
    const data = await fetchScreener()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// 每日市场结构快照(板块集中度/抱团 2×2 象限 + 涨跌停宽度)。GET /api/screener/market-structure。
router.get('/api/screener/market-structure', async (_req, res) => {
  try {
    const data = await fetchMarketStructure()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

export default router
