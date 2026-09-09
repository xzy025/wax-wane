import { config as dotenv } from 'dotenv'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { fetchStockKline } from '../services/ashare'
import { compareHithinkDailyBars, createHithinkFinanceClient, dateToShanghaiMs, normalizeHithinkDailyBars, readHithinkConfigFromEnv } from '../market-data/hithinkFinanceClient'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
dotenv({ path: resolve(root, 'server/.env') })
async function main() {
  const config = readHithinkConfigFromEnv()
  const client = createHithinkFinanceClient(config)
  if (!client.isConfigured) throw new Error('not-configured')
  const output = resolve(root, 'docs/research/hithink', `daily-shadow-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(output, { recursive: true })
  const rows = []
  for (const code of config.codes.slice(0, 5)) {
    for (const adjust of ['none', 'forward'] as const) {
      const source = await client.get('/api/a-share/prices/historical', {
        thscode: code, interval: '1d', adjust, start: dateToShanghaiMs(config.startDate), end: dateToShanghaiMs(config.endDate),
      })
      if (!source.ok) { rows.push({ code, adjust, status: 'unavailable', apiCode: source.code }); continue }
      const peer = await fetchStockKline(code.slice(0, 6), 101, 500, { adjustment: adjust === 'none' ? 'raw' : 'qfq' })
      const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
      const filter = (date: string) => date >= config.startDate && date <= config.endDate && date < today
      const bars = normalizeHithinkDailyBars(source.data).filter((bar) => filter(bar.date))
      const peerBars = peer.klines.filter((bar) => filter(bar.date))
      const adjustmentMatches = peer.adjustment === (adjust === 'none' ? 'raw' : 'qfq')
      // EM stock K volume is in lots. Preserve original evidence and label the conversion assumption.
      const normalizedPeer = peerBars.map((bar) => ({ ...bar, volume: bar.volume * (peer.provider === 'eastmoney' ? 100 : 1) }))
      const parity = compareHithinkDailyBars(bars, normalizedPeer, { adjustment: adjust, priceTolerance: 0.011, turnoverTolerance: 1 })
      const positiveRatios = bars.flatMap((bar) => {
        const match = peerBars.find((other) => other.date === bar.date)
        return match && match.volume > 0 ? [bar.volume / match.volume] : []
      }).sort((a, b) => a - b)
      const evidence = { code, adjust, requestedWindow: [config.startDate, config.endDate], receivedAt: source.receivedAt, providerAt: null, hithink: source.data, peer }
      const payload = JSON.stringify(evidence)
      const hash = createHash('sha256').update(payload).digest('hex')
      await writeFile(resolve(output, `${code}-${adjust}.json`), payload, { flag: 'wx' })
      rows.push({ code, adjust, peerProvider: peer.provider, adjustmentMatches, status: adjustmentMatches ? 'compared' : 'adjustment-mismatch', evidenceHash: hash, volumeRatioMedian: positiveRatios[Math.floor(positiveRatios.length / 2)] ?? null, peerVolumeMultiplier: peer.provider === 'eastmoney' ? 100 : 1, parity, productionEligible: false })
      await new Promise((done) => setTimeout(done, Math.max(350, config.requestGapMs)))
    }
  }
  const report = { status: 'research', eligibleAsTradeGate: false, notes: ['Current-day bars excluded. Retrospective capture does not prove historical PIT availability.', 'Volume conversion outside EastMoney remains unverified. Numeric agreement does not establish strategy effectiveness.'], rows }
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ output, ...report }, null, 2))
}
main().catch(() => { console.error('Daily shadow failed; credentials and upstream error bodies omitted.'); process.exitCode = 1 })
