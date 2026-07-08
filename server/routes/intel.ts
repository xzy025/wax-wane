// 消息面 tab 路由:7x24 实时快讯 + 每日研报 LLM 看板。
import { Router } from 'express'
import { fetchNewsFlash } from '../services/newsFlash'
import { fetchResearch, listResearchDates } from '../services/research'

const router = Router()

// 7x24 快讯(东财主源+新浪备源,归一化去重)。GET /api/intel/flash。
router.get('/api/intel/flash', async (_req, res) => {
  try {
    const data = await fetchNewsFlash()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// 每日研报看板(?date=YYYY-MM-DD 回看,缺省今日)。GET /api/intel/research。
router.get('/api/intel/research', async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : undefined
    const data = await fetchResearch(date)
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// 可回看的研报日期列表。GET /api/intel/research/dates。
router.get('/api/intel/research/dates', (_req, res) => {
  try {
    res.json({ dates: listResearchDates() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

export default router
