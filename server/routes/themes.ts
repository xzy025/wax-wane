// 题材对比路由：GET /api/themes — 主流题材热度榜 + 成分股实时对比数据。
import { Router } from 'express'
import { fetchThemes } from '../services/themes'

const router = Router()

router.get('/api/themes', async (_req, res) => {
  try {
    const themes = await fetchThemes()
    res.json({ themes })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

export default router
