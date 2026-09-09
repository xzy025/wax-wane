import { validSettlementArchive, type ArchiveKind } from './settlementQuality'

export function mayReplaceDatedArchive(next: unknown, previous: unknown, target: string, kind: ArchiveKind): boolean {
  if (!validSettlementArchive(next, target, kind)) return false
  const n = next as Record<string, unknown>
  if (!previous || typeof previous !== 'object') return true
  const p = previous as Record<string, unknown>
  if (p.asof !== target) return true
  if (kind === 'tempo' && Array.isArray(p.rows)) return (n.rows as unknown[]).length >= p.rows.length
  if (kind === 'structure' && Number.isFinite(Number(p.boardTotal))) return Number(n.boardTotal) >= Number(p.boardTotal)
  if (kind === 'review') {
    if (p.narrative && !n.narrative) return false
    for (const field of ['news', 'dragonTiger', 'overnight', 'asia']) {
      const before = p[field], after = n[field]
      if (Array.isArray(before) && before.length > (Array.isArray(after) ? after.length : 0)) return false
    }
  }
  return true
}
