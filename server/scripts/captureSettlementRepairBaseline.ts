import { createHash } from 'node:crypto'
import { copyFileSync, constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'

const folder = resolve('docs/research/strategy-review-data/2026-09-07', `baseline-${new Date().toISOString().replace(/[:.]/g, '-')}`)
mkdirSync(folder)
const files = ['docs/screener/2026-09-07.json', 'docs/screener/tempo-2026-09-07.json', 'docs/screener/structure-2026-09-07.json',
  'docs/screener/review-2026-09-07.json', 'docs/screener/forward-2026-09-07.json', '.runtime/settlement-archive-scheduler.json',
  'docs/ladder/2026/09/07/analysis-limit-ladder-v6.json', 'docs/ladder/2026/09/07/ladder-sentiment-quant-v1.json']
const entries = files.map((file) => {
  try {
    const bytes = readFileSync(file)
    copyFileSync(file, resolve(folder, basename(file)), constants.COPYFILE_EXCL)
    let priorHash: string | null = null
    try { priorHash = createHash('sha256').update(readFileSync(resolve('docs/research/strategy-review-data/2026-09-07/before', basename(file)))).digest('hex') } catch { /* no prior copy */ }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return { file, sha256, priorHash, unchanged: priorHash ? priorHash === sha256 : null }
  } catch { return { file, status: 'missing' } }
})
writeFileSync(resolve(folder, 'manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), node: process.version, entries }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ folder, entries }))
