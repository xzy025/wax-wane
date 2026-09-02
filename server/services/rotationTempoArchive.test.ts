import { describe, expect, it } from 'vitest'
import {
  fetchRotationTempoAt,
  readRotationTempoArchive,
  tempoArchivePath,
} from './rotationTempo'

describe('rotation tempo point-in-time archive', () => {
  it('returns unavailable for a missing historical date instead of loading live data', async () => {
    await expect(fetchRotationTempoAt('1900-01-01')).resolves.toBeNull()
    expect(readRotationTempoArchive('not-a-date')).toBeNull()
  })

  it('builds an exact date-scoped archive path', () => {
    expect(tempoArchivePath('2026-08-28').endsWith('tempo-2026-08-28.json')).toBe(true)
    expect(() => tempoArchivePath('20260828')).toThrow('YYYY-MM-DD')
  })

  it('accepts an existing archive only when its asof matches the requested date', () => {
    const archive = readRotationTempoArchive('2026-08-28')
    if (archive) {
      expect(archive.asof).toBe('2026-08-28')
      expect(archive.fromArchive).toBe(true)
    }
  })
})
