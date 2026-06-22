// 新高战法选股器路由。GET /api/screener → 两组候选 + 市场 regime。
import { Router } from 'express'
import { fetchScreener } from '../services/screener'

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

export default router
