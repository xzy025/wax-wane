import { config } from 'dotenv'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getHithinkProvider } from '../market-data/providers/ths/hithink'
import { writeThsEvidence, type ThsResponseCapture } from '../market-data/providers/ths/evidence'
import { createHithinkMarketResearch } from '../services/hithinkResearchMarket'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: resolve(root, 'server/.env') })
async function main() {
  const folder = resolve(root, 'docs/research/hithink', `market-integration-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(folder, { recursive: true })
  const captures: ThsResponseCapture[] = []
  const provider = getHithinkProvider()
  const getMarketResearch = createHithinkMarketResearch(provider.client, { runtime: provider.runtime, captureResponse: (capture) => captures.push(capture) })
  const requests = [{ dataset: 'hotlist', period: 'day' }, { dataset: 'boards', tag: 'industry' },
    { dataset: 'constituents', thscode: '000300.SH' }, { dataset: 'limit-up-pool', date: '2026-09-04' }]
  for (const query of requests) {
    const result = await getMarketResearch(query)
    await writeFile(resolve(folder, `${query.dataset}.json`), JSON.stringify(result, null, 2), { flag: 'wx' })
    console.log(JSON.stringify({ dataset: query.dataset, status: result.status, rows: result.data?.item.length ?? null, pages: result.captures.length }))
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  await writeThsEvidence(folder, captures)
  console.log(folder)
}
main().catch((error: unknown) => { console.error('Market research capture failed:', error instanceof Error ? error.message : 'unknown error'); process.exitCode = 1 })
