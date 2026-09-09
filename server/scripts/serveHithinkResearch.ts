import express from 'express'
import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import researchRoutes from '../routes/hithinkResearch'

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') })
const port = Number(process.env.HITHINK_RESEARCH_DEV_PORT)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('Set HITHINK_RESEARCH_DEV_PORT to run the standalone development server; normal use is server/index.ts on port 3002')
}
const app = express()
app.use(researchRoutes)
app.listen(port, '127.0.0.1', () => console.log(`Hithink research development API: http://127.0.0.1:${port}`))
