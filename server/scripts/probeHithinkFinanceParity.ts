import { config as dotenv } from 'dotenv'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareHithinkDailyBars, createHithinkFinanceClient, dateToShanghaiMs, normalizeHithinkDailyBars, probeHithinkCapabilities, readHithinkConfigFromEnv, renderHithinkCapabilityMatrix, type ComparableDailyBar } from '../market-data/hithinkFinanceClient'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
dotenv({ path: resolve(root, 'server/.env') })

async function main() {
  const config = readHithinkConfigFromEnv()
  const matrix = await probeHithinkCapabilities({ config })
  const output = resolve(root, 'docs/research/hithink', new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, 'capabilities.json'), JSON.stringify(matrix, null, 2), { flag: 'wx' })
  await writeFile(resolve(output, 'capabilities.md'), renderHithinkCapabilityMatrix(matrix), { flag: 'wx' })
  // Peer evidence is explicit: legacy caches cannot establish units/adjustment.
  const peerPath = process.env.HITHINK_FINANCE_PEER_FILE
  if (config.apiKey && peerPath) {
    const peer = JSON.parse(await readFile(resolve(root, peerPath), 'utf8')) as {
      thscode: string; adjustment: 'none' | 'forward' | 'backward'; volumeUnit: string; turnoverUnit: string; bars: ComparableDailyBar[]
    }
    if (!config.codes.includes(peer.thscode) || !['none', 'forward', 'backward'].includes(peer.adjustment)
      || peer.volumeUnit !== 'shares' || peer.turnoverUnit !== 'currency' || !Array.isArray(peer.bars)) throw new Error('Peer evidence requires matching code, adjustment and explicit shares/currency units')
    const response = await createHithinkFinanceClient(config).get('/api/a-share/prices/historical', {
      thscode: peer.thscode, interval: '1d', adjust: peer.adjustment,
      start: dateToShanghaiMs(config.startDate), end: dateToShanghaiMs(config.endDate),
    })
    if (!response.ok) throw new Error('Historical request unavailable; parity was not evaluated')
    const bars = normalizeHithinkDailyBars(response.data)
    const parity = compareHithinkDailyBars(bars, peer.bars, { adjustment: peer.adjustment })
    await writeFile(resolve(output, 'parity.json'), JSON.stringify({ status: 'research', eligibleAsTradeGate: false, receivedAt: response.receivedAt, providerAt: null, parity }, null, 2), { flag: 'wx' })
  }
  console.log(JSON.stringify({ configured: matrix.configured, checks: matrix.results.length, output, parity: peerPath && config.apiKey ? 'evaluated' : 'not-evaluated', eligibleAsTradeGate: false }))
}
main().catch(() => { console.error('Financial-API probe failed; check configuration and availability. No credentials printed.'); process.exitCode = 1 })
