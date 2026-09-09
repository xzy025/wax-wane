import { config as dotenv } from 'dotenv'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHithinkFinanceClient, dateToShanghaiMs, readHithinkConfigFromEnv } from '../market-data/hithinkFinanceClient'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
dotenv({ path: resolve(root, 'server/.env') })
type Ticker = { thscode: string; name?: string; asset_type?: string }

async function main() {
  const config = readHithinkConfigFromEnv()
  const client = createHithinkFinanceClient(config)
  if (!client.isConfigured) throw new Error('not-configured')
  const folder = resolve(root, 'docs/research/hithink', `universe-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(folder, { recursive: true })
  const entries: Array<{ id: string; file: string; sha256: string; ok: boolean; rows: number | null; apiCode: number | string | null }> = []
  const tickers: Ticker[] = []
  async function capture(id: string, endpoint: string, params: Record<string, string | number>) {
    const result = await client.get<{ item?: Ticker[] }>(endpoint, params)
    const file = `${id}.json`
    const payload = JSON.stringify({ endpoint, params, ok: result.ok, apiCode: result.code, httpStatus: result.httpStatus, receivedAt: result.receivedAt, data: result.data })
    await writeFile(resolve(folder, file), payload, { flag: 'wx' })
    entries.push({ id, file, sha256: createHash('sha256').update(payload).digest('hex'), ok: result.ok, rows: result.data?.item?.length ?? null, apiCode: result.code })
    await new Promise((done) => setTimeout(done, Math.max(350, config.requestGapMs)))
    return result
  }
  let complete = false
  for (let offset = 0; offset < 30_000; offset += 10_000) {
    const result = await capture(`tickers-${offset}`, '/api/meta/tickers/list', { exchange: 'SH,SZ,BJ', asset_type: 'a-share', limit: 10_000, offset })
    if (!result.ok || !Array.isArray(result.data?.item)) throw new Error('Incomplete catalog')
    tickers.push(...result.data.item)
    if (result.data.item.length < 10_000) { complete = true; break }
  }
  if (!complete || new Set(tickers.map((item) => item.thscode)).size !== tickers.length) throw new Error('Invalid pagination')
  const codes = ['000005.SZ', '000671.SZ', '002499.SZ', '300104.SZ', '600005.SH', '600086.SH', '833819.BJ', '920819.BJ', '835185.BJ', '920185.BJ', '830799.BJ', '920799.BJ']
  for (const code of codes) {
    await capture(`search-${code}`, '/api/meta/tickers/search', { q: code, asset_type: 'a-share', limit: 10 })
  }
  for (const code of ['000005.SZ', '300104.SZ', '600005.SH', '833819.BJ', '920819.BJ']) {
    await capture(`history-${code}`, '/api/a-share/prices/historical', { thscode: code, interval: '1d', adjust: 'none', start: dateToShanghaiMs('2016-09-06'), end: dateToShanghaiMs('2016-09-20') })
  }
  await writeFile(resolve(folder, 'catalog.json'), JSON.stringify(tickers), { flag: 'wx' })
  const manifest = { status: 'research-only', eligibleAsTradeGate: false, complete, tickerCount: tickers.length, entries }
  await writeFile(resolve(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ folder, ...manifest }, null, 2))
}
main().catch(() => { console.error('Universe probe failed; credentials and upstream errors omitted'); process.exitCode = 1 })
