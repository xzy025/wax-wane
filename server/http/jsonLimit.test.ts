import { describe, expect, it } from 'vitest'
import { BULK_JSON_LIMIT, DEFAULT_JSON_LIMIT, jsonLimitForPath } from './jsonLimit'

describe('jsonLimitForPath', () => {
  it('keeps ordinary routes at 1mb', () => {
    expect(jsonLimitForPath('/api/refresh')).toBe(DEFAULT_JSON_LIMIT)
    expect(jsonLimitForPath('/api/memory/local')).toBe('1mb')
    expect(jsonLimitForPath('/api/db/trades')).toBe('1mb')
  })

  it('raises the limit only for known bulk payloads', () => {
    expect(jsonLimitForPath('/api/agent/chat')).toBe(BULK_JSON_LIMIT)
    expect(jsonLimitForPath('/api/mcp/rag/sync')).toBe('8mb')
    expect(jsonLimitForPath('/api/mcp/graph/sync')).toBe('8mb')
    expect(jsonLimitForPath('/api/ladder/import?x=1')).toBe('8mb')
  })

  it('honors a valid default override and ignores garbage', () => {
    expect(jsonLimitForPath('/api/refresh', '2mb')).toBe('2mb')
    expect(jsonLimitForPath('/api/agent/chat', '2mb')).toBe('8mb')
    expect(jsonLimitForPath('/api/refresh', '50mb; rm')).toBe('1mb')
    expect(jsonLimitForPath('/api/refresh', '')).toBe('1mb')
  })
})
