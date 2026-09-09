import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { stageSettlement } from './isolatedSettlement'
it('stages exact bytes without touching originals and rejects modified input', () => {
  const root = mkdtempSync(join(tmpdir(), 'settlement-test-'))
  try {
    const file = join(root, 'input.json')
    const bytes = JSON.stringify({ asof: '2026-09-07', overall: { n: 0 }, snapshotCount: 0, strategies: [] })
    writeFileSync(file, bytes)
    const input = { date: '2026-09-07', entries: [{ kind: 'forward' as const, file, sha256: createHash('sha256').update(bytes).digest('hex') }] }
    expect(stageSettlement(input, join(root, 'output')).promoted).toBe(false)
    writeFileSync(file, '{}')
    expect(() => stageSettlement(input, join(root, 'bad'))).toThrow('hash')
    expect(existsSync(join(root, 'bad'))).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
