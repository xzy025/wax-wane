import { existsSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { readAtomicJson, writeAtomicJson } from '../lib/atomicJsonStore'
import {
  computeDocumentHash,
  projectRelayCheckpoint,
  type ProjectRelayCheckpointInput,
} from './relayDailyReviewBuilder'
import type {
  RelayDailyReviewV1,
  RelayReviewOutcome,
  RelayReviewPhase,
} from './relayDailyReviewTypes'

const __dirname = dirname(fileURLToPath(import.meta.url))

export type RelayReviewStoreErrorKind =
  | 'not-found'
  | 'corrupt'
  | 'conflict'
  | 'validation'
  | 'already-frozen'
  | 'mismatch'

export class RelayReviewStoreError extends Error {
  constructor(
    public readonly kind: RelayReviewStoreErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'RelayReviewStoreError'
  }
}

export const RELAY_REVIEW_ARCHIVE_FILE = 'relay-daily-review-v1.json'

export function relayReviewRoot(): string {
  return process.env.RELAY_REVIEW_ROOT ?? join(__dirname, '..', '..', 'docs', 'ladder')
}

export function safeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function relayReviewDir(signalDate: string): string {
  if (!safeDate(signalDate)) throw new Error(`signalDate 必须是 YYYY-MM-DD，收到 ${signalDate}`)
  const [year, month] = signalDate.split('-')
  return join(relayReviewRoot(), year, month, signalDate)
}

export function relayReviewPath(signalDate: string, revision: number): string {
  if (!Number.isInteger(revision) || revision < 1) throw new Error(`revision 必须是 >=1 的整数，收到 ${revision}`)
  const file = revision === 1 ? RELAY_REVIEW_ARCHIVE_FILE : `relay-daily-review-v1-r${revision}.json`
  return join(relayReviewDir(signalDate), file)
}

const REVISION_RE = /^relay-daily-review-v1(?:-r(\d+))?\.json$/

export interface RelayRevisionMeta {
  revision: number
  path: string
  documentHash: string
}

function readRevisionMeta(signalDate: string): RelayRevisionMeta[] {
  const dir = relayReviewDir(signalDate)
  if (!existsSync(dir)) return []
  const out: RelayRevisionMeta[] = []
  for (const file of readdirSync(dir)) {
    const match = REVISION_RE.exec(file)
    if (!match) continue
    const revision = match[1] ? Number(match[1]) : 1
    const full = join(dir, file)
    const doc = readAtomicJson<RelayDailyReviewV1>(full)
    out.push({ revision, path: full, documentHash: doc?.documentHash ?? '' })
  }
  return out.sort((a, b) => a.revision - b.revision)
}

export function listRelayDailyReviewRevisions(signalDate: string): RelayRevisionMeta[] {
  if (!safeDate(signalDate)) throw new Error(`signalDate 必须是 YYYY-MM-DD，收到 ${signalDate}`)
  return readRevisionMeta(signalDate)
}

/**
 * Read a revision. revision omitted → latest available. A missing file returns
 * null; a corrupt latest file raises an explicit `corrupt` error (fail-closed)
 * unless options.allowLastGood, which returns the last good revision.
 */
export function readRelayDailyReview(
  signalDate: string,
  revision?: number,
  options: { allowLastGood?: boolean } = {},
): RelayDailyReviewV1 | null {
  const metas = readRevisionMeta(signalDate)
  if (metas.length === 0) return null
  const target = revision != null ? metas.find((row) => row.revision === revision) : metas[metas.length - 1]
  if (!target) return null
  const doc = readAtomicJson<RelayDailyReviewV1>(target.path)
  if (doc) return doc
  if (revision != null) throw new RelayReviewStoreError('corrupt', `revision ${revision} 文件损坏: ${target.path}`)
  if (metas.length > 1 && options.allowLastGood) {
    const previous = metas[metas.length - 2]
    const lastGood = readAtomicJson<RelayDailyReviewV1>(previous.path)
    if (lastGood) {
      return {
        ...lastGood,
        warnings: [...lastGood.warnings, `最新 revision 文件损坏，回退到 last-good revision ${previous.revision}`],
      }
    }
  }
  throw new RelayReviewStoreError('corrupt', `最新 revision 文件损坏且无 last-good: ${target.path}`)
}

export function latestRelayRevision(signalDate: string): RelayRevisionMeta | null {
  const metas = readRevisionMeta(signalDate)
  return metas.length ? metas[metas.length - 1] : null
}

/**
 * Freeze a close plan as revision 1. Idempotent by revisionContentHash: if an
 * existing revision carries the same hash, the existing revision is returned.
 * A frozen close plan is immutable — a different closePlanHash under the same
 * signalDate conflicts.
 */
export function freezeRelayClosePlan(revision: RelayDailyReviewV1): RelayDailyReviewV1 {
  const metas = readRevisionMeta(revision.signalDate)
  if (metas.length > 0) {
    const first = readAtomicJson<RelayDailyReviewV1>(metas[0].path)
    if (first && first.revisionContentHash === revision.revisionContentHash) {
      return first
    }
    throw new RelayReviewStoreError(
      'already-frozen',
      `signalDate ${revision.signalDate} 已有冻结 close plan，禁止改写`,
    )
  }
  const stored = { ...revision, revision: 1, supersedes: null }
  stored.documentHash = computeDocumentHash(stored)
  writeAtomicJson(relayReviewPath(revision.signalDate, 1), stored)
  return stored
}

export type AppendCheckpointInput = ProjectRelayCheckpointInput

/**
 * Append a checkpoint as the next immutable revision. Returns the newly stored
 * revision; conversely, if an identical revision already exists (same
 * revisionContentHash) the existing revision is returned without a new write.
 */
export function appendRelayCheckpoint(
  signalDate: string,
  input: AppendCheckpointInput,
): RelayDailyReviewV1 {
  const current = readRelayDailyReview(signalDate)
  if (!current) throw new RelayReviewStoreError('not-found', `signalDate ${signalDate} 尚未冻结 close plan`)
  if (current.latestCheckpoint === 'exit-settled') {
    throw new RelayReviewStoreError('conflict', 'exit-settled 之后不再追加检查点')
  }
  const projected = projectRelayCheckpoint(current, input)
  return writeNextRevision(signalDate, current, projected)
}

export function appendRelayOutcome(
  signalDate: string,
  outcome: RelayReviewOutcome,
  checkpoint: Extract<RelayDailyReviewV1['latestCheckpoint'], 'settled' | 'exit-settled'> = 'settled',
): RelayDailyReviewV1 {
  const current = readRelayDailyReview(signalDate)
  if (!current) throw new RelayReviewStoreError('not-found', `signalDate ${signalDate} 尚未冻结 close plan`)
  if (current.outcome && current.latestCheckpoint === 'settled') {
    throw new RelayReviewStoreError('conflict', 'settled outcome 已写入，禁止改写')
  }
  const projected = projectRelayCheckpoint(current, {
    signalDate: current.signalDate,
    tradeDate: current.tradeDate,
    checkpoint,
    observedAt: outcome.dataCutoffAt ?? outcome.observedAt ?? new Date().toISOString(),
    decisionAt: outcome.decisionAt ?? new Date().toISOString(),
    dataCutoffAt: outcome.dataCutoffAt ?? outcome.observedAt ?? new Date().toISOString(),
    sourceRefs: [],
    warnings: ['outcome 归档'],
  })
  const withOutcome: RelayDailyReviewV1 = {
    ...projected,
    outcome,
  }
  return writeNextRevision(signalDate, current, withOutcome)
}

function writeNextRevision(
  signalDate: string,
  current: RelayDailyReviewV1,
  projected: RelayDailyReviewV1,
): RelayDailyReviewV1 {
  const existing = readRevisionMeta(signalDate)
  for (const meta of existing) {
    const doc = readAtomicJson<RelayDailyReviewV1>(meta.path)
    if (doc && doc.revisionContentHash === projected.revisionContentHash) return doc
  }
  const nextRevision = current.revision + 1
  const supersede = {
    revision: current.revision,
    documentHash: current.documentHash,
  }
  const next: RelayDailyReviewV1 = {
    ...projected,
    revision: nextRevision,
    supersedes: current.revision >= 1 ? supersede : null,
    closePlanHash: current.closePlanHash,
  }
  next.documentHash = computeDocumentHash(next)
  writeAtomicJson(relayReviewPath(signalDate, nextRevision), next)
  return next
}

export function relayReviewArchiveExists(signalDate: string): boolean {
  return latestRelayRevision(signalDate) !== null
}

/** Resolve signalDate strictly from a frozen ledger tradeDate; null if absent. */
export function resolveSignalDateForTradeDate(tradeDate: string): { signalDate: string; tradeDate: string } | null {
  if (!safeDate(tradeDate)) throw new Error(`tradeDate 必须是 YYYY-MM-DD，收到 ${tradeDate}`)
  const root = relayReviewRoot()
  const [year, month] = tradeDate.split('-')
  const dir = join(root, year, month, tradeDate)
  if (!existsSync(dir)) return null
  const metas = readRevisionMeta(tradeDate)
  if (metas.length === 0) return null
  const doc = readAtomicJson<RelayDailyReviewV1>(metas[0].path)
  return doc ? { signalDate: doc.signalDate, tradeDate: doc.tradeDate } : null
}

export function getRelayReviewPhase(signalDate: string): RelayReviewPhase | null {
  const doc = readRelayDailyReview(signalDate)
  return doc ? doc.phase : null
}