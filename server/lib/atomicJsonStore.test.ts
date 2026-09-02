import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAtomicJson, writeAtomicJson } from './atomicJsonStore'

let tempDir = ''

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = ''
})

describe('atomicJsonStore', () => {
  it('round-trips JSON and returns null for malformed or invalid content', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'trade-review-atomic-'))
    const path = join(tempDir, 'snapshot.json')

    writeAtomicJson(path, { version: 1, rows: [{ code: '600000' }] })
    expect(readAtomicJson(path)).toEqual({ version: 1, rows: [{ code: '600000' }] })

    writeFileSync(path, '{broken', 'utf8')
    expect(readAtomicJson(path)).toBeNull()
    expect(readAtomicJson(path, { validate: (value): value is { version: number } =>
      typeof value === 'object' && value !== null && 'version' in value })).toBeNull()
  })

  it('creates parent directories and replaces the previous document as one write', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'trade-review-atomic-'))
    const path = join(tempDir, 'nested', 'snapshot.json')

    writeAtomicJson(path, { value: 'last-good' })
    writeAtomicJson(path, { value: 'new-good' })

    expect(readAtomicJson<{ value: string }>(path)).toEqual({ value: 'new-good' })
  })
})
