import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'

type JsonRecord = Record<string, unknown>

export interface PromotionRow {
  code: string
  name: string
  population: 'formal' | 'wait-open'
  promotionLane: string
  fromBoards: number
  resultStatus: 'promoted' | 'failed' | 'unresolved'
  promoted: boolean | null
  candidateRank: number | null
  promotionScore?: number | null
  marketCycle?: string | null
  sizeBucket?: string | null
  heightTier?: string | null
  repairState?: string | null
  tradable?: boolean | null
  /** Diagnostic mark only; never an executable trade result. */
  nextDayOpenToCloseMark?: number | null
  markPositive?: boolean | null
  realizedNetReturnPct?: number | null
  /** @deprecated use nextDayOpenToCloseMark. */
  openToClosePct?: number | null
  mfePct?: number | null
  maePct?: number | null
}

export interface PromotionInput {
  signalDate: string
  tradeDate: string
  ruleVersion: string
  sourcePath: string
  rows: PromotionRow[]
}

export interface PromotionMetric {
  total: number
  valid: number
  promoted: number
  failed: number
  unresolved: number
  promotionRate: number | null
  coverage: number
  ci95Low: number | null
  ci95High: number | null
}

export interface PromotionGroup extends PromotionMetric {
  key: string
  label: string
}

export interface TradeMetric {
  observations: number
  tradable: number
  wins: number
  losses: number
  winRate: number | null
  markPositiveRate: number | null
  averageOpenToClosePct: number | null
  averageNextDayOpenToCloseMark: number | null
  realizedNetReturnPct: number | null
  averageMfePct: number | null
  averageMaePct: number | null
}

export interface PromotionReview {
  generatedAt: string
  ruleVersions: string[]
  latestSignalDate: string | null
  latestTradeDate: string | null
  sample: {
    signalDays: number
    formalCandidates: number
    validFormalCandidates: number
    unresolvedFormalCandidates: number
  }
  overall: PromotionMetric
  waitOpen: PromotionMetric
  trade: TradeMetric
  byLane: Array<PromotionGroup & { fromBoards: number }>
  byScoreBucket: PromotionGroup[]
  byMarketCycle: PromotionGroup[]
  byHeightTier: PromotionGroup[]
  bySizeBucket: PromotionGroup[]
  calibration: {
    status: 'early' | 'developing' | 'calibration-ready'
    ready: boolean
    minimumSignalDays: number
    minimumFormalCandidates: number
    note: string
  }
  recommendations: string[]
  sources: Array<{
    signalDate: string
    tradeDate: string
    ruleVersion: string
    sourcePath: string
    formalCandidates: number
    formalPromotionRate: number | null
  }>
}

export interface PromotionReviewPaths {
  jsonPath: string
  markdownPath: string
}

const r2 = (value: number) => Math.round(value * 100) / 100

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function versionRank(value: string): number {
  const match = value.match(/v(\d+)/i)
  return match ? Number(match[1]) : 0
}

function newerInput(next: PromotionInput, current: PromotionInput): boolean {
  const nextRank = versionRank(next.ruleVersion)
  const currentRank = versionRank(current.ruleVersion)
  if (nextRank !== currentRank) return nextRank > currentRank
  return next.sourcePath > current.sourcePath
}

function normalizeRow(value: unknown): PromotionRow | null {
  const row = asRecord(value)
  if (!row) return null
  const resultStatus = asString(row.resultStatus) as PromotionRow['resultStatus']
  const status: PromotionRow['resultStatus'] =
    resultStatus === 'promoted' || resultStatus === 'failed' || resultStatus === 'unresolved'
      ? resultStatus
      : row.promoted === true
        ? 'promoted'
        : row.promoted === false
          ? 'failed'
          : 'unresolved'
  const fromBoards = asNumber(row.fromBoards)
  if (!asString(row.code) || fromBoards == null) return null
  const population = row.population === 'wait-open' ? 'wait-open' : 'formal'
  const candidateRank = asNumber(row.candidateRank)
  return {
    code: asString(row.code),
    name: asString(row.name, asString(row.code)),
    population,
    promotionLane: asString(row.promotionLane, `${fromBoards}进${fromBoards + 1}`),
    fromBoards,
    resultStatus: status,
    promoted: status === 'promoted' ? true : status === 'failed' ? false : null,
    candidateRank,
    promotionScore: asNumber(row.promotionScore),
    marketCycle: asString(row.marketCycle) || null,
    sizeBucket: asString(row.sizeBucket) || null,
    heightTier: asString(row.heightTier) || null,
    repairState: asString(row.repairState) || null,
    tradable: typeof row.tradable === 'boolean' ? row.tradable : null,
    nextDayOpenToCloseMark: asNumber(row.nextDayOpenToCloseMark) ?? asNumber(row.openToClosePct),
    markPositive: typeof row.markPositive === 'boolean'
      ? row.markPositive
      : asNumber(row.nextDayOpenToCloseMark) != null || asNumber(row.openToClosePct) != null
        ? (asNumber(row.nextDayOpenToCloseMark) ?? asNumber(row.openToClosePct) ?? 0) > 0
        : null,
    realizedNetReturnPct: asNumber(row.realizedNetReturnPct),
    openToClosePct: asNumber(row.openToClosePct),
    mfePct: asNumber(row.mfePct),
    maePct: asNumber(row.maePct),
  }
}

function collectFiles(root: string, predicate: (name: string) => boolean): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(path, predicate))
    else if (entry.isFile() && predicate(entry.name)) out.push(path)
  }
  return out
}

function readJson(path: string): JsonRecord | null {
  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

function scoreMapForAnalysis(path: string): Map<string, number | null> {
  const value = readJson(path)
  const stocks = Array.isArray(value?.stocks) ? value.stocks : []
  const result = new Map<string, number | null>()
  for (const item of stocks) {
    const stock = asRecord(item)
    if (!stock) continue
    const code = asString(stock.code)
    if (!code) continue
    result.set(code, asNumber(stock.promotionScore) ?? asNumber(stock.score))
  }
  return result
}

type ScoreMapEntry = { version: string; scores: Map<string, number | null> }

function toPromotionInput(path: string, scoreMaps: Map<string, ScoreMapEntry[]>): PromotionInput | null {
  const value = readJson(path)
  if (!value) return null
  const signalDate = asString(value.signalDate)
  const tradeDate = asString(value.tradeDate)
  if (!safeDate(signalDate) || !safeDate(tradeDate) || !Array.isArray(value.rows)) return null
  const ruleVersion = asString(value.ruleVersion, 'unknown')
  const scoreCandidates = scoreMaps.get(signalDate) ?? []
  const compatibleScores = scoreCandidates
    .filter((entry) => versionRank(entry.version) <= versionRank(ruleVersion))
    .sort((a, b) => versionRank(a.version) - versionRank(b.version))
  const scoreMap = (compatibleScores.at(-1) ?? scoreCandidates.at(-1))?.scores ?? new Map<string, number | null>()
  const rows = value.rows
    .map(normalizeRow)
    .filter((row): row is PromotionRow => !!row)
    .map((row) => ({ ...row, promotionScore: row.promotionScore ?? scoreMap.get(row.code) ?? null }))
  return rows.length
    ? { signalDate, tradeDate, ruleVersion, sourcePath: path, rows }
    : null
}

export function loadPromotionInputs(ladderRoot: string): PromotionInput[] {
  const outcomeFiles = collectFiles(ladderRoot, (name) => /^outcome-limit-ladder-v\d+\.json$/i.test(name))
  const analysisFiles = collectFiles(ladderRoot, (name) => /^analysis-limit-ladder-v\d+\.json$/i.test(name))
  const scoreMaps = new Map<string, ScoreMapEntry[]>()
  for (const path of analysisFiles) {
    const value = readJson(path)
    const asof = asString(value?.asof)
    const version = asString(value?.ruleVersion)
    if (safeDate(asof) && version) {
      scoreMaps.set(asof, [...(scoreMaps.get(asof) ?? []), { version, scores: scoreMapForAnalysis(path) }])
    }
  }
  const selected = new Map<string, PromotionInput>()
  for (const path of outcomeFiles) {
    const input = toPromotionInput(path, scoreMaps)
    if (!input) continue
    const current = selected.get(input.signalDate)
    if (!current || newerInput(input, current)) selected.set(input.signalDate, input)
  }
  return [...selected.values()].sort((a, b) => a.signalDate.localeCompare(b.signalDate))
}

function wilsonInterval(promoted: number, valid: number): [number | null, number | null] {
  if (valid <= 0) return [null, null]
  const z = 1.96
  const p = promoted / valid
  const denominator = 1 + (z * z) / valid
  const center = (p + (z * z) / (2 * valid)) / denominator
  const margin =
    (z / denominator) * Math.sqrt((p * (1 - p)) / valid + (z * z) / (4 * valid * valid))
  return [r2(Math.max(0, center - margin) * 100), r2(Math.min(1, center + margin) * 100)]
}

function metric(rows: PromotionRow[]): PromotionMetric {
  const validRows = rows.filter((row) => row.resultStatus !== 'unresolved')
  const promoted = validRows.filter((row) => row.resultStatus === 'promoted').length
  const [ci95Low, ci95High] = wilsonInterval(promoted, validRows.length)
  return {
    total: rows.length,
    valid: validRows.length,
    promoted,
    failed: validRows.length - promoted,
    unresolved: rows.length - validRows.length,
    promotionRate: validRows.length ? r2((promoted / validRows.length) * 100) : null,
    coverage: rows.length ? r2((validRows.length / rows.length) * 100) : 0,
    ci95Low,
    ci95High,
  }
}

function groupMetric(key: string, label: string, rows: PromotionRow[]): PromotionGroup {
  return { key, label, ...metric(rows) }
}

function groupsBy(
  rows: PromotionRow[],
  selector: (row: PromotionRow) => string | null | undefined,
): PromotionGroup[] {
  const grouped = new Map<string, PromotionRow[]>()
  for (const row of rows) {
    const key = selector(row) ?? 'unknown'
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => groupMetric(key, key, values))
}

function scoreBucket(score: number | null | undefined): string {
  if (score == null) return 'unknown'
  if (score < 65) return '<65'
  if (score < 75) return '65-74'
  if (score < 85) return '75-84'
  return '85+'
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value))
  return valid.length ? r2(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null
}

function tradeMetric(rows: PromotionRow[]): TradeMetric {
  const tradableRows = rows.filter((row) => row.tradable === true)
  const observations = tradableRows.filter((row) => row.nextDayOpenToCloseMark != null || row.openToClosePct != null)
  const markValues = observations.map((row) => row.nextDayOpenToCloseMark ?? row.openToClosePct ?? null)
  const wins = observations.filter((row) => row.markPositive ?? ((row.nextDayOpenToCloseMark ?? row.openToClosePct ?? 0) > 0)).length
  const netValues = tradableRows.map((row) => row.realizedNetReturnPct ?? null)
    .filter((value): value is number => value != null && Number.isFinite(value))
  return {
    observations: observations.length,
    tradable: tradableRows.length,
    wins,
    losses: observations.length - wins,
    winRate: observations.length ? r2((wins / observations.length) * 100) : null,
    markPositiveRate: observations.length ? r2((wins / observations.length) * 100) : null,
    averageOpenToClosePct: average(markValues),
    averageNextDayOpenToCloseMark: average(markValues),
    realizedNetReturnPct: netValues.length ? average(netValues) : null,
    averageMfePct: average(tradableRows.map((row) => row.mfePct ?? null)),
    averageMaePct: average(tradableRows.map((row) => row.maePct ?? null)),
  }
}


function buildRecommendations(
  overall: PromotionMetric,
  byLane: Array<PromotionGroup & { fromBoards: number }>,
  byScoreBucket: PromotionGroup[],
  signalDays: number,
  formalCandidates: number,
  trade: TradeMetric,
): string[] {
  const recommendations: string[] = []
  if (formalCandidates < 300 || signalDays < 120) {
    recommendations.push(
      `当前仅${signalDays}个信号日、${formalCandidates}个正式候选，未达到120个交易日/300个候选的校准门槛；只做记录，不自动改权重。`,
    )
  }
  const laneReady = byLane.filter((group) => group.valid >= 5 && group.promotionRate != null)
  if (laneReady.length >= 2) {
    const best = [...laneReady].sort((a, b) => (b.promotionRate ?? 0) - (a.promotionRate ?? 0))[0]
    const worst = [...laneReady].sort((a, b) => (a.promotionRate ?? 0) - (b.promotionRate ?? 0))[0]
    recommendations.push(`分层复核：${best.label}当前晋级率${best.promotionRate}%；${worst.label}当前晋级率${worst.promotionRate}%，优先检查其环境闸门和候选阈值。`)
  } else {
    recommendations.push('各晋级层有效样本尚不足5个，暂不据此调整1进2、2进3等层级权重。')
  }
  const scoreReady = byScoreBucket.filter((group) => group.valid >= 5 && group.promotionRate != null)
  if (scoreReady.length >= 2 && overall.promotionRate != null) {
    const best = [...scoreReady].sort((a, b) => (b.promotionRate ?? 0) - (a.promotionRate ?? 0))[0]
    const worst = [...scoreReady].sort((a, b) => (a.promotionRate ?? 0) - (b.promotionRate ?? 0))[0]
    recommendations.push(`分数校准：比较${best.label}与${worst.label}相对总体${overall.promotionRate}%，达到足够样本后再调整 promotionScore 门槛。`)
  } else {
    recommendations.push('分数段样本仍不足，先积累同一规则版本的正式候选结果，再做分数校准。')
  }
  if (trade.observations === 0) {
    recommendations.push('当前没有次日开收标记收益观测，暂不能计算标记正收益率。')
  } else {
    recommendations.push(`次日开收标记正收益率${trade.markPositiveRate}%，样本${trade.observations}；该指标不是可实现交易胜率。`)
  }
  return recommendations
}

export function buildPromotionReview(inputs: PromotionInput[]): PromotionReview {
  const formalRows = inputs.flatMap((input) => input.rows.filter((row) => row.population === 'formal'))
  const waitOpenRows = inputs.flatMap((input) => input.rows.filter((row) => row.population === 'wait-open'))
  const byLane = [...new Set(formalRows.map((row) => row.fromBoards))]
    .sort((a, b) => a - b)
    .map((fromBoards) => ({
      fromBoards,
      ...groupMetric(`${fromBoards}进${fromBoards + 1}`, `${fromBoards}进${fromBoards + 1}`, formalRows.filter((row) => row.fromBoards === fromBoards)),
    }))
  const byScoreBucket = groupsBy(formalRows, (row) => scoreBucket(row.promotionScore))
  const byMarketCycle = groupsBy(formalRows, (row) => row.marketCycle)
  const byHeightTier = groupsBy(formalRows, (row) => row.heightTier)
  const bySizeBucket = groupsBy(formalRows, (row) => row.sizeBucket)
  const minimumSignalDays = 120
  const minimumFormalCandidates = 300
  const ready = inputs.length >= minimumSignalDays && formalRows.length >= minimumFormalCandidates
  const status = ready
    ? 'calibration-ready'
    : inputs.length >= 20 && formalRows.length >= 50
      ? 'developing'
      : 'early'
  const overall = metric(formalRows)
  const trade = tradeMetric(formalRows)
  return {
    generatedAt: new Date().toISOString(),
    ruleVersions: [...new Set(inputs.map((input) => input.ruleVersion))].sort(),
    latestSignalDate: inputs.at(-1)?.signalDate ?? null,
    latestTradeDate: inputs.at(-1)?.tradeDate ?? null,
    sample: {
      signalDays: inputs.length,
      formalCandidates: formalRows.length,
      validFormalCandidates: overall.valid,
      unresolvedFormalCandidates: overall.unresolved,
    },
    overall,
    waitOpen: metric(waitOpenRows),
    trade,
    byLane,
    byScoreBucket,
    byMarketCycle,
    byHeightTier,
    bySizeBucket,
    calibration: {
      status,
      ready,
      minimumSignalDays,
      minimumFormalCandidates,
      note: ready
        ? '样本达到校准门槛，可进行受控的权重/阈值实验，但仍需保留留出期。'
        : '样本未达到长期校准门槛，只能做描述性复盘。',
    },
    recommendations: buildRecommendations(
      overall,
      byLane,
      byScoreBucket,
      inputs.length,
      formalRows.length,
      trade,
    ),
    sources: inputs.map((input) => ({
      signalDate: input.signalDate,
      tradeDate: input.tradeDate,
      ruleVersion: input.ruleVersion,
      sourcePath: input.sourcePath,
      formalCandidates: input.rows.filter((row) => row.population === 'formal').length,
      formalPromotionRate: metric(input.rows.filter((row) => row.population === 'formal')).promotionRate,
    })),
  }
}

function pct(value: number | null): string {
  return value == null ? '--' : `${value.toFixed(2)}%`
}

function renderMetricRow(label: string, value: PromotionMetric): string {
  return `| ${label} | ${value.total} | ${value.valid} | ${value.promoted} | ${value.failed} | ${value.unresolved} | ${pct(value.promotionRate)} | ${pct(value.coverage)} | ${pct(value.ci95Low)}–${pct(value.ci95High)} |`
}

export function renderPromotionReviewMarkdown(review: PromotionReview): string {
  const laneRows = review.byLane
    .map((group) => renderMetricRow(group.label, group))
    .join('\n')
  const scoreRows = review.byScoreBucket
    .map((group) => renderMetricRow(group.label, group))
    .join('\n')
  return `# 连板天梯候选晋级统计与复盘

> 更新：${review.generatedAt}；规则版本：${review.ruleVersions.join('、') || '--'}

## 一、总体结果

- 样本：${review.sample.signalDays} 个信号日，正式候选 ${review.sample.formalCandidates} 个。
- 正式候选晋级率：${pct(review.overall.promotionRate)}；有效覆盖率：${pct(review.overall.coverage)}；95% Wilson 区间：${pct(review.overall.ci95Low)}–${pct(review.overall.ci95High)}。
- 等待开板观察单单独统计：${pct(review.waitOpen.promotionRate)}，不混入正式候选总体。
  - 次日开收标记：样本${review.trade.observations}，正收益率${pct(review.trade.markPositiveRate)}，平均标记收益${pct(review.trade.averageNextDayOpenToCloseMark)}；可实现净收益另行记录，不能与标记收益混称。
- 校准状态：${review.calibration.status}。${review.calibration.note}

| 分组 | 总数 | 有效 | 晋级 | 失败 | 未解析 | 晋级率 | 覆盖率 | 95%区间 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${renderMetricRow('正式候选', review.overall)}
${renderMetricRow('等待开板', review.waitOpen)}

## 二、次日标记收益（非可实现交易结果）

- 定义：nextDayOpenToCloseMark = (nextDayClose - nextDayOpen) / nextDayOpen；它只描述次日价格路径，不证明开盘排队成交，也不代表 T+1 当日可卖。

| 有成交事实 | 收益观测 | 标记正收益 | 标记负收益 | 标记正收益率 | 平均开收标记 | 平均MFE | 平均MAE |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ${review.trade.tradable} | ${review.trade.observations} | ${review.trade.wins} | ${review.trade.losses} | ${pct(review.trade.markPositiveRate)} | ${pct(review.trade.averageNextDayOpenToCloseMark)} | ${pct(review.trade.averageMfePct)} | ${pct(review.trade.averageMaePct)} |

## 三、按晋级层

| 晋级层 | 总数 | 有效 | 晋级 | 失败 | 未解析 | 晋级率 | 覆盖率 | 95%区间 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${laneRows || '| -- | 0 | 0 | 0 | 0 | 0 | -- | 0.00% | -- |'}

## 四、按晋级分数段

| 分数段 | 总数 | 有效 | 晋级 | 失败 | 未解析 | 晋级率 | 覆盖率 | 95%区间 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${scoreRows || '| -- | 0 | 0 | 0 | 0 | 0 | -- | 0.00% | -- |'}

## 五、复盘动作

${review.recommendations.map((item) => `- ${item}`).join('\n')}

## 六、数据口径

- 正式候选：天梯 population=formal，只统计次日是否达到目标连板数。
- 晋级率：晋级 ÷ 有效结果；未解析结果不进入分母，但计入覆盖率。
- 同一信号日存在多个规则版本时，只保留最高规则版本，避免重复计数。
- 本报告用于研究和受控实验，不直接修改战法参数，也不构成交易建议。
`
}

export function writePromotionReview(
  ladderRoot: string,
  review: PromotionReview,
): PromotionReviewPaths {
  mkdirSync(ladderRoot, { recursive: true })
  const jsonPath = join(ladderRoot, 'promotion-review.json')
  const markdownPath = join(ladderRoot, 'promotion-review.md')
  const jsonTemp = `${jsonPath}.tmp`
  const markdownTemp = `${markdownPath}.tmp`
  writeFileSync(jsonTemp, JSON.stringify(review, null, 2), 'utf8')
  writeFileSync(markdownTemp, renderPromotionReviewMarkdown(review), 'utf8')
  renameSync(jsonTemp, jsonPath)
  renameSync(markdownTemp, markdownPath)
  return { jsonPath, markdownPath }
}

export function readPromotionReview(ladderRoot: string): PromotionReview | null {
  const path = join(ladderRoot, 'promotion-review.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PromotionReview
  } catch {
    return null
  }
}

