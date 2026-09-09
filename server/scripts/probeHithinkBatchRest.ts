import { config as dotenv } from 'dotenv'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHithinkFinanceClient, dateToShanghaiMs, readHithinkConfigFromEnv } from '../market-data/hithinkFinanceClient'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
dotenv({ path: resolve(root, 'server/.env') })

async function main() {
  if (!process.argv[2]) throw new Error('Provide the predeclared sample plan')
  const planText = await readFile(resolve(process.argv[2]), 'utf8')
  const plan = JSON.parse(planText) as { samples: Array<{ code: string; bars: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number; amount: number }> }> }
  const config = readHithinkConfigFromEnv()
  const client = createHithinkFinanceClient(config)
  if (!client.isConfigured) throw new Error('not-configured')
  const folder = resolve(root, 'docs/research/hithink', `batch-rest-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(folder, { recursive: true })
  const entries = []
  for (const code of ['000001.SZ', '002714.SZ', '300101.SZ']) {
    const sample = plan.samples.find((item) => item.code === code)
    if (!sample) throw new Error('Required sample missing')
    const params = { thscode: code, interval: '1d', adjust: 'none', start: dateToShanghaiMs('2025-11-27'), end: dateToShanghaiMs('2025-12-01') }
    const result = await client.get<{ item?: Array<{ date_ms: number; open_price: number; high_price: number; low_price: number; close_price: number; volume: number; turnover: number }> }>('/api/a-share/prices/historical', params)
    if (!result.ok) { entries.push({ code, available: false, apiCode: result.code }); continue }
    const payload = JSON.stringify({ code, params, receivedAt: result.receivedAt, requestId: result.requestId, data: result.data })
    const file = `${code}.json`
    await writeFile(resolve(folder, file), payload, { flag: 'wx' })
    const bars = result.data?.item ?? []
    const exactDumpAgreement = bars.length === sample.bars.length && sample.bars.every((bar) => {
      const match = bars.find((item) => item.date_ms === dateToShanghaiMs(bar.date))
      return match && match.open_price === bar.open && match.high_price === bar.high && match.low_price === bar.low && match.close_price === bar.close && match.volume === bar.volume && match.turnover === bar.amount
    })
    entries.push({ code, available: true, file, sha256: createHash('sha256').update(payload).digest('hex'), bars: bars.length, exactDumpAgreement })
    await new Promise((done) => setTimeout(done, Math.max(350, config.requestGapMs)))
  }
  const manifest = { status: 'research-only', eligibleAsTradeGate: false, planSha256: createHash('sha256').update(planText).digest('hex'), entries }
  await writeFile(resolve(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ folder, ...manifest }, null, 2))
}
main().catch(() => { console.error('Batch REST probe failed; credentials and upstream errors omitted'); process.exitCode = 1 })
