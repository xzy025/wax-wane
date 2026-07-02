// 新高战法选股器路由。GET /api/screener → 两组候选 + 市场 regime。
import { Router } from 'express'
import { fetchScreener } from '../services/screener'
import { fetchMarketStructure } from '../services/marketStructure'
import { fetchFundResonanceBoard } from '../services/fundResonanceBoard'
import { fetchOrgSurveyBoard } from '../services/orgSurveyBoard'
import { fetchDailyReview } from '../services/dailyReview'

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

// 每日复盘综述(外围→消息面→宏观日历→A股→板块轮动,数据卡+盘后LLM叙事)。GET /api/screener/daily-review。
router.get('/api/screener/daily-review', async (_req, res) => {
  try {
    const data = await fetchDailyReview()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// 资金共振榜(Top10,纯排行·非战法·非买点·未回测)。GET /api/screener/fund-resonance-board。
router.get('/api/screener/fund-resonance-board', async (_req, res) => {
  try {
    const data = await fetchFundResonanceBoard()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// 机构调研榜(纯排行·非战法·非买点·未回测)。GET /api/screener/org-survey-board。
router.get('/api/screener/org-survey-board', async (_req, res) => {
  try {
    const data = await fetchOrgSurveyBoard()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

export default router
