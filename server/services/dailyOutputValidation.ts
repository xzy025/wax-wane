import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { evaluateFormalScreenerSnapshot, type FormalScreenerSnapshot } from '../market-data/snapshotPolicy'
import { isScreenerResult, normalizeConfirmedScreenerArchive } from './screenerArchive'
import type { ResearchRun } from '../../shared/researchContract'

const SCREENER_ARRAYS = [
  'breakout', 'trigger', 'watch', 'pullback', 'highdiv', 'volbreak', 'fundres',
  'bhold', 'bholdWatch', 'trendnew', 'trendwatch', 'accum', 'bigbreak',
  'bigbreakWatch', 'huishou', 'yuncong',
] as const

export interface DailyFileCheck {
  file: string
  ok: boolean
  reasons: string[]
}

export interface ScreenerOutputCheck extends DailyFileCheck {
  tabCounts: Record<string, number>
}

export interface DailyOutputValidation {
  target: string
  ok: boolean
  screener: ScreenerOutputCheck
  files: DailyFileCheck[]
  auxiliary: DailyFileCheck
  ladder: DailyFileCheck & { archiveStage?: string; formalSignalEligible?: boolean }
  huishou: DailyFileCheck & { runId?: string; candidateStocks?: number; notComparable?: number }
}

function readJson(file: string): unknown | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as unknown } catch { return null }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function checkAsof(file: string, target: string): DailyFileCheck {
  if (!existsSync(file)) return { file, ok: false, reasons: ['文件不存在'] }
  const value = asObject(readJson(file))
  if (!value) return { file, ok: false, reasons: ['JSON 缺失或损坏'] }
  const reasons = value.asof === target ? [] : [`asof=${String(value.asof ?? '缺失')} 与目标日 ${target} 不一致`]
  return { file, ok: reasons.length === 0, reasons }
}

function screenerCheck(file: string, target: string): ScreenerOutputCheck {
  const tabCounts: Record<string, number> = {}
  if (!existsSync(file)) return { file, ok: false, reasons: ['正式选股归档不存在'], tabCounts }
  const raw = readJson(file)
  const value = asObject(raw)
  if (!value || !isScreenerResult(raw)) return { file, ok: false, reasons: ['正式选股归档 JSON 结构损坏'], tabCounts }
  for (const key of SCREENER_ARRAYS) tabCounts[key] = Array.isArray(value[key]) ? value[key].length : -1
  const formal = evaluateFormalScreenerSnapshot(value as unknown as FormalScreenerSnapshot)
  const reasons = [...formal.reasons]
  if (!SCREENER_ARRAYS.every((key) => tabCounts[key] >= 0)) reasons.push('选股页面存在缺失的战法数组')
  if (normalizeConfirmedScreenerArchive(raw) == null) reasons.push('归档未通过正式选股读侧校验')
  if (value.asof !== target) reasons.push(`asof=${String(value.asof ?? '缺失')} 与目标日 ${target} 不一致`)
  return { file, ok: reasons.length === 0, reasons: [...new Set(reasons)], tabCounts }
}

function ladderCheck(root: string, target: string): DailyOutputValidation['ladder'] {
  const folder = join(root, 'docs', 'ladder', target.slice(0, 4), target.slice(5, 7), target.slice(8, 10))
  if (!existsSync(folder)) return { file: folder, ok: false, reasons: ['目标日连板归档目录不存在'] }
  const names = readdirSync(folder)
    .filter((name) => /^analysis-limit-ladder-v\d+(?:-r\d+)?\.json$/i.test(name))
    .sort()
    .reverse()
  for (const name of names) {
    const file = join(folder, name)
    const value = asObject(readJson(file))
    if (!value || value.asof !== target) continue
    const archiveStage = typeof value.archiveStage === 'string' ? value.archiveStage : undefined
    const formalSignalEligible = typeof value.formalSignalEligible === 'boolean' ? value.formalSignalEligible : undefined
    const reasons: string[] = []
    if (value.archived !== true) reasons.push('归档未标记 archived=true')
    if (archiveStage !== 'core-settled' && archiveStage !== 'enriched') reasons.push(`归档阶段无效：${archiveStage ?? '缺失'}`)
    if (archiveStage === 'core-settled' && formalSignalEligible !== false) reasons.push('core-settled 未明确标记 formalSignalEligible=false')
    return { file, ok: reasons.length === 0, reasons, archiveStage, formalSignalEligible }
  }
  return { file: folder, ok: false, reasons: ['没有找到目标日连板分析归档'] }
}

function auxiliaryCheck(file: string, target: string): DailyFileCheck {
  if (!existsSync(file)) return { file, ok: false, reasons: ['选股辅助页刷新报告不存在'] }
  const value = asObject(readJson(file))
  if (!value || value.target !== target || typeof value.endpoints !== 'object' || value.endpoints === null) {
    return { file, ok: false, reasons: ['选股辅助页刷新报告缺失或日期不一致'] }
  }
  const endpoints = value.endpoints as Record<string, unknown>
  const reasons = Object.entries(endpoints).flatMap(([name, endpoint]) => asObject(endpoint)?.ok === true ? [] : [`辅助页 ${name} 未验证通过`])
  return { file, ok: reasons.length === 0, reasons }
}

function huishouCheck(root: string, target: string): DailyOutputValidation['huishou'] {
  const folder = join(root, 'docs', 'research', 'huishou-screen')
  if (!existsSync(folder)) return { file: folder, ok: false, reasons: ['挥手研究归档目录不存在'] }
  const runs = readdirSync(folder).filter((name) => /^[a-f0-9-]{36}$/.test(name)).flatMap((id) => {
    const file = join(folder, id, 'run.json')
    const value = readJson(file) as ResearchRun | null
    return value?.target === target ? [{ file, value }] : []
  }).sort((a, b) => b.value.updatedAt.localeCompare(a.value.updatedAt))
  const completed = runs.find((item) => item.value.status === 'completed')
  if (!completed) return { file: join(folder, '<target-run>/run.json'), ok: false, reasons: ['目标日没有已完成的挥手研究任务'] }
  const run = completed.value
  const reasons: string[] = []
  if (run.researchOnly !== true) reasons.push('挥手研究任务未标记 researchOnly=true')
  if (run.eligibleAsTradeGate !== false) reasons.push('挥手研究任务错误地允许作为交易准入')
  if (run.processed < run.universeCount) reasons.push(`研究任务未扫完：${run.processed}/${run.universeCount}`)
  const reviewFile = join(root, 'docs', 'research', 'strategy-review-data', target, 'huishou-daily-review.json')
  const review = asObject(readJson(reviewFile))
  if (!review) reasons.push('挥手盘后复盘摘要不存在或损坏')
  else {
    if (review.target !== target) reasons.push('挥手盘后复盘摘要目标日不一致')
    if (review.runId !== run.runId) reasons.push('挥手盘后复盘摘要 runId 不一致')
    if (review.status !== 'completed') reasons.push('挥手盘后复盘摘要未标记 completed')
    if (review.researchOnly !== true || review.eligibleAsTradeGate !== false) reasons.push('挥手盘后复盘摘要交易资格标记错误')
  }
  return { file: completed.file, ok: reasons.length === 0, reasons, runId: run.runId, candidateStocks: run.candidateStocks, notComparable: run.notComparable }
}

export function validateDailyOutputs(root: string, target: string, options: { requireHuishou?: boolean; requireAuxiliary?: boolean } = {}): DailyOutputValidation {
  const screener = screenerCheck(join(root, 'docs', 'screener', `${target}.json`), target)
  const files = [
    checkAsof(join(root, 'docs', 'screener', `structure-${target}.json`), target),
    checkAsof(join(root, 'docs', 'screener', `tempo-${target}.json`), target),
    checkAsof(join(root, 'docs', 'screener', `review-${target}.json`), target),
    checkAsof(join(root, 'docs', 'screener', `forward-${target}.json`), target),
  ]
  const auxiliary = auxiliaryCheck(join(root, 'docs', 'screener', `auxiliary-${target}.json`), target)
  const ladder = ladderCheck(root, target)
  const huishou = huishouCheck(root, target)
  const requiredChecks = [screener, ...files, ladder, ...(options.requireHuishou ? [huishou] : []), ...(options.requireAuxiliary ? [auxiliary] : [])]
  return { target, ok: requiredChecks.every((check) => check.ok), screener, files, auxiliary, ladder, huishou }
}
