import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { todayShanghai } from '../lib/time'
import {
  getLatestScreenerSnapshot,
  getScreenerSnapshotRevisions,
  isDbReady,
} from '../db/pgDatabase'
import {
  evaluateFormalScreenerSnapshot,
  type FormalScreenerSnapshot,
} from '../market-data/snapshotPolicy'
import {
  normalizeConfirmedScreenerArchive,
  parseScreenerArchiveName,
} from './screenerArchive'
import { validSettlementArchive } from './settlementQuality'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DEFAULT_SCREENER_ROOT = join(__dirname, '..', '..', 'docs', 'screener')
const DEFAULT_LADDER_ROOT = join(__dirname, '..', '..', 'docs', 'ladder')

export type DataQualityAuditStatus = 'pass' | 'warn' | 'block'

export interface DataQualityAuditCheck {
  id: string
  status: DataQualityAuditStatus
  asof?: string | null
  observedAt?: string | null
  details: string[]
  metrics?: Record<string, number | string | boolean | null>
}

export interface DataQualityAuditReport {
  generatedAt: string
  tradeDate: string
  overall: DataQualityAuditStatus
  checks: DataQualityAuditCheck[]
}

interface AuditOptions {
  nowMs?: number
  screenerRoot?: string
  ladderRoot?: string
  dbReady?: () => boolean
  getLatestSnapshot?: typeof getLatestScreenerSnapshot
  getRevisions?: typeof getScreenerSnapshotRevisions
}

interface ParsedArchive {
  filename: string
  asof: string
  value: Record<string, unknown>
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {}

const statusRank: Record<DataQualityAuditStatus, number> = { pass: 0, warn: 1, block: 2 }

function worstStatus(checks: DataQualityAuditCheck[]): DataQualityAuditStatus {
  return checks.reduce<DataQualityAuditStatus>(
    (current, check) => statusRank[check.status] > statusRank[current] ? check.status : current,
    'pass',
  )
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return object(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

function daysSince(asof: string, tradeDate: string): number | null {
  const start = Date.parse(`${asof}T00:00:00Z`)
  const end = Date.parse(`${tradeDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.max(0, Math.floor((end - start) / 86_400_000))
}

function screenerRejectionDetails(value: Record<string, unknown>): string[] {
  const details: string[] = []
  const decision = evaluateFormalScreenerSnapshot(value as unknown as FormalScreenerSnapshot)
  details.push(...decision.reasons)
  if (!normalizeConfirmedScreenerArchive(value)) {
    details.push('未通过正式选股归档结构/质量校验')
  }
  return Array.from(new Set(details))
}

export function auditScreenerArchive(
  value: Record<string, unknown> | null,
  filename: string,
  tradeDate: string,
): DataQualityAuditCheck {
  const ref = parseScreenerArchiveName(filename)
  if (!ref) {
    return { id: 'screener-formal-archive', status: 'block', details: ['文件名不是 YYYY-MM-DD.json'] }
  }
  if (!value) {
    return {
      id: 'screener-formal-archive',
      status: 'block',
      asof: ref.date,
      details: ['最新选股归档无法解析'],
    }
  }

  const decision = evaluateFormalScreenerSnapshot(value as unknown as FormalScreenerSnapshot)
  const details = decision.allowed ? ['最新归档满足盘后正式快照契约'] : screenerRejectionDetails(value)
  const ageDays = daysSince(ref.date, tradeDate)
  const stale = ageDays != null && ageDays > 3
  if (stale) details.push(`正式快照距当前上海交易日 ${ageDays} 个自然日`)
  return {
    id: 'screener-formal-archive',
    status: decision.allowed ? (stale ? 'warn' : 'pass') : 'block',
    asof: ref.date,
    observedAt: typeof value.scannedAt === 'string' ? value.scannedAt : null,
    details: Array.from(new Set(details)),
    metrics: {
      ageDays,
      marketDataAsOf: typeof value.marketDataAsOf === 'string' ? value.marketDataAsOf : null,
      marketDataCoverage: typeof value.marketDataCoverage === 'number' ? value.marketDataCoverage : null,
    },
  }
}

function datedScreenerFiles(root: string): string[] {
  try {
    return readdirSync(root).filter((name) => parseScreenerArchiveName(name) != null)
  } catch {
    return []
  }
}

function sortedScreenerFiles(root: string): string[] {
  return datedScreenerFiles(root).sort((a, b) => {
    const ad = parseScreenerArchiveName(a)?.date ?? ''
    const bd = parseScreenerArchiveName(b)?.date ?? ''
    return bd.localeCompare(ad)
  })
}

function auditScreenerRoot(root: string, tradeDate: string): DataQualityAuditCheck {
  const files = sortedScreenerFiles(root)
  if (!files.length) {
    return { id: 'screener-formal-archive', status: 'block', details: ['没有找到日期选股归档'] }
  }
  const latest = files[0]
  const latestCheck = auditScreenerArchive(readJson(join(root, latest)), latest, tradeDate)

  // Report the last strict formal snapshot separately in the metrics. This is
  // useful when the newest file is malformed: fallback may still exist, but
  // the newest attempted archive remains an actionable integrity failure.
  const lastFormal = files
    .map((filename): ParsedArchive | null => {
      const ref = parseScreenerArchiveName(filename)
      const value = readJson(join(root, filename))
      if (!ref || !value || !evaluateFormalScreenerSnapshot(value as unknown as FormalScreenerSnapshot).allowed) return null
      return { filename, asof: ref.date, value }
    })
    .find((item): item is ParsedArchive => item != null)

  return {
    ...latestCheck,
    details: lastFormal && latestCheck.status === 'block'
      ? [...latestCheck.details, `最近一次可用正式快照为 ${lastFormal.asof}`]
      : latestCheck.details,
    metrics: {
      ...latestCheck.metrics,
      datedArchiveCount: files.length,
      lastFormalAsOf: lastFormal?.asof ?? null,
    },
  }
}

interface LadderArchiveCandidate extends ParsedArchive {
  date: string
  coreValid: boolean
  formalValid: boolean
}

function listLadderCandidates(root: string): LadderArchiveCandidate[] {
  const candidates: LadderArchiveCandidate[] = []
  let years: string[]
  try {
    years = readdirSync(root)
  } catch {
    return candidates
  }
  for (const year of years.filter((value) => /^\d{4}$/.test(value))) {
    const yearRoot = join(root, year)
    let months: string[]
    try { months = readdirSync(yearRoot) } catch { continue }
    for (const month of months.filter((value) => /^\d{2}$/.test(value))) {
      const monthRoot = join(yearRoot, month)
      let days: string[]
      try { days = readdirSync(monthRoot) } catch { continue }
      for (const day of days.filter((value) => /^\d{2}$/.test(value))) {
        const date = `${year}-${month}-${day}`
        const dayRoot = join(monthRoot, day)
        let files: string[]
        try { files = readdirSync(dayRoot) } catch { continue }
        for (const filename of files.filter((value) => /^analysis-limit-ladder-v\d+(?:-r\d+)?\.json$/i.test(value))) {
          const value = readJson(join(dayRoot, filename))
          if (!value) {
            candidates.push({ filename, asof: date, date, value: {}, coreValid: false, formalValid: false })
            continue
          }
          const coreValid = validSettlementArchive(value, date, 'ladder')
          const quality = object(value.quality)
          const formalValid = coreValid && value.archiveStage === 'enriched' && value.formalSignalEligible === true &&
            quality.degraded === false && quality.fundFlowComplete === true && !!quality.providerAt
          candidates.push({ filename, asof: date, date, value, coreValid, formalValid })
        }
      }
    }
  }
  return candidates.sort((a, b) => b.date.localeCompare(a.date) || b.filename.localeCompare(a.filename))
}

export function auditLadderArchive(
  value: Record<string, unknown> | null,
  filename: string,
  date: string,
): DataQualityAuditCheck {
  if (!value) {
    return { id: 'ladder-core-archive', status: 'block', asof: date, details: [`${filename} 无法解析`] }
  }
  const coreValid = validSettlementArchive(value, date, 'ladder')
  const quality = object(value.quality)
  const formalValid = coreValid && value.archiveStage === 'enriched' && value.formalSignalEligible === true &&
    quality.degraded === false && quality.fundFlowComplete === true && !!quality.providerAt
  if (formalValid) {
    return { id: 'ladder-formal-signal', status: 'pass', asof: date, details: ['最新连板归档满足正式信号契约'] }
  }
  if (coreValid) {
    return {
      id: 'ladder-formal-signal',
      status: 'warn',
      asof: date,
      details: ['最新连板归档只有核心收盘事实，尚未达到正式信号层', ...(quality.providerAt ? [] : ['缺少可验证 providerAt'])],
    }
  }
  return {
    id: 'ladder-core-archive',
    status: 'block',
    asof: date,
    details: ['最新连板归档未通过核心收盘事实契约'],
  }
}

function auditLadderRoot(root: string): DataQualityAuditCheck[] {
  const candidates = listLadderCandidates(root)
  if (!candidates.length) {
    return [
      { id: 'ladder-core-archive', status: 'block', details: ['没有找到连板 analysis 归档'] },
      { id: 'ladder-formal-signal', status: 'warn', details: ['没有可检查的连板正式信号归档'] },
    ]
  }
  const latest = candidates[0]
  const latestCheck = auditLadderArchive(latest.value, latest.filename, latest.date)
  const lastCore = candidates.find((candidate) => candidate.coreValid)
  const lastFormal = candidates.find((candidate) => candidate.formalValid)
  const checks: DataQualityAuditCheck[] = [latestCheck]
  if (latestCheck.id === 'ladder-formal-signal') {
    checks.push({
      id: 'ladder-core-archive',
      status: latest.coreValid ? 'pass' : 'block',
      asof: latest.date,
      details: latest.coreValid ? ['最新连板归档满足核心收盘事实契约'] : ['最新连板归档未通过核心收盘事实契约'],
    })
  }
  if (!lastFormal) {
    checks.push({
      id: 'ladder-formal-signal-history',
      status: 'warn',
      details: [`最近核心连板归档为 ${lastCore?.date ?? '未知'}，没有找到 enriched 正式信号归档`],
      metrics: { archiveCount: candidates.length },
    })
  }
  return checks
}

async function auditDatabase(
  getReady: () => boolean,
  getLatest: typeof getLatestScreenerSnapshot,
  getRevisions: typeof getScreenerSnapshotRevisions,
): Promise<DataQualityAuditCheck> {
  if (!getReady()) {
    return { id: 'screener-database-projection', status: 'warn', details: ['PostgreSQL 未初始化，当前只依赖磁盘正式归档'] }
  }
  try {
    const latest = await getLatest()
    if (!latest) {
      return { id: 'screener-database-projection', status: 'warn', details: ['数据库已连接但没有选股正式快照'] }
    }
    const value = object(JSON.parse(latest.result_json))
    const decision = evaluateFormalScreenerSnapshot(value as unknown as FormalScreenerSnapshot)
    let revisionCount: number | null = null
    try {
      revisionCount = (await getRevisions(latest.asof, 100)).length
    } catch {
      // A pre-migration database may have the projection but no revision table.
    }
    return {
      id: 'screener-database-projection',
      status: decision.allowed && revisionCount != null ? 'pass' : decision.allowed ? 'warn' : 'block',
      asof: latest.asof,
      observedAt: latest.created_at,
      details: decision.allowed
        ? (revisionCount != null ? ['数据库最新投影满足正式契约，且存在修订记录'] : ['数据库最新投影满足正式契约，但修订记录不可用'])
        : ['数据库最新投影未通过正式契约', ...decision.reasons],
      metrics: { revisionCount },
    }
  } catch (error) {
    return {
      id: 'screener-database-projection',
      status: 'warn',
      details: [`数据库只读审计失败：${error instanceof Error ? error.message : 'unknown error'}`],
    }
  }
}

export async function buildDataQualityAudit(options: AuditOptions = {}): Promise<DataQualityAuditReport> {
  const nowMs = options.nowMs ?? Date.now()
  const tradeDate = todayShanghai(nowMs)
  const checks = [
    auditScreenerRoot(options.screenerRoot ?? DEFAULT_SCREENER_ROOT, tradeDate),
    ...auditLadderRoot(options.ladderRoot ?? DEFAULT_LADDER_ROOT),
    await auditDatabase(
      options.dbReady ?? isDbReady,
      options.getLatestSnapshot ?? getLatestScreenerSnapshot,
      options.getRevisions ?? getScreenerSnapshotRevisions,
    ),
  ]
  return {
    generatedAt: new Date(nowMs).toISOString(),
    tradeDate,
    overall: worstStatus(checks),
    checks,
  }
}
