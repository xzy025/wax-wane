import { describe, expect, it } from 'vitest'
import { classifyFile, fileDate, makeFingerprint, toReportFile } from './researchFiles'

describe('classifyFile', () => {
  it('accepts whitelist extensions case-insensitively', () => {
    expect(classifyFile('中信-宁德时代深度.pdf')).toBe('pdf')
    expect(classifyFile('report.PDF')).toBe('pdf')
    expect(classifyFile('周报.md')).toBe('md')
    expect(classifyFile('notes.markdown')).toBe('md')
    expect(classifyFile('memo.txt')).toBe('txt')
  })
  it('rejects everything else', () => {
    expect(classifyFile('简历.docx')).toBeNull()
    expect(classifyFile('data.json')).toBeNull()
    expect(classifyFile('noext')).toBeNull()
    expect(classifyFile('archive.tar.gz')).toBeNull()
  })
})

describe('makeFingerprint', () => {
  it('is deterministic and human-readable', () => {
    expect(makeFingerprint('a.pdf', 1024, 1700000000000)).toBe('a.pdf|1024|1700000000000')
    expect(makeFingerprint('a.pdf', 1024, 1700000000000)).toBe(makeFingerprint('a.pdf', 1024, 1700000000000))
  })
  it('changes when size or mtime changes (file replaced => re-analyze)', () => {
    const base = makeFingerprint('a.pdf', 1024, 1700000000000)
    expect(makeFingerprint('a.pdf', 2048, 1700000000000)).not.toBe(base)
    expect(makeFingerprint('a.pdf', 1024, 1700000000001)).not.toBe(base)
  })
})

describe('fileDate', () => {
  it('attributes UTC late-night mtime to the next Shanghai day', () => {
    // 2026-07-06T17:00Z = 2026-07-07 01:00 上海
    expect(fileDate(Date.parse('2026-07-06T17:00:00Z'))).toBe('2026-07-07')
  })
  it('keeps same-day afternoon as-is', () => {
    // 2026-07-07T08:00Z = 2026-07-07 16:00 上海
    expect(fileDate(Date.parse('2026-07-07T08:00:00Z'))).toBe('2026-07-07')
  })
})

describe('toReportFile', () => {
  const NOW = Date.parse('2026-07-07T08:00:00Z')
  const MTIME = NOW - 60_000 // 1 分钟前,已过拷贝防御窗

  it('builds a ReportFile with date + fingerprint', () => {
    const f = toReportFile('券商-深度.pdf', 2048, MTIME, NOW)
    expect(f).toMatchObject({
      name: '券商-深度.pdf',
      kind: 'pdf',
      sizeBytes: 2048,
      date: '2026-07-07',
      fingerprint: `券商-深度.pdf|2048|${MTIME}`,
    })
  })

  it('skips dot-prefixed files (.analyses etc.)', () => {
    expect(toReportFile('.analyses', 0, MTIME, NOW)).toBeNull()
    expect(toReportFile('.hidden.pdf', 10, MTIME, NOW)).toBeNull()
  })

  it('skips non-whitelisted extensions', () => {
    expect(toReportFile('简历.docx', 10, MTIME, NOW)).toBeNull()
  })

  it('skips files still being copied (mtime < 10s ago)', () => {
    expect(toReportFile('新研报.pdf', 10, NOW - 5_000, NOW)).toBeNull()
    expect(toReportFile('新研报.pdf', 10, NOW - 15_000, NOW)).not.toBeNull()
  })
})
