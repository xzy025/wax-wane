import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validSettlementArchive, type ArchiveKind } from './settlementQuality'

export function stageSettlement(input: { date: string; entries: Array<{ kind: ArchiveKind; file: string; sha256: string }> }, output: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !input.entries.length) throw new Error('Invalid replay manifest')
  // Validate all inputs before creating output. No service imports: a replay
  // must never start live collectors or initialize the production database.
  const checked = input.entries.map((entry) => {
    const bytes = readFileSync(entry.file)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== entry.sha256) throw new Error('Input hash mismatch')
    const value = JSON.parse(bytes.toString('utf8'))
    if (!validSettlementArchive(value, input.date, entry.kind)) throw new Error(`Invalid target-date ${entry.kind}`)
    return { ...entry, bytes, sha256 }
  })
  if (new Set(checked.map((entry) => entry.kind)).size !== checked.length) throw new Error('Duplicate product')
  mkdirSync(output, { recursive: false })
  for (const entry of checked) writeFileSync(join(output, `${entry.kind}-${input.date}.json`), entry.bytes, { flag: 'wx' })
  const report = { date: input.date, status: 'staged-for-review', promoted: false, entries: checked.map(({ bytes: _bytes, ...entry }) => entry) }
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  return report
}
