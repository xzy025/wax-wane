import { existsSync, readdirSync } from 'fs'
import { basename, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { readAtomicJson, writeAtomicJson } from '../lib/atomicJsonStore'
import { canonicalStringify } from '../lib/canonicalJson'
import {
  computeDocumentHash,
  computeSourceHash,
  computeRevisionContentHash,
  projectRelayCheckpoint,
  type ProjectRelayCheckpointInput,
} from './relayDailyReviewBuilder'
import { validateRelayDailyReviewRevision } from './relayDailyReviewValidation'
import type {
  RelayDailyReviewV1,
  RelayReviewQuality,
  RelayReviewOutcome,
  RelayReviewPhase,
  RelaySourceRef,
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
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
const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/

export interface RelayRevisionMeta {
  revision: number
  path: string
  documentHash: string
  /** WP3.1: false when the JSON parses but fails contract/hash validation. */
  valid: boolean
  errors: string[]
}

function readRevisionMeta(signalDate: string): RelayRevisionMeta[] {
  const dir = relayReviewDir(signalDate)
  if (!existsSync(dir)) return []
  const out: RelayRevisionMeta[] = []
  const files = readdirSync(dir)
    .map((file) => {
      const match = REVISION_RE.exec(file)
      return match ? { file, revision: match[1] ? Number(match[1]) : 1 } : null
    })
    .filter((row): row is { file: string; revision: number } => row !== null)
    .sort((a, b) => a.revision - b.revision)
  let previousDoc: RelayDailyReviewV1 | null = null
  let previousMeta: RelayRevisionMeta | null = null
  for (const { file, revision } of files) {
    const full = join(dir, file)
    const doc = readAtomicJson<RelayDailyReviewV1>(full)
    const errors = doc
      ? validateRelayDailyReviewRevision(doc, { expectedRevision: revision, previous: previousDoc })
      : ['JSON 无法解析或结构非法']
    if (previousMeta && !previousMeta.valid) errors.push(`前一 revision ${previousMeta.revision} 无效，链路不可信`)
    if (previousMeta && revision !== previousMeta.revision + 1) errors.push('revision 序列存在缺口')
    if (!previousMeta && revision !== 1) errors.push('缺少 revision 1 基线')
    const meta: RelayRevisionMeta = {
      revision,
      path: full,
      documentHash: doc?.documentHash ?? '',
      valid: errors.length === 0,
      errors: Array.from(new Set(errors)),
    }
    out.push(meta)
    previousDoc = doc
    previousMeta = meta
  }
  return out
}

export function listRelayDailyReviewRevisions(signalDate: string): RelayRevisionMeta[] {
  if (!safeDate(signalDate)) throw new Error(`signalDate 必须是 YYYY-MM-DD，收到 ${signalDate}`)
  return readRevisionMeta(signalDate)
}

/** Read a raw doc and fail-closed if it fails full contract validation. */
export function readValidatedRevision(path: string): RelayDailyReviewV1 {
  const doc = readAtomicJson<RelayDailyReviewV1>(path)
  if (!doc) throw new RelayReviewStoreError('corrupt', `文件无法解析: ${path}`)
  const match = REVISION_RE.exec(basename(path))
  const expectedRevision = match ? (match[1] ? Number(match[1]) : 1) : undefined
  const errors = validateRelayDailyReviewRevision(doc, { expectedRevision })
  if (errors.length > 0) {
    throw new RelayReviewStoreError('corrupt', `文件未通过完整校验: ${path}；${errors.slice(0, 3).join('；')}`)
  }
  return doc
}

/**
 * Read a revision. revision omitted → latest available. A missing file returns
 * null; a corrupt OR tampered (valid-JSON-but-bad-hash) revision raises an
 * explicit `corrupt` error (fail-closed) unless options.allowLastGood, which
 * only falls back to the previous revision that passed full validation.
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
  if (target.valid) return readAtomicJson<RelayDailyReviewV1>(target.path)
  if (revision != null) {
    throw new RelayReviewStoreError('corrupt', `revision ${revision} 未通过完整校验: ${target.path}；${target.errors.slice(0, 3).join('；')}`)
  }
  if (metas.length > 1 && options.allowLastGood) {
    const previous = [...metas].reverse().find((row) => row.valid)
    if (previous) {
      const lastGood = readAtomicJson<RelayDailyReviewV1>(previous.path)
      if (lastGood) {
        return {
          ...lastGood,
          warnings: [...lastGood.warnings, `最新 revision 未通过校验，回退到 last-good revision ${previous.revision}`],
        }
      }
    }
  }
  throw new RelayReviewStoreError('corrupt', `最新 revision 未通过完整校验且无可用 last-good: ${target.path}`)
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
    if (!metas[0].valid) {
      throw new RelayReviewStoreError('corrupt', `signalDate ${revision.signalDate} rev1 未通过完整校验，禁止覆盖`)
    }
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
  const validationErrors = validateRelayDailyReviewRevision(stored, { expectedRevision: 1 })
  if (validationErrors.length > 0) {
    throw new RelayReviewStoreError('validation', `close plan 未通过完整校验: ${validationErrors.slice(0, 3).join('；')}`)
  }
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
  const previousEntry = current.checkpoints.at(-1)
  if (previousEntry?.checkpoint === input.checkpoint) {
    const same = previousEntry.observedAt === input.observedAt &&
      previousEntry.dataCutoffAt === input.dataCutoffAt &&
      previousEntry.decisionAt === input.decisionAt &&
      computeSourceHash(previousEntry.sourceRefs) === computeSourceHash(input.sourceRefs) &&
      canonicalStringify(previousEntry.warnings) === canonicalStringify([...new Set(input.warnings ?? [])])
    if (same) return current
    throw new RelayReviewStoreError('conflict', `检查点 ${input.checkpoint} 已存在但内容不同`)
  }
  if (current.latestCheckpoint === 'exit-settled') {
    throw new RelayReviewStoreError('conflict', 'exit-settled 之后不再追加检查点')
  }
  const projected = projectRelayCheckpoint(current, input)
  return writeNextRevision(signalDate, current, projected)
}

export interface RelayOutcomeAppendInput {
  outcome: RelayReviewOutcome
  checkpoint?: Extract<RelayDailyReviewV1['latestCheckpoint'], 'settled' | 'exit-settled'>
  observedAt?: string
  dataCutoffAt?: string
  decisionAt?: string
  sourceRefs?: RelaySourceRef[]
  quality?: Partial<Omit<RelayReviewQuality, 'status'>>
  warnings?: string[]
}

export function appendRelayOutcome(
  signalDate: string,
  outcomeOrInput: RelayReviewOutcome | RelayOutcomeAppendInput,
  checkpoint: Extract<RelayDailyReviewV1['latestCheckpoint'], 'settled' | 'exit-settled'> = 'settled',
): RelayDailyReviewV1 {
  const appendInput: RelayOutcomeAppendInput = 'outcome' in outcomeOrInput
    ? outcomeOrInput
    : { outcome: outcomeOrInput }
  const { outcome } = appendInput
  const targetCheckpoint = appendInput.checkpoint ?? checkpoint
  const current = readRelayDailyReview(signalDate)
  if (!current) throw new RelayReviewStoreError('not-found', `signalDate ${signalDate} 尚未冻结 close plan`)
  const previousOutcomeCheckpoint = current.checkpoints.at(-1)
  const sameOutcomeRetry = current.outcome && previousOutcomeCheckpoint?.checkpoint === targetCheckpoint &&
    canonicalStringify(current.outcome) === canonicalStringify(outcome) &&
    computeSourceHash(previousOutcomeCheckpoint.sourceRefs) === computeSourceHash(appendInput.sourceRefs ?? [])
  if (sameOutcomeRetry) {
    return current
  }
  const canPromoteToExitSettled = current.latestCheckpoint === 'settled' && targetCheckpoint === 'exit-settled'
  if (current.outcome && !canPromoteToExitSettled) {
    throw new RelayReviewStoreError('conflict', 'settled outcome 已写入，禁止改写')
  }
  const now = new Date().toISOString()
  const observedAt = appendInput.observedAt ?? outcome.dataCutoffAt ?? outcome.observedAt ?? now
  const decisionAt = appendInput.decisionAt ?? outcome.decisionAt ?? observedAt
  const dataCutoffAt = appendInput.dataCutoffAt ?? outcome.dataCutoffAt ?? outcome.observedAt ?? observedAt
  const projected = projectRelayCheckpoint(current, {
    signalDate: current.signalDate,
    tradeDate: current.tradeDate,
    checkpoint: targetCheckpoint,
    observedAt,
    decisionAt,
    dataCutoffAt,
    sourceRefs: appendInput.sourceRefs ?? [],
    quality: appendInput.quality,
    warnings: ['outcome 归档', ...(appendInput.warnings ?? [])],
  })
  // WP3.1 Fix 1: outcome must be part of the revision hash chain, so the
  // projected revision (hash computed before outcome was attached) must be
  // finalized through the same path as every other revision.
  const withOutcome: RelayDailyReviewV1 = {
    ...projected,
    outcome,
    revisionContentHash: computeRevisionContentHash({
      closePlanHash: projected.closePlanHash,
      checkpoints: projected.checkpoints,
      outcome,
      validation: projected.validation,
      warnings: projected.warnings,
    }),
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
    if (meta.valid && doc && doc.revisionContentHash === projected.revisionContentHash) return doc
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
  const validationErrors = validateRelayDailyReviewRevision(next, {
    expectedRevision: nextRevision,
    previous: current,
  })
  if (validationErrors.length > 0) {
    throw new RelayReviewStoreError('validation', `新 revision 未通过完整校验: ${validationErrors.slice(0, 3).join('；')}`)
  }
  writeAtomicJson(relayReviewPath(signalDate, nextRevision), next)
  return next
}

export function relayReviewArchiveExists(signalDate: string): boolean {
  return latestRelayRevision(signalDate) !== null
}

/**
 * Scan every frozen relay review ledger (under the relay root) and return the
 * one whose ledger `tradeDate` matches. Archives are stored under signalDate,
 * so this cannot be a directory-name lookup; it must inspect ledger fields.
 */
export function listFrozenLedgersByTradeDate(): Array<{ signalDate: string; tradeDate: string }> {
  const root = relayReviewRoot()
  if (!existsSync(root)) return []
  const out: Array<{ signalDate: string; tradeDate: string }> = []
  for (const year of readdirSync(root)) {
    if (!/^\d{4}$/.test(year)) continue
    const yearPath = join(root, year)
    if (!existsSync(yearPath)) continue
    for (const month of readdirSync(yearPath)) {
      if (!/^\d{2}$/.test(month)) continue
      const monthPath = join(yearPath, month)
      if (!existsSync(monthPath)) continue
      for (const signalDate of readdirSync(monthPath)) {
        if (!DATE_DIR_RE.test(signalDate)) continue
        const dir = join(monthPath, signalDate)
        if (!existsSync(dir)) continue
        const metas = readRevisionMeta(signalDate)
        if (metas.length === 0) continue
        if (metas.some((meta) => !meta.valid)) continue
        const doc = readAtomicJson<RelayDailyReviewV1>(metas[0].path)
        if (doc && safeDate(doc.tradeDate)) {
          out.push({ signalDate: doc.signalDate, tradeDate: doc.tradeDate })
        }
      }
    }
  }
  return out.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
}

/** Resolve signalDate strictly from a frozen ledger tradeDate; null if absent. */
export function resolveSignalDateForTradeDate(tradeDate: string): { signalDate: string; tradeDate: string } | null {
  if (!safeDate(tradeDate)) throw new Error(`tradeDate 必须是 YYYY-MM-DD，收到 ${tradeDate}`)
  const matches = listFrozenLedgersByTradeDate().filter((row) => row.tradeDate === tradeDate)
  if (matches.length > 1) {
    throw new RelayReviewStoreError('conflict', `tradeDate ${tradeDate} 对应多个 signalDate，拒绝自动选择`)
  }
  return matches[0] ?? null
}

export function getRelayReviewPhase(signalDate: string): RelayReviewPhase | null {
  const doc = readRelayDailyReview(signalDate)
  return doc ? doc.phase : null
}
