import { createHash } from 'node:crypto'

export interface CanonicalJsonOptions {
  /**
   * Paths (dotted object layout) treated as unordered collections that must be
   * sorted by a stable business key before hashing. Ordered timelines are
   * intentionally kept in caller-supplied order.
   */
  sortKeys?: Array<{ path: string; keyOf: (item: unknown) => string }>
}

function canonicalStable(value: unknown, path: string, sortKeys: NonNullable<CanonicalJsonOptions['sortKeys']>): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`canonicalJson: 非有限数字出现在 ${path}`)
    return value
  }
  if (value === null || value === undefined) return value
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const rule = sortKeys.find((row) => row.path === path)
    let items = value.map((item) => canonicalStable(item, `${path}[]`, sortKeys))
    if (rule && Array.isArray(items)) {
      items = [...items].sort((a, b) => {
        const ka = String(rule.keyOf(a))
        const kb = String(rule.keyOf(b))
        if (ka < kb) return -1
        if (ka > kb) return 1
        return 0
      })
    }
    return items
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalStable(record[key], path ? `${path}.${key}` : key, sortKeys)
    }
    return out
  }
  throw new Error(`canonicalJson: 不支持的值类型 ${String(value)} 出现在 ${path}`)
}

/**
 * Deterministic serialization: object keys sorted lexicographically, arrays in
 * caller order unless a sortKeys rule matches, non-finite numbers rejected so a
 * NaN/Infinity can never silently change a hash. `null` and absent fields stay
 * distinct.
 */
export function canonicalStringify(value: unknown, options: CanonicalJsonOptions = {}): string {
  return JSON.stringify(canonicalStable(value, '', options.sortKeys ?? []))
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function hashCanonical(value: unknown, options: CanonicalJsonOptions = {}): string {
  return sha256Hex(canonicalStringify(value, options))
}

export function sortBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const indexed = items.map((item, index) => ({ item, index }))
  indexed.sort((a, b) => {
    const ka = keyOf(a.item)
    const kb = keyOf(b.item)
    if (ka < kb) return -1
    if (ka > kb) return 1
    return a.index < b.index ? -1 : 1
  })
  return indexed.map((row) => row.item)
}