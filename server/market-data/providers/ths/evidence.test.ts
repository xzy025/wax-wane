import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readVerifiedThsEvidence, writeThsEvidence } from './evidence'

const folders: string[] = []
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))) })

describe('THS evidence storage', () => {
  it('writes immutable raw responses with a replay-verifiable manifest', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'ths-evidence-'))
    folders.push(folder)
    const manifest = await writeThsEvidence(folder, [{
      adapter: 'stock-research', dataset: 'valuation', endpoint: '/api/a-share/valuations/snapshot',
      params: { thscodes: '600519.SH', api_key: 'must-not-appear' }, requestId: 'req-1',
      receivedAt: '2026-09-07T00:00:00.000Z', rawBytes: new TextEncoder().encode('{"code":0}'),
    }])
    expect(manifest.captures[0].params).toEqual({ thscodes: '600519.SH' })
    await expect(readVerifiedThsEvidence(folder)).resolves.toHaveLength(1)
    await expect(writeThsEvidence(folder, [])).rejects.toThrow()
  })

  it('rejects tampered raw evidence', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'ths-evidence-'))
    folders.push(folder)
    await writeThsEvidence(folder, [{
      adapter: 'market-research', dataset: 'hotlist', endpoint: '/api/a-share/special-data/hot-stock-list',
      params: {}, requestId: null, receivedAt: '2026-09-07T00:00:00.000Z', rawBytes: new TextEncoder().encode('{"code":0}'),
    }])
    await writeFile(join(folder, 'raw-001.json'), '{"code":1}')
    await expect(readVerifiedThsEvidence(folder)).rejects.toThrow('hash mismatch')
    expect(await readFile(join(folder, 'raw-001.json'), 'utf8')).toContain('code')
  })
})
