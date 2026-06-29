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
import screenerRoutes from './routes/screener'
import screenerForwardRoutes from './routes/screenerForward'
import rotationRoutes from './routes/rotation'
import mcpRoutes from './routes/mcp'
import dbRoutes from './routes/db'
import memoryRoutes from './routes/memory'
import analysisRoutes from './routes/analysis'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

config({ path: join(__dirname, '.env') })

const app = express()
const PORT = process.env.PORT ?? 3002

// CORS: allow dev server and local network access
const allowedOrigins = process.env.CORS_ORIGINS?.split(',') ?? [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3002',
]
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(null, true) // Permissive for local dev; tighten for production
      }
    },
  }),
)
app.use(express.json({ limit: '50mb' }))

// Route modules (each registers its own /api/... paths)
app.use(agentRoutes)
app.use(marketRoutes)
app.use(themesRoutes)
app.use(screenerRoutes)
app.use(screenerForwardRoutes)
app.use(rotationRoutes)
app.use(mcpRoutes)
app.use(dbRoutes)
app.use(memoryRoutes)
app.use(analysisRoutes)

// Initialize database and start server
async function startServer() {
  let dbConnected = false

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
  } catch (err) {
    console.warn('[Server] PostgreSQL not available, running in limited mode')
    console.warn('[Server] Agent chat API will work, but database features are disabled')
  }

  app.listen(PORT, () => {
    const protocol = process.env.LLM_API_URL ? getProtocol(process.env.LLM_API_URL) : 'unknown'
    console.log(`Agent server running on http://localhost:${PORT}`)
    console.log(`LLM configured: ${!!(process.env.LLM_API_URL && process.env.LLM_API_KEY)}`)
    console.log(`Protocol: ${protocol}`)
    console.log(`Model: ${process.env.LLM_MODEL}`)
    console.log(
      `Database: ${dbConnected ? 'PostgreSQL (connected)' : 'PostgreSQL (not connected - limited mode)'}`,
    )
  })
}

startServer()
