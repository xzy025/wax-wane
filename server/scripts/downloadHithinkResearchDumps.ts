import { config as dotenv } from 'dotenv'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHithinkFinanceClient, readHithinkConfigFromEnv } from '../market-data/hithinkFinanceClient'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
dotenv({ path: resolve(root, 'server/.env') })
async function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--full')) throw new Error('Unsupported argument')
  const full = args.includes('--full')
  const client = createHithinkFinanceClient(readHithinkConfigFromEnv())
  const folder = resolve(root, 'server/data/hithink-research', new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(folder, { recursive: true })
  const files = []
  for (const kind of full ? ['daily-k', 'daily-k-10d', 'adjustment-factors'] : ['daily-k-10d', 'adjustment-factors']) {
    const result = await client.get<{ presigned_url: string }>(`/api/dump/market-dumps/${kind}/download-url`)
    if (!result.ok || !result.data?.presigned_url) throw new Error('Signing unavailable')
    const url = new URL(result.data.presigned_url)
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' || /^[\d.:]+$/.test(url.hostname)) throw new Error('Invalid download destination')
    // Signed URL is transient. Never forward API credentials, persist URL, or follow redirects.
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(kind === 'daily-k' ? 600_000 : 120_000) })
    if (!response.ok || !response.body) throw new Error('Download unavailable')
    const maximumBytes = (kind === 'daily-k' ? 2048 : 128) * 1024 * 1024
    if (Number(response.headers.get('content-length')) > maximumBytes) throw new Error('Size limit')
    const path = resolve(folder, `${kind}.parquet`)
    const file = await open(path, 'wx')
    const hash = createHash('sha256')
    let size = 0
    try {
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > maximumBytes) throw new Error('Size limit')
        hash.update(chunk)
        await file.writeFile(chunk)
      }
    } finally { await file.close() }
    const check = await open(path, 'r')
    const first = Buffer.alloc(4), last = Buffer.alloc(4)
    try { await check.read(first, 0, 4, 0); await check.read(last, 0, 4, Math.max(0, size - 4)) } finally { await check.close() }
    if (first.toString() !== 'PAR1' || last.toString() !== 'PAR1') throw new Error('Invalid parquet signature')
    files.push({ kind, path, bytes: size, sha256: hash.digest('hex'), receivedAt: new Date().toISOString(), signatureValid: true, schemaVerified: false })
  }
  const manifest = { status: 'research', eligibleAsTradeGate: false, files }
  await writeFile(resolve(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
  console.log(JSON.stringify(manifest, null, 2))
}
main().catch(() => { console.error('Dump download failed; signed URLs and credentials omitted. Incomplete files are not validated archives.'); process.exitCode = 1 })
