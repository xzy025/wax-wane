import { config } from 'dotenv'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getHithinkProvider } from '../market-data/providers/ths/hithink'
import { writeThsEvidence, type ThsResponseCapture } from '../market-data/providers/ths/evidence'
import { createHithinkResearchService } from '../services/hithinkResearch'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: resolve(root, 'server/.env') })
async function main() {
  const captures: ThsResponseCapture[] = []
  const provider = getHithinkProvider()
  const getResearch = createHithinkResearchService(provider.client, { runtime: provider.runtime, captureResponse: (capture) => captures.push(capture) })
  const result = await getResearch(process.argv[2] ?? '600519.SH')
  const folder = resolve(root, 'docs/research/hithink', `research-integration-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(folder, { recursive: true })
  await writeThsEvidence(folder, captures)
  await writeFile(resolve(folder, 'snapshot.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ folder, datasets: result.datasets.map(({ dataset, status, reason }) => ({ dataset, status, reason })) }))
}
main().catch((error: unknown) => { console.error('Research capture failed:', error instanceof Error ? error.message : 'unknown error'); process.exitCode = 1 })
