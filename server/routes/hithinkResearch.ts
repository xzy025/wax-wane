import { Router } from 'express'
import { getHithinkResearch, HithinkResearchInputError } from '../services/hithinkResearch'
import { getHithinkMarketResearch } from '../services/hithinkResearchMarket'

const router = Router()
router.get('/api/research/hithink/market', async (req, res) => {
  try {
    res.json(await getHithinkMarketResearch(req.query))
  } catch (error) {
    if (error instanceof HithinkResearchInputError) res.status(400).json({ error: error.message })
    else res.status(503).json({ error: 'Research source temporarily unavailable', eligibleAsTradeGate: false })
  }
})
router.get('/api/research/hithink/stock', async (req, res) => {
  try {
    if (typeof req.query.thscode !== 'string' || Object.keys(req.query).some((key) => key !== 'thscode')) {
      throw new HithinkResearchInputError('Only thscode is supported; this endpoint does not provide historical snapshots')
    }
    res.json(await getHithinkResearch(req.query.thscode))
  } catch (error) {
    if (error instanceof HithinkResearchInputError) res.status(400).json({ error: error.message })
    else res.status(503).json({ error: 'Research source temporarily unavailable', eligibleAsTradeGate: false })
  }
})
export default router
