import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { fetchWithProxy, getProtocol } from '../lib/llm'
import type {
  AuctionMarketStock,
  AuctionMarketStyle,
  AuctionThemeDirection,
  LadderStockAnalysis,
  LimitLadderAnalysis,
  LimitLadderNextDay,
  NextDayCandidateConfirmation,
} from './limitLadder'
import type { MarketRepairState } from './ladderMarketGate'
import {
  fetchOvernightContext,
  type NewsCatalyst,
  type OvernightContext,
  type AuctionStockLike,
} from './overnightCatalysts'

// Keep the archive key stable: v6 readers are already deployed and the new
// optional overnight fields are backward-compatible with that schema.
export const AUCTION_BRIEF_VERSION = 'limit-ladder-v6'
const COMPATIBLE_AUCTION_BRIEF_VERSIONS = [
  AUCTION_BRIEF_VERSION,
  'limit-ladder-v5',
  'limit-ladder-v4',
  'limit-ladder-v3',
] as const
const MAX_MESSAGE_LENGTH = 3_500
const DEFAULT_AI_TIMEOUT_MS = 4_000
const SERVERCHAN_TIMEOUT_MS = 8_000
const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_LADDER_ROOT = join(__dirname, '..', '..', 'docs', 'ladder')

export type AuctionBriefPhase = 'auction-final' | 'open-confirmation'
export type AuctionBriefVerdict = 'accept' | 'observe' | 'reject'
export type AuctionBriefPopulation = 'formal' | 'wait-open' | 'observation'
export type AuctionBriefGenerationMode = 'rules' | 'rules-ai-polished'
export type NotificationDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'disabled'
  | 'not-configured'

export interface AuctionBriefCandidate {
  code: string
  name: string
  population: AuctionBriefPopulation
  boardType: LadderStockAnalysis['boardType']
  promotionLane: string
  theme: string
  verdict: AuctionBriefVerdict
  score: number | null
  reasons: string[]
}

export interface AuctionBrief {
  id: string
  signalDate: string
  tradeDate: string
  generatedAt: string
  ruleVersion: string
  phase: AuctionBriefPhase
  title: string
  summary: string
  deterministicSummary: string
  generationMode: AuctionBriefGenerationMode
  strengthScore: number | null
  strengthLabel: string
  confidence: number
  degraded: boolean
  marketGateState?: 'normal' | 'cautious' | 'restricted' | 'frozen' | null
  marketRiskScore?: number | null
  marketRepairState?: MarketRepairState | null
  repairConfidence?: number | null
  marketStyle: AuctionMarketStyle | null
  primaryDirection: string
  topAmount: AuctionMarketStock[]
  themes: AuctionThemeDirection[]
  candidates: AuctionBriefCandidate[]
  observations: AuctionBriefCandidate[]
  coverage: {
    auctionPct: number
    confirmationPct: number | null
    sourceCount: number
  }
  warnings: string[]
  renderedText: string
  overnightContext?: OvernightContext
  newsCatalysts?: NewsCatalyst[]
  expectedDirections?: string[]
  auctionConfirmedDirections?: string[]
  openConfirmedDirections?: string[]
}

export interface AuctionBriefArchive {
  signalDate: string
  tradeDate: string
  ruleVersion: string
  updatedAt: string
  briefs: AuctionBrief[]
}

export interface NotificationProviderResult {
  ok: boolean
  statusCode: number | null
  providerCode: number | string | null
  message: string
  pushId: string | null
}

export interface NotificationDeliveryRecord {
  idempotencyKey: string
  signalDate: string
  tradeDate: string
  phase: AuctionBriefPhase | 'test'
  provider: 'serverchan'
  status: NotificationDeliveryStatus
  attempts: number
  createdAt: string
  updatedAt: string
  sentAt: string | null
  responseTimeMs: number | null
  statusCode: number | null
  providerCode: number | string | null
  providerMessage: string
  pushId: string | null
  error: string
}

export interface NotificationDeliveryArchive {
  signalDate: string
  tradeDate: string
  ruleVersion: string
  updatedAt: string
  records: NotificationDeliveryRecord[]
}

export interface AuctionBriefState {
  signalDate: string
  tradeDate: string
  ruleVersion: string
  notification: {
    provider: 'serverchan'
    enabled: boolean
    configured: boolean
  }
  briefs: AuctionBrief[]
  deliveries: NotificationDeliveryRecord[]
}

export interface NotificationMessage {
  title: string
  body: string
}

export interface NotificationProvider {
  readonly name: 'serverchan'
  readonly configured: boolean
  send(message: NotificationMessage): Promise<NotificationProviderResult>
}

interface DispatchOptions {
  provider?: NotificationProvider
  polish?: (brief: AuctionBrief) => Promise<AuctionBrief>
  maxAttempts?: number
  retryDelaysMs?: number[]
  sleep?: (ms: number) => Promise<void>
}

function safeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function archiveDir(signalDate: string): string {
  if (!safeDate(signalDate)) throw new Error('signalDate 必须是 YYYY-MM-DD')
  return join(
    process.env.LADDER_ARCHIVE_ROOT?.trim() || DEFAULT_LADDER_ROOT,
    signalDate,
  )
}

function briefArchivePath(
  signalDate: string,
  version = AUCTION_BRIEF_VERSION,
): string {
  return join(archiveDir(signalDate), `auction-brief-${version}.json`)
}

function deliveryArchivePath(
  signalDate: string,
  version = AUCTION_BRIEF_VERSION,
): string {
  return join(
    archiveDir(signalDate),
    `notification-delivery-${version}.json`,
  )
}

function existingVersionedPath(
  signalDate: string,
  pathFor: (signalDate: string, version: string) => string,
): string {
  return (
    COMPATIBLE_AUCTION_BRIEF_VERSIONS.map((version) =>
      pathFor(signalDate, version),
    ).find(existsSync) ?? pathFor(signalDate, AUCTION_BRIEF_VERSION)
  )
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(temp, path)
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value))
}

function r2(value: number): number {
  return Math.round(value * 100) / 100
}

function mean(values: Array<number | null | undefined>): number | null {
  const available = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
  return available.length > 0
    ? available.reduce((sum, value) => sum + value, 0) / available.length
    : null
}

function yi(value: number): string {
  return value > 0 ? `${(value / 100_000_000).toFixed(2)}亿` : '--'
}

function score(value: number | null | undefined): string {
  return value == null ? '--' : value.toFixed(1)
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 12))}\n\n（内容已截断）`
}

function sanitizeNotificationText(value: string): string {
  let sanitized = value.replace(
    /https:\/\/sctapi\.ftqq\.com\/[^\s/]+\.send/gi,
    'https://sctapi.ftqq.com/[redacted].send',
  )
  const sendKey = process.env.SERVERCHAN_SEND_KEY?.trim()
  if (sendKey) sanitized = sanitized.split(sendKey).join('[redacted]')
  return sanitized.replace(/\bSCT[A-Za-z0-9_-]{6,}\b/g, '[redacted]')
}

function phaseLabel(phase: AuctionBriefPhase): string {
  return phase === 'auction-final' ? '09:28竞价终局' : '09:35承接确认'
}

function verdictLabel(verdict: AuctionBriefVerdict): string {
  return {
    accept: '接受',
    observe: '观察',
    reject: '拒绝',
  }[verdict]
}

function themeStateLabel(state: AuctionThemeDirection['state']): string {
  return {
    leading: '引领',
    resonant: '共振',
    'isolated-one-price': '孤立一字',
    weak: '偏弱',
    unavailable: '缺数据',
  }[state]
}

function notificationEnabled(): boolean {
  return process.env.AUCTION_PUSH_ENABLED === 'true'
}

function serverChanConfigured(): boolean {
  return !!process.env.SERVERCHAN_SEND_KEY?.trim()
}

function candidateVerdict(
  phase: AuctionBriefPhase,
  confirmation?: NextDayCandidateConfirmation,
): AuctionBriefVerdict {
  if (
    !confirmation ||
    confirmation.inaccessible ||
    confirmation.state === 'blocked' ||
    confirmation.state === 'rejected'
  ) {
    return 'reject'
  }
  if (phase === 'auction-final') {
    return confirmation.state === 'auction-qualified' ? 'accept' : 'observe'
  }
  return confirmation.state === 'confirmed' ? 'accept' : 'observe'
}

function candidateReasons(
  phase: AuctionBriefPhase,
  stock: LadderStockAnalysis,
  confirmation?: NextDayCandidateConfirmation,
): string[] {
  if (!confirmation) return ['缺少次日确认记录']
  const reasons: string[] = []
  if (phase === 'auction-final') {
    if (confirmation.auctionScore != null) {
      reasons.push(`竞价分${confirmation.auctionScore.toFixed(1)}`)
    }
    if (confirmation.openGapPct != null) {
      reasons.push(`竞价涨幅${confirmation.openGapPct.toFixed(2)}%`)
    }
    if (confirmation.processScore != null) {
      reasons.push(`过程质量${confirmation.processScore.toFixed(1)}`)
    }
  } else {
    if (confirmation.decisionScore != null) {
      reasons.push(`决策分${confirmation.decisionScore.toFixed(1)}`)
    } else if (confirmation.liveScore != null) {
      reasons.push(`实时分${confirmation.liveScore.toFixed(1)}`)
    }
    if (confirmation.openScore != null) {
      reasons.push(`承接分${confirmation.openScore.toFixed(1)}`)
    }
    if (confirmation.currentPrice != null && confirmation.vwap != null) {
      reasons.push(confirmation.currentPrice >= confirmation.vwap ? '价格在VWAP上方' : '价格弱于VWAP')
    }
  }
  reasons.push(...(confirmation.gateReasons ?? []).slice(0, 2))
  if (stock.onePrice) reasons.push('前日一字，等待可达性验证')
  reasons.push(...confirmation.warnings.slice(0, 2))
  return unique(reasons).slice(0, 4)
}

function mapCandidate(
  phase: AuctionBriefPhase,
  stock: LadderStockAnalysis,
  population: AuctionBriefPopulation,
  confirmation?: NextDayCandidateConfirmation,
): AuctionBriefCandidate {
  const verdict =
    population === 'observation'
      ? 'observe'
      : population === 'wait-open' && confirmation?.state !== 'rejected'
        ? 'observe'
        : candidateVerdict(phase, confirmation)
  return {
    code: stock.code,
    name: stock.name,
    population,
    boardType: stock.boardType,
    promotionLane:
      stock.promotionLane ?? `${stock.consecutiveDays}进${stock.consecutiveDays + 1}`,
    theme: stock.primaryTheme,
    verdict,
    score:
      phase === 'open-confirmation'
        ? (confirmation?.decisionScore ??
          confirmation?.liveScore ??
          stock.baseScore ??
          stock.score)
        : (confirmation?.auctionScore ?? stock.baseScore ?? stock.score),
    reasons:
      population === 'observation'
        ? ['20cm/北交所单列观察，不进入主板接力候选']
        : candidateReasons(phase, stock, confirmation),
  }
}

function waitOpenRows(analysis: LimitLadderAnalysis): LadderStockAnalysis[] {
  return analysis.stocks
    .filter(
      (stock) =>
        stock.boardType === 'main' &&
        stock.state === 'waiting' &&
        stock.onePrice &&
        stock.consecutiveDays <= 3,
    )
    .sort((a, b) => (b.promotionScore ?? b.score) - (a.promotionScore ?? a.score))
    .slice(0, 3)
}

function observationRows(analysis: LimitLadderAnalysis): LadderStockAnalysis[] {
  return analysis.stocks
    .filter((stock) => stock.boardType !== 'main' && stock.state !== 'exclude')
    .sort((a, b) => (b.baseScore ?? b.score) - (a.baseScore ?? a.score))
    .slice(0, 3)
}

function primaryDirection(
  context: LimitLadderNextDay['auctionContext'],
  usableAuctionSnapshot: boolean,
): string {
  if (!usableAuctionSnapshot || !context) return '竞价方向不可判定'
  const leading = context.themes.find((theme) => theme.state === 'leading')
  if (leading) return `${leading.theme}题材引领`
  const resonant = context.themes.find((theme) => theme.state === 'resonant')
  if (resonant) return `${resonant.theme}题材共振`
  if (context.marketStyle && context.marketStyle.style !== 'mixed') {
    return `${context.marketStyle.label}（仅市场风格证据）`
  }
  return '竞价方向分散'
}

function strengthLabel(value: number | null): string {
  if (value == null) return '不可判定'
  if (value >= 75) return '强'
  if (value >= 60) return '偏强'
  if (value >= 45) return '分化'
  return '弱'
}

function deterministicSummary(args: {
  phase: AuctionBriefPhase
  degraded: boolean
  direction: string
  strength: string
  marketGateState?: AuctionBrief['marketGateState']
  marketRepairState?: AuctionBrief['marketRepairState']
  candidates: AuctionBriefCandidate[]
}): string {
  if (args.degraded && args.phase === 'auction-final') {
    return '9:25冻结快照缺失，无法还原竞价终局；本次仅发送数据缺失告警，不使用开盘累计成交额替代竞价额。'
  }
  const accepted = args.candidates.filter((row) => row.verdict === 'accept').length
  const observed = args.candidates.filter((row) => row.verdict === 'observe').length
  const rejected = args.candidates.filter((row) => row.verdict === 'reject').length
  const gate =
    args.marketGateState === 'frozen'
      ? '大盘闸门冻结'
      : args.marketGateState === 'restricted'
        ? '大盘闸门限制'
        : args.marketGateState === 'cautious'
          ? '大盘闸门谨慎'
          : '大盘闸门正常'
  const repair =
    args.marketRepairState === 'weight-led-repair'
      ? '权重抽水式修复'
      : args.marketRepairState === 'broad-repair'
        ? '普涨修复'
        : args.marketRepairState === 'small-cap-repair'
          ? '小票修复'
          : args.marketRepairState === 'risk-continuation'
            ? '风险延续'
            : args.marketRepairState === 'mixed'
              ? '修复结构混合'
              : '修复结构待确认'
  return args.phase === 'auction-final'
    ? `${gate}；${repair}；竞价整体${args.strength}，${args.direction}。正式候选${accepted}只入围、${observed}只观察、${rejected}只拒绝。`
    : `${gate}；沿用9:25${repair}；9:35承接整体${args.strength}，${args.direction}。正式候选${accepted}只确认、${observed}只继续观察、${rejected}只拒绝。`
}

export function renderAuctionBrief(brief: AuctionBrief): string {
  const lines: string[] = [
    `**${brief.summary}**`,
    '',
    `- 强度：${brief.strengthLabel}（${score(brief.strengthScore)}）`,
    `- 置信度：${brief.confidence.toFixed(0)}%`,
    `- 方向：${brief.primaryDirection}`,
  ]
  if (brief.marketGateState) {
    lines.push(
      `- 大盘闸门：${brief.marketGateState}（风险${score(brief.marketRiskScore)}）`,
    )
  }
  if (brief.marketRepairState) {
    lines.push(
      `- 修复结构：${brief.marketRepairState}（置信度${score(brief.repairConfidence)}%）`,
    )
  }
  if (brief.marketStyle) {
    lines.push(
      `- 风格：${brief.marketStyle.label}；前五集中度${score(brief.marketStyle.topFiveConcentrationPct)}%`,
    )
  }
  if (brief.topAmount.length > 0) {
    lines.push(
      '',
      '### 竞价成交额前列',
      ...brief.topAmount
        .slice(0, 5)
        .map(
          (row, index) =>
            `${index + 1}. ${row.name}（${row.industry || row.code}） ${yi(row.amount)}`,
        ),
    )
  }
  if (brief.themes.length > 0) {
    lines.push(
      '',
      '### 题材方向',
      ...brief.themes
        .slice(0, 5)
        .map(
          (theme) =>
            `- ${theme.theme}：${themeStateLabel(theme.state)} ${score(theme.score)}；核心${theme.coreName || '--'}，助攻${theme.assistantCount}只`,
        ),
    )
  }
  if (brief.candidates.length > 0) {
    lines.push(
      '',
      '### 主板接力池',
      ...brief.candidates.map(
        (row) =>
          `- [${verdictLabel(row.verdict)}] ${row.name} ${row.promotionLane} / ${row.theme}：${row.reasons.join('；')}`,
      ),
    )
  }
  if (brief.observations.length > 0) {
    lines.push(
      '',
      '### 单列观察',
      ...brief.observations.map(
        (row) => `- ${row.name}（${row.boardType}） ${row.theme}：${row.reasons.join('；')}`,
      ),
    )
  }
  if (brief.newsCatalysts && brief.newsCatalysts.length > 0) {
    lines.push('', '### 隔夜重要新闻与关联个股')
    for (const news of brief.newsCatalysts.slice(0, 5)) {
      lines.push(
        `- ${news.title}（${news.category}，${news.verification}，重要度${news.importanceScore}）`,
        `  影响路径：${news.impactPath}`,
      )
      for (const stock of news.relatedStocks.slice(0, 3)) {
        const market = stock.changePct == null ? '待竞价验证' : `${stock.changePct >= 0 ? '+' : ''}${stock.changePct.toFixed(2)}%`
        lines.push(
          `  - ${stock.name}（${stock.code}）${stock.relationType}：${stock.relationReason}；${stock.validationState} ${market}；风险：${stock.riskNote}`,
        )
      }
    }
    if (brief.expectedDirections && brief.expectedDirections.length > 0) {
      lines.push(`- 隔夜预期方向：${brief.expectedDirections.join('、')}`)
    }
    if (brief.auctionConfirmedDirections && brief.auctionConfirmedDirections.length > 0) {
      lines.push(`- 竞价确认方向：${brief.auctionConfirmedDirections.join('、')}`)
    }
    if (brief.openConfirmedDirections && brief.openConfirmedDirections.length > 0) {
      lines.push(`- 开盘主线确认：${brief.openConfirmedDirections.join('、')}`)
    }
  }
  if (brief.warnings.length > 0) {
    lines.push('', '### 数据提示', ...brief.warnings.slice(0, 6).map((warning) => `- ${warning}`))
  }
  lines.push('', '> 研究提醒，不构成交易或仓位建议。')
  return truncate(lines.join('\n'), MAX_MESSAGE_LENGTH)
}

export function buildAuctionBrief(args: {
  phase: AuctionBriefPhase
  analysis: LimitLadderAnalysis
  nextDay: LimitLadderNextDay
  generatedAt?: string
}): AuctionBrief {
  const generatedAt = args.generatedAt ?? new Date().toISOString()
  const hasFrozenAuction = args.nextDay.auctionSnapshotAvailable
  const context = hasFrozenAuction ? args.nextDay.auctionContext : null
  const confirmationMap = new Map(
    args.nextDay.candidates.map((candidate) => [candidate.code, candidate]),
  )
  const missedAuctionFinal =
    args.phase === 'auction-final' && !hasFrozenAuction
  const formalRows =
    args.analysis.nextDayCandidates ??
    args.analysis.stocks.filter((stock) => stock.state === 'candidate')
  const candidates = missedAuctionFinal
    ? []
    : [
        ...formalRows.map((stock) =>
          mapCandidate(args.phase, stock, 'formal', confirmationMap.get(stock.code)),
        ),
        ...waitOpenRows(args.analysis).map((stock) =>
          mapCandidate(args.phase, stock, 'wait-open', confirmationMap.get(stock.code)),
        ),
      ]
  const observations = missedAuctionFinal
    ? []
    : observationRows(args.analysis).map((stock) =>
        mapCandidate(args.phase, stock, 'observation', confirmationMap.get(stock.code)),
      )
  const confirmationCoverage =
    args.phase === 'open-confirmation'
      ? r2(
          (args.nextDay.candidates.filter(
            (candidate) =>
              candidate.tradeDate === args.nextDay.tradeDate &&
              !!candidate.quoteTime &&
              candidate.currentPrice != null,
          ).length /
            Math.max(args.nextDay.candidates.length, 1)) *
            100,
        )
      : null
  const auctionCoverage = context?.coverage ?? 0
  const degraded =
    !hasFrozenAuction ||
    !context ||
    context.lowConfidence ||
    (args.phase === 'open-confirmation' &&
      !args.nextDay.confirmationSnapshotAvailable)
  const candidateStrength = mean(
    args.nextDay.candidates.map((candidate) =>
      args.phase === 'open-confirmation'
        ? candidate.openScore
        : candidate.auctionScore,
    ),
  )
  const strengthScore = mean([
    context?.marketStyle?.score,
    mean((context?.themes ?? []).slice(0, 2).map((theme) => theme.score)),
    candidateStrength,
  ])
  const normalizedStrength = strengthScore == null ? null : r2(clamp(strengthScore))
  const direction = primaryDirection(args.nextDay.auctionContext, hasFrozenAuction)
  const label = strengthLabel(normalizedStrength)
  const confidenceBase =
    args.phase === 'open-confirmation'
      ? Math.min(auctionCoverage || 100, confirmationCoverage ?? 0)
      : auctionCoverage
  const confidence = r2(
    clamp(
      Math.min(confidenceBase, context?.marketStyle?.confidence ?? confidenceBase) *
        (context?.lowConfidence ? 0.75 : 1),
    ),
  )
  const warnings = unique([
    ...args.nextDay.warnings,
    ...(context?.warnings ?? []),
    ...(!hasFrozenAuction
      ? ['9:25冻结快照缺失，未使用9:35累计成交额替代竞价额']
      : []),
    ...(args.phase === 'open-confirmation' &&
    !args.nextDay.confirmationSnapshotAvailable
      ? ['9:35确认快照缺失，承接结论降级']
      : []),
  ])
  const base: AuctionBrief = {
    id: `${args.nextDay.tradeDate}:${args.phase}:${AUCTION_BRIEF_VERSION}`,
    signalDate: args.analysis.asof,
    tradeDate: args.nextDay.tradeDate,
    generatedAt,
    ruleVersion: AUCTION_BRIEF_VERSION,
    phase: args.phase,
    title: `${args.nextDay.tradeDate} ${phaseLabel(args.phase)}`,
    summary: '',
    deterministicSummary: '',
    generationMode: 'rules',
    strengthScore: normalizedStrength,
    strengthLabel: label,
    confidence,
    degraded,
    marketGateState: args.nextDay.marketGate?.state ?? null,
    marketRiskScore: args.nextDay.marketGate?.riskScore ?? null,
    marketRepairState:
      args.nextDay.marketGate?.repairContext?.state ?? null,
    repairConfidence:
      args.nextDay.marketGate?.repairContext?.confidence ?? null,
    marketStyle: context?.marketStyle ?? null,
    primaryDirection: direction,
    topAmount: context?.topAmount.slice(0, 5) ?? [],
    themes: context?.themes.slice(0, 5) ?? [],
    candidates,
    observations,
    coverage: {
      auctionPct: auctionCoverage,
      confirmationPct: confirmationCoverage,
      sourceCount: context?.sources.length ?? 0,
    },
    warnings,
    renderedText: '',
  }
  base.deterministicSummary = deterministicSummary({
    phase: args.phase,
    degraded,
    direction,
    strength: label,
    marketGateState: args.nextDay.marketGate?.state,
    marketRepairState:
      args.nextDay.marketGate?.repairContext?.state,
    candidates: candidates.filter((candidate) => candidate.population === 'formal'),
  })
  base.summary = base.deterministicSummary
  base.renderedText = renderAuctionBrief(base)
  return base
}

function overnightWindow(signalDate: string, tradeDate: string): { windowStart: string; windowEnd: string } {
  return {
    windowStart: `${signalDate}T15:00:00+08:00`,
    windowEnd: `${tradeDate}T09:15:00+08:00`,
  }
}

export async function enrichAuctionBriefWithOvernight(
  brief: AuctionBrief,
  args: { analysis: LimitLadderAnalysis; nextDay: LimitLadderNextDay; currentAnalysis?: LimitLadderAnalysis },
): Promise<AuctionBrief> {
  const quotes = new Map<string, AuctionStockLike>()
  const add = (row: Partial<AuctionStockLike> & { code: string; name: string }) => {
    const prev = quotes.get(row.code)
    quotes.set(row.code, { ...prev, ...row })
  }
  for (const row of args.nextDay.auctionContext?.topAmount ?? []) {
    add({ code: row.code, name: row.name, industry: row.industry, amount: row.amount, changePct: row.changePct, quoteTime: row.quoteTime })
  }
  for (const row of args.analysis.stocks) {
    add({ code: row.code, name: row.name, industry: row.primaryTheme, amount: row.amount, changePct: row.changePct, firstBoard: row.consecutiveDays === 1 })
  }
  for (const row of args.currentAnalysis?.stocks ?? []) {
    add({ code: row.code, name: row.name, industry: row.primaryTheme, amount: row.amount, changePct: row.changePct, firstBoard: row.consecutiveDays === 1 })
  }
  const window = overnightWindow(brief.signalDate, brief.tradeDate)
  const context = await fetchOvernightContext({ windowStart: window.windowStart, windowEnd: window.windowEnd, stocks: [...quotes.values()] })
  const confirmed = context.newsCatalysts
    .filter((news) => news.relatedStocks.some((stock) => stock.validationState === '强化'))
    .flatMap((news) => news.themes)
  context.auctionConfirmedDirections = brief.phase === 'auction-final' ? [...new Set(confirmed)] : context.auctionConfirmedDirections
  context.openConfirmedDirections = brief.phase === 'open-confirmation'
    ? [...new Set(confirmed.filter((theme) => context.newsCatalysts.some((news) => news.themes.includes(theme) && news.relatedStocks.filter((stock) => stock.firstBoard).length >= 3)))]
    : []
  const warnings = [...brief.warnings, ...context.warnings]
  return {
    ...brief,
    overnightContext: context,
    newsCatalysts: context.newsCatalysts,
    expectedDirections: context.expectedDirections,
    auctionConfirmedDirections: context.auctionConfirmedDirections,
    openConfirmedDirections: context.openConfirmedDirections,
    warnings: [...new Set(warnings)],
    renderedText: renderAuctionBrief({
      ...brief,
      overnightContext: context,
      newsCatalysts: context.newsCatalysts,
      expectedDirections: context.expectedDirections,
      auctionConfirmedDirections: context.auctionConfirmedDirections,
      openConfirmedDirections: context.openConfirmedDirections,
      warnings: [...new Set(warnings)],
    }),
  }
}

function resolveLlmEndpoint(apiUrl: string, protocol: 'anthropic' | 'openai'): string {
  if (protocol === 'anthropic') {
    return apiUrl.endsWith('/v1/messages')
      ? apiUrl
      : `${apiUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '')}/v1/messages`
  }
  if (apiUrl.includes('xiaomimimo.com') && !apiUrl.endsWith('/v1/chat/completions')) {
    return `${apiUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '')}/v1/chat/completions`
  }
  return apiUrl.endsWith('/chat/completions')
    ? apiUrl
    : `${apiUrl.replace(/\/+$/, '')}/chat/completions`
}

function aiSummaryValid(value: string, source: string): boolean {
  const summary = value.trim()
  if (summary.length < 8 || summary.length > 220) return false
  if (/买入|卖出|满仓|梭哈|仓位|必涨|稳赚|下单/.test(summary)) return false
  const sourceCodes = new Set(source.match(/\b\d{6}\b/g) ?? [])
  if ((summary.match(/\b\d{6}\b/g) ?? []).some((code) => !sourceCodes.has(code))) return false
  const sourceNumbers = new Set(source.match(/\d+(?:\.\d+)?%?/g) ?? [])
  if ((summary.match(/\d+(?:\.\d+)?%?/g) ?? []).some((value) => !sourceNumbers.has(value))) {
    return false
  }
  return true
}

async function requestPolishedSummary(brief: AuctionBrief): Promise<string | null> {
  if (process.env.AUCTION_BRIEF_AI_ENABLED === 'false') return null
  const apiUrl = process.env.LLM_API_URL?.trim()
  const apiKey = process.env.LLM_API_KEY?.trim()
  const model = process.env.LLM_MODEL?.trim()
  if (!apiUrl || !apiKey || !model || brief.degraded) return null
  const facts = JSON.stringify({
    deterministicSummary: brief.deterministicSummary,
    strengthLabel: brief.strengthLabel,
    strengthScore: brief.strengthScore,
    confidence: brief.confidence,
    primaryDirection: brief.primaryDirection,
    marketStyle: brief.marketStyle?.label ?? null,
    themes: brief.themes.map((theme) => ({
      theme: theme.theme,
      state: theme.state,
      score: theme.score,
      core: theme.coreName,
      assistants: theme.assistantCount,
    })),
    candidates: brief.candidates.map((candidate) => ({
      code: candidate.code,
      name: candidate.name,
      verdict: candidate.verdict,
      reasons: candidate.reasons,
    })),
    warnings: brief.warnings,
  })
  const isMiMo = apiUrl.includes('xiaomimimo.com') || apiUrl.includes('mimo')
  const protocol = isMiMo ? 'openai' : getProtocol(apiUrl)
  const prompt =
    '将以下A股集合竞价量化事实压缩成一段不超过120个汉字的中文摘要。' +
    '只能复述给定事实，不得新增股票、数字、题材、因果或交易建议，不要Markdown：\n' +
    facts
  const timeoutMs = Math.max(
    1_000,
    Number(process.env.AUCTION_BRIEF_AI_TIMEOUT_MS) || DEFAULT_AI_TIMEOUT_MS,
  )
  const endpoint = resolveLlmEndpoint(apiUrl, protocol)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let body: Record<string, unknown>
  if (protocol === 'anthropic') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
    body = {
      model,
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }
  } else {
    if (isMiMo) headers['api-key'] = apiKey
    else headers.Authorization = `Bearer ${apiKey}`
    body = {
      model,
      max_tokens: 256,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: '你是量化简报编辑，只能压缩事实，不能补充推断。',
        },
        { role: 'user', content: prompt },
      ],
      stream: false,
    }
  }
  try {
    const response = await fetchWithProxy(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    const json = (await response.json()) as {
      content?: Array<{ text?: string }>
      choices?: Array<{ message?: { content?: string } }>
    }
    const value =
      protocol === 'anthropic'
        ? json.content?.map((part) => part.text ?? '').join('')
        : json.choices?.[0]?.message?.content
    return value && aiSummaryValid(value, facts) ? value.trim() : null
  } catch {
    return null
  }
}

export async function polishAuctionBrief(brief: AuctionBrief): Promise<AuctionBrief> {
  const summary = await requestPolishedSummary(brief)
  if (!summary) return brief
  const polished = {
    ...brief,
    summary,
    generationMode: 'rules-ai-polished' as const,
  }
  return { ...polished, renderedText: renderAuctionBrief(polished) }
}

function persistBrief(brief: AuctionBrief): AuctionBriefArchive {
  const path = briefArchivePath(brief.signalDate)
  const existing = readJson<AuctionBriefArchive>(path)
  const briefs = [
    ...(existing?.briefs ?? []).filter((item) => item.phase !== brief.phase),
    brief,
  ].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
  const archive: AuctionBriefArchive = {
    signalDate: brief.signalDate,
    tradeDate: brief.tradeDate,
    ruleVersion: AUCTION_BRIEF_VERSION,
    updatedAt: new Date().toISOString(),
    briefs,
  }
  writeJsonAtomic(path, archive)
  return archive
}

function persistDelivery(record: NotificationDeliveryRecord): NotificationDeliveryArchive {
  const path = deliveryArchivePath(record.signalDate)
  const existing = readJson<NotificationDeliveryArchive>(path)
  const records = [
    ...(existing?.records ?? []).filter(
      (item) => item.idempotencyKey !== record.idempotencyKey,
    ),
    record,
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const archive: NotificationDeliveryArchive = {
    signalDate: record.signalDate,
    tradeDate: record.tradeDate,
    ruleVersion: AUCTION_BRIEF_VERSION,
    updatedAt: new Date().toISOString(),
    records,
  }
  writeJsonAtomic(path, archive)
  return archive
}

export class ServerChanProvider implements NotificationProvider {
  readonly name = 'serverchan' as const
  readonly configured: boolean
  private readonly sendKey: string

  constructor(sendKey = process.env.SERVERCHAN_SEND_KEY?.trim() ?? '') {
    this.sendKey = sendKey
    this.configured = !!sendKey
  }

  async send(message: NotificationMessage): Promise<NotificationProviderResult> {
    if (!this.sendKey) {
      return {
        ok: false,
        statusCode: null,
        providerCode: null,
        message: 'SERVERCHAN_SEND_KEY 未配置',
        pushId: null,
      }
    }
    const response = await fetchWithProxy(
      `https://sctapi.ftqq.com/${encodeURIComponent(this.sendKey)}.send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          title: message.title.slice(0, 64),
          desp: truncate(message.body, MAX_MESSAGE_LENGTH),
        }).toString(),
        signal: AbortSignal.timeout(SERVERCHAN_TIMEOUT_MS),
      },
    )
    let json: {
      code?: number | string
      message?: string
      data?: { pushid?: string }
    } = {}
    try {
      json = (await response.json()) as typeof json
    } catch {
      json = {}
    }
    const providerCode = json.code ?? null
    const ok = response.ok && (providerCode === 0 || providerCode === '0')
    return {
      ok,
      statusCode: response.status,
      providerCode,
      message: sanitizeNotificationText(
        String(json.message ?? (ok ? 'ok' : 'Server酱返回失败')),
      ),
      pushId: json.data?.pushid ? String(json.data.pushid) : null,
    }
  }
}

export async function sendNotificationWithRetry(
  provider: NotificationProvider,
  message: NotificationMessage,
  options: {
    maxAttempts?: number
    retryDelaysMs?: number[]
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<{
  result: NotificationProviderResult
  attempts: number
  responseTimeMs: number
  error: string
}> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const retryDelaysMs = options.retryDelaysMs ?? [5_000, 15_000]
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const startedAt = Date.now()
  let last: NotificationProviderResult = {
    ok: false,
    statusCode: null,
    providerCode: null,
    message: '未发送',
    pushId: null,
  }
  let error = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      last = await provider.send(message)
      last = {
        ...last,
        message: sanitizeNotificationText(last.message),
      }
      error = last.ok ? '' : last.message
    } catch (reason) {
      error = sanitizeNotificationText(
        reason instanceof Error ? reason.message : '通知请求失败',
      )
      last = {
        ok: false,
        statusCode: null,
        providerCode: null,
        message: error,
        pushId: null,
      }
    }
    const retryable =
      last.statusCode == null ||
      last.statusCode === 429 ||
      last.statusCode >= 500
    if (last.ok || !retryable || attempt === maxAttempts) {
      return {
        result: last,
        attempts: attempt,
        responseTimeMs: Date.now() - startedAt,
        error,
      }
    }
    await sleep(retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)] ?? 0)
  }
  return {
    result: last,
    attempts: maxAttempts,
    responseTimeMs: Date.now() - startedAt,
    error,
  }
}

function existingDeliveryRecord(
  signalDate: string,
  idempotencyKey: string,
): NotificationDeliveryRecord | null {
  return (
    readJson<NotificationDeliveryArchive>(deliveryArchivePath(signalDate))?.records.find(
      (record) => record.idempotencyKey === idempotencyKey,
    ) ?? null
  )
}

export async function generateAndDispatchAuctionBrief(
  args: {
    phase: AuctionBriefPhase
    analysis: LimitLadderAnalysis
    nextDay: LimitLadderNextDay
    currentAnalysis?: LimitLadderAnalysis
  },
  options: DispatchOptions = {},
): Promise<{
  brief: AuctionBrief
  delivery: NotificationDeliveryRecord
  duplicate: boolean
}> {
  if (!args.nextDay.tradeDate || args.nextDay.tradeDate <= args.analysis.asof) {
    throw new Error('目标交易日尚未确定，不能生成竞价推送')
  }
  const idempotencyKey = `${args.nextDay.tradeDate}:${args.phase}:${AUCTION_BRIEF_VERSION}`
  const existingDelivery = existingDeliveryRecord(args.analysis.asof, idempotencyKey)
  const existingBrief = readJson<AuctionBriefArchive>(
    briefArchivePath(args.analysis.asof),
  )?.briefs.find((brief) => brief.phase === args.phase)
  const pendingAgeMs = existingDelivery
    ? Date.now() - new Date(existingDelivery.updatedAt).getTime()
    : Number.POSITIVE_INFINITY
  const deliveryHandled =
    existingDelivery?.status === 'sent' ||
    existingDelivery?.status === 'failed' ||
    (existingDelivery?.status === 'pending' && pendingAgeMs < 30_000)
  if (deliveryHandled && existingBrief) {
    return { brief: existingBrief, delivery: existingDelivery, duplicate: true }
  }

  let brief = existingBrief
  if (!brief) {
    const built = buildAuctionBrief(args)
    const enriched = await enrichAuctionBriefWithOvernight(built, args).catch((error) => {
      built.warnings = [...built.warnings, `隔夜新闻映射失败：${error instanceof Error ? error.message : '数据源不可用'}`]
      return built
    })
    brief = await (options.polish ?? polishAuctionBrief)(enriched).catch(() => enriched)
    persistBrief(brief)
  }

  const provider = options.provider ?? new ServerChanProvider()
  const now = new Date().toISOString()
  const status: NotificationDeliveryStatus = !notificationEnabled()
    ? 'disabled'
    : !provider.configured
      ? 'not-configured'
      : 'pending'
  let delivery: NotificationDeliveryRecord = {
    idempotencyKey,
    signalDate: brief.signalDate,
    tradeDate: brief.tradeDate,
    phase: brief.phase,
    provider: 'serverchan',
    status,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    sentAt: null,
    responseTimeMs: null,
    statusCode: null,
    providerCode: null,
    providerMessage: '',
    pushId: null,
    error:
      status === 'disabled'
        ? 'AUCTION_PUSH_ENABLED 未启用'
        : status === 'not-configured'
          ? 'SERVERCHAN_SEND_KEY 未配置'
          : '',
  }
  persistDelivery(delivery)
  if (status !== 'pending') return { brief, delivery, duplicate: false }

  const sent = await sendNotificationWithRetry(
    provider,
    { title: brief.title, body: brief.renderedText },
    {
      maxAttempts: options.maxAttempts,
      retryDelaysMs: options.retryDelaysMs,
      sleep: options.sleep,
    },
  )
  delivery = {
    ...delivery,
    status: sent.result.ok ? 'sent' : 'failed',
    attempts: sent.attempts,
    updatedAt: new Date().toISOString(),
    sentAt: sent.result.ok ? new Date().toISOString() : null,
    responseTimeMs: sent.responseTimeMs,
    statusCode: sent.result.statusCode,
    providerCode: sent.result.providerCode,
    providerMessage: sent.result.message,
    pushId: sent.result.pushId,
    error: sent.error,
  }
  persistDelivery(delivery)
  return { brief, delivery, duplicate: false }
}

export function readAuctionBriefState(signalDate: string): AuctionBriefState {
  if (!safeDate(signalDate)) throw new Error('signalDate 必须是 YYYY-MM-DD')
  const briefs = readJson<AuctionBriefArchive>(
    existingVersionedPath(signalDate, briefArchivePath),
  )
  const deliveries = readJson<NotificationDeliveryArchive>(
    existingVersionedPath(signalDate, deliveryArchivePath),
  )
  return {
    signalDate,
    tradeDate: briefs?.tradeDate ?? deliveries?.tradeDate ?? '',
    ruleVersion:
      briefs?.ruleVersion ?? deliveries?.ruleVersion ?? AUCTION_BRIEF_VERSION,
    notification: {
      provider: 'serverchan',
      enabled: notificationEnabled(),
      configured: serverChanConfigured(),
    },
    briefs: briefs?.briefs ?? [],
    deliveries: deliveries?.records ?? [],
  }
}

/** Resolve the archive by its target trade date when the caller does not know
 * the prior signal date (the UI commonly opens `/auction-brief?tradeDate=...`). */
export function readAuctionBriefStateByTradeDate(tradeDate: string): AuctionBriefState {
  if (!safeDate(tradeDate)) throw new Error('tradeDate 必须是 YYYY-MM-DD')
  if (existsSync(DEFAULT_LADDER_ROOT)) {
    for (const entry of readdirSync(DEFAULT_LADDER_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue
      const state = readAuctionBriefState(entry.name)
      if (state.tradeDate === tradeDate) return state
    }
  }
  return {
    signalDate: '',
    tradeDate,
    ruleVersion: AUCTION_BRIEF_VERSION,
    notification: { provider: 'serverchan', enabled: notificationEnabled(), configured: serverChanConfigured() },
    briefs: [],
    deliveries: [],
  }
}

export async function sendServerChanTest(
  provider: NotificationProvider = new ServerChanProvider(),
): Promise<NotificationProviderResult & { attempts: number; responseTimeMs: number }> {
  if (!provider.configured) throw new Error('SERVERCHAN_SEND_KEY 未配置')
  const result = await sendNotificationWithRetry(
    provider,
    {
      title: 'A股竞价简报连接测试',
      body:
        `Server酱连接成功测试\n\n时间：${new Date().toISOString()}\n\n` +
        '> 此消息仅验证通知通道，不包含交易信号。',
    },
    { maxAttempts: 2, retryDelaysMs: [1_000] },
  )
  if (!result.result.ok) throw new Error(result.error || result.result.message)
  return {
    ...result.result,
    attempts: result.attempts,
    responseTimeMs: result.responseTimeMs,
  }
}

export function auctionBriefPhaseForMinutes(
  minutes: number,
): AuctionBriefPhase | null {
  if (minutes >= 9 * 60 + 28 && minutes < 9 * 60 + 30) return 'auction-final'
  if (minutes >= 9 * 60 + 35 && minutes < 9 * 60 + 37) {
    return 'open-confirmation'
  }
  return null
}
