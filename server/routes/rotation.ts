// 板块轮动路由:GET /api/rotation(2×2 象限)+ /api/rotation/stock-boards(个股反查板块)
// + /api/rotation/tempo(节奏表:板块×5日 启动/调整网格)。
import { Router } from 'express'
import { fetchRotation, fetchStockBoards, fetchBoardStocks, type RotationCategory } from '../services/rotation'
import { fetchRotationTempo } from '../services/rotationTempo'

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

// 节奏表:pins 只影响富注记增补(钉选行不在 heat 前30 时按需补算),不进主缓存 key。
router.get('/api/rotation/tempo', async (req, res) => {
  try {
    const pins = String(req.query.pins ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    res.json(await fetchRotationTempo(pins))
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
