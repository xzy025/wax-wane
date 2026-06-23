// 板块轮动路由:GET /api/rotation(2×2 象限)+ /api/rotation/stock-boards(个股反查板块)。
import { Router } from 'express'
import { fetchRotation, fetchStockBoards, fetchBoardStocks, type RotationCategory } from '../services/rotation'

const router = Router()

router.get('/api/rotation', async (req, res) => {
  try {
    const category: RotationCategory = req.query.category === 'concept' ? 'concept' : 'industry'
    const longWin = Number(req.query.long) || 60
    const shortWin = Number(req.query.short) || 5
    const data = await fetchRotation(category, longWin, shortWin)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
})

router.get('/api/rotation/stock-boards', async (req, res) => {
  try {
    const q = String(req.query.q ?? '')
    res.json(await fetchStockBoards(q))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
})

// 板块内强势股下钻:成分股跑新高战法,返回突破/扳机候选。
router.get('/api/rotation/board-stocks', async (req, res) => {
  try {
    const code = String(req.query.code ?? '')
    if (!code) {
      res.status(400).json({ error: 'missing board code' })
      return
    }
    const data = await fetchBoardStocks(code)
    const name = req.query.name ? String(req.query.name) : data.name
    res.json({ ...data, name })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
})

export default router
