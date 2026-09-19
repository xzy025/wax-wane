// MCP 候选集(影子观察)路由。GET /api/screener/mcp-universe[?date=YYYY-MM-DD]
// 独立于正式选股快照：不进战法评分、不改信号状态、不写正式归档。
import { Router } from 'express'
import { fetchMcpUniverse } from '../services/mcpUniverse'

const router = Router()

router.get('/api/screener/mcp-universe', (req, res) => {
  const raw = req.query.date
  const date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined
  try {
    res.json(fetchMcpUniverse(date))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    // 文件缺失是"还没生成"，不是服务端故障，用 404 让前端区分于加载失败。
    res.status(message.includes('未找到') ? 404 : 500).json({ error: message })
  }
})

export default router
