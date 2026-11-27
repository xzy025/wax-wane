// Global JSON bodies used to allow 50mb on every route. Almost all payloads
// are small. Image chat, a full trade-book sync, and a one-day ladder import
// are the only callers that need more room, and none of them need 50mb.

export const DEFAULT_JSON_LIMIT = '1mb'
export const BULK_JSON_LIMIT = '8mb'

const BULK_PATHS = new Set([
  '/api/agent/chat',
  '/api/mcp/rag/sync',
  '/api/mcp/graph/sync',
  '/api/ladder/import',
])

function pathnameOf(path: string): string {
  const bare = path.split('?')[0] || '/'
  if (bare.length > 1 && bare.endsWith('/')) return bare.replace(/\/+$/, '')
  return bare
}

/** Accept `512kb` / `8mb`. Anything else falls back to the default. */
export function normalizeJsonLimit(raw: string | undefined, fallback: string): string {
  const value = raw?.trim() ?? ''
  if (/^\d+(kb|mb)$/i.test(value)) return value.toLowerCase()
  return fallback
}

export function jsonLimitForPath(path: string, configuredDefault?: string): string {
  const pathName = pathnameOf(path)
  if (BULK_PATHS.has(pathName)) return BULK_JSON_LIMIT
  return normalizeJsonLimit(configuredDefault, DEFAULT_JSON_LIMIT)
}
