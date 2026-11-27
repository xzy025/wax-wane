import express from 'express'
import cors from 'cors'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { initDatabase } from './db/pgDatabase'
import { getProtocol } from './lib/llm'
import agentRoutes from './routes/agent'
import marketRoutes from './routes/market'
import themesRoutes from './routes/themes'
import mcpRoutes from './routes/mcp'
import dbRoutes from './routes/db'
import memoryRoutes from './routes/memory'
import analysisRoutes from './routes/analysis'
import intelRoutes from './routes/intel'
import holdingsRoutes from './routes/holdings'
import ladderRoutes from './routes/ladder'
import opsRoutes from './routes/ops'
import hithinkResearchRoutes from './routes/hithinkResearch'
// MCP 候选集影子面板：挂在公开注册链上，不依赖私有战法层是否安装。
import mcpUniverseRoutes from './routes/mcpUniverse'
import { startSchedulerCoordinator } from './services/schedulerCoordinator'
import { loadStrategy, logStrategyStatus } from './strategy/loader'
import { resolveBindHost } from './http/bind'
import { createApiGuard, resolveApiAuth } from './http/apiGuard'
import { jsonLimitForPath } from './http/jsonLimit'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

config({ path: join(__dirname, '.env') })

const app = express()
const bindHost = resolveBindHost(process.env.WAX_WANE_BIND)

function listenPort(): number {
  const parsed = Number(process.env.PORT ?? 3002)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    console.error(`[Server] PORT 无效: ${process.env.PORT}`)
    process.exit(1)
  }
  return parsed
}

const PORT = listenPort()

function loadApiAuth() {
  try {
    return resolveApiAuth({
      bindHost,
      configuredToken: process.env.WAX_WANE_API_TOKEN,
      protectedPrefixes: process.env.WAX_WANE_PROTECTED_PREFIXES,
    })
  } catch (err) {
    console.error(`[Server] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

const apiAuth = loadApiAuth()

// CORS：本机前端，以及 CORS_ORIGINS 里额外写明的来源。
// 私网 Origin 只为 WAX_WANE_BIND=lan 的浏览器访问保留。跨域放行不等于免凭证。
const allowedOrigins = process.env.CORS_ORIGINS?.split(',') ?? [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3002',
]
const PRIVATE_LAN_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/
app.use(
  cors({
    origin: (origin, callback) => {
      // curl 与同源代理没有 Origin。
      if (!origin || allowedOrigins.includes(origin) || PRIVATE_LAN_ORIGIN.test(origin)) {
        callback(null, true)
      } else {
        callback(null, false)
      }
    },
  }),
)
// 凭证先于 JSON 解析，避免未授权请求把大 body 读进内存。
// 挂在全部路由之前，后注册的战法层路由同样经过这里。
app.use(createApiGuard(apiAuth))
app.use((req, res, next) => {
  const limit = jsonLimitForPath(req.path, process.env.WAX_WANE_JSON_LIMIT)
  return express.json({ limit })(req, res, next)
})

// Route modules (each registers its own /api/... paths)
app.use(agentRoutes)
app.use(marketRoutes)
app.use(themesRoutes)
app.use(mcpRoutes)
app.use(dbRoutes)
app.use(memoryRoutes)
app.use(analysisRoutes)
app.use(intelRoutes)
app.use(holdingsRoutes)
app.use(ladderRoutes)
app.use(opsRoutes)
app.use(hithinkResearchRoutes)
app.use(mcpUniverseRoutes)

// Initialize database and start server
async function startServer() {
  let dbConnected = false

  // 私有战法层（选股/轮动/挥手研究路由、Agent 策略工具）。
  // 未安装时 loadStrategy() 返回 null —— 不抛错、不阻断启动，对应端点不存在。
  const strategy = await loadStrategy()
  logStrategyStatus()
  strategy?.routes?.register(app)

  try {
    await initDatabase()
    console.log('[Server] PostgreSQL database initialized')
    dbConnected = true

    // Initialize GraphRAG schema
    try {
      const { initGraphSchema } = await import('./graph/graphSchema')
      await initGraphSchema()
      console.log('[Server] GraphRAG schema initialized')
    } catch (err) {
      console.warn('[Server] GraphRAG schema init failed (non-fatal):', err)
    }
  } catch {
    console.warn('[Server] PostgreSQL not available, running in limited mode')
    console.warn('[Server] Agent chat API will work, but database features are disabled')
  }

  app.listen(PORT, bindHost, () => {
    const protocol = process.env.LLM_API_URL ? getProtocol(process.env.LLM_API_URL) : 'unknown'
    const authMode = apiAuth.devDefault ? 'localhost dev token' : 'WAX_WANE_API_TOKEN'
    console.log(`Agent server listening on http://${bindHost}:${PORT}`)
    console.log(`API auth: ${authMode}`)
    console.log(`LLM configured: ${!!(process.env.LLM_API_URL && process.env.LLM_API_KEY)}`)
    console.log(`Protocol: ${protocol}`)
    console.log(`Model: ${process.env.LLM_MODEL}`)
    console.log(
      `Database: ${dbConnected ? 'PostgreSQL (connected)' : 'PostgreSQL (not connected - limited mode)'}`,
    )
    startSchedulerCoordinator()
  })
}

startServer()
