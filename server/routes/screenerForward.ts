// 选股实盘战绩(滚动 forward-test)路由。GET /api/screener/forward → 每战法实盘 R/PF/胜率 + picks。
import { Router } from 'express'
import { fetchScreenerForward } from '../services/screenerForward'

const router = Router()

router.get('/api/screener/forward', async (_req, res) => {
  try {
    const data = await fetchScreenerForward()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

export default router
