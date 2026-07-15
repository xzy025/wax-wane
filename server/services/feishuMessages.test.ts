import { describe, expect, it } from 'vitest'
import {
  emptySyncState,
  isFeishuSyncState,
  parseFileMessage,
  resolveCollision,
  sanitizeFileName,
} from './feishuMessages'

const fileItem = (over: Record<string, unknown> = {}) => ({
  message_id: 'om_abc123',
  msg_type: 'file',
  create_time: '1751900000000',
  body: { content: JSON.stringify({ file_key: 'file_v3_key', file_name: '中信-宁德时代深度.pdf' }) },
  ...over,
})

describe('parseFileMessage', () => {
  it('parses a pdf file message', () => {
    expect(parseFileMessage(fileItem())).toEqual({
      messageId: 'om_abc123',
      fileKey: 'file_v3_key',
      fileName: '中信-宁德时代深度.pdf',
      createTimeMs: 1751900000000,
    })
  })
  it('accepts .PDF case-insensitively and trims the name', () => {
    const item = fileItem({ body: { content: JSON.stringify({ file_key: 'k', file_name: ' 研报.PDF ' }) } })
    expect(parseFileMessage(item)?.fileName).toBe('研报.PDF')
  })
  it('rejects non-file and deleted messages', () => {
    expect(parseFileMessage(fileItem({ msg_type: 'text' }))).toBeNull()
    expect(parseFileMessage(fileItem({ deleted: true }))).toBeNull()
  })
  it('rejects non-pdf files (docx/images pass through the group untouched)', () => {
    const item = fileItem({ body: { content: JSON.stringify({ file_key: 'k', file_name: '纪要.docx' }) } })
    expect(parseFileMessage(item)).toBeNull()
  })
  it('rejects broken content instead of throwing', () => {
    expect(parseFileMessage(fileItem({ body: { content: 'not-json{' } }))).toBeNull()
    expect(parseFileMessage(fileItem({ body: {} }))).toBeNull()
    expect(parseFileMessage(fileItem({ body: { content: JSON.stringify({ file_name: 'a.pdf' }) } }))).toBeNull()
  })
  it('rejects missing/invalid message_id or create_time', () => {
    expect(parseFileMessage(fileItem({ message_id: undefined }))).toBeNull()
    expect(parseFileMessage(fileItem({ create_time: 'not-a-number' }))).toBeNull()
    expect(parseFileMessage(fileItem({ create_time: '0' }))).toBeNull()
  })
})

describe('sanitizeFileName', () => {
  it('keeps a normal chinese report name untouched', () => {
    expect(sanitizeFileName('K-Research-No028-算力瓶颈从GPU到全栈-20260708.pdf')).toBe(
      'K-Research-No028-算力瓶颈从GPU到全栈-20260708.pdf',
    )
  })
  it('neutralizes path traversal', () => {
    expect(sanitizeFileName('../../evil.pdf')).toBe('evil.pdf')
    expect(sanitizeFileName('..\\..\\windows\\evil.pdf')).toBe('windows evil.pdf')
  })
  it('strips windows-illegal and control characters', () => {
    expect(sanitizeFileName('a<b>:c"d|e?f*g.pdf')).toBe('a b c d e f g.pdf')
  })
  it('strips leading dots so the file is not skipped as hidden', () => {
    expect(sanitizeFileName('.hidden.pdf')).toBe('hidden.pdf')
  })
  it('truncates over-long names but keeps the .pdf suffix', () => {
    const name = sanitizeFileName(`${'长'.repeat(300)}.pdf`)
    expect(name.endsWith('.pdf')).toBe(true)
    expect(name.length).toBeLessThanOrEqual(124)
  })
  it('falls back on empty names', () => {
    expect(sanitizeFileName('...pdf')).toBe('feishu-report.pdf')
    expect(sanitizeFileName('???.pdf')).toBe('feishu-report.pdf')
  })
})

describe('resolveCollision', () => {
  it('returns the name as-is when free', () => {
    expect(resolveCollision('a.pdf', () => false)).toBe('a.pdf')
  })
  it('appends -2, -3 … until free', () => {
    const taken = new Set(['a.pdf', 'a-2.pdf'])
    expect(resolveCollision('a.pdf', (n) => taken.has(n))).toBe('a-3.pdf')
  })
})

describe('isFeishuSyncState', () => {
  it('accepts the empty state and a populated one', () => {
    expect(isFeishuSyncState(emptySyncState())).toBe(true)
    expect(
      isFeishuSyncState({
        version: 1,
        synced: { om_1: { fileName: 'a.pdf', savedAs: 'a.pdf', createTimeMs: 1, syncedAt: 'x' } },
        lastSyncAt: null,
        lastError: null,
      }),
    ).toBe(true)
  })
  it('rejects garbage', () => {
    expect(isFeishuSyncState(null)).toBe(false)
    expect(isFeishuSyncState({ version: 2, synced: {} })).toBe(false)
    expect(isFeishuSyncState({ version: 1 })).toBe(false)
  })
})
