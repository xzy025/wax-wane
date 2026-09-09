import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import Papa from 'papaparse'
import { FileArrowUp, FlagBanner, X } from 'phosphor-react'
import {
  useAuctionBriefs,
  useCrossMarketSnapshot,
  useFirstBoardScan,
  useHithinkAnomaly,
  useLadderArchiveDates,
  useLadderAnalysis,
  useLadderNextDay,
  useLadderReason,
  useTradingCalendarDates,
  type AuctionBriefState,
  type CapitalLaneId,
  type CrossMarketPhase,
  type CrossMarketSnapshot,
  type NotificationDeliveryStatus,
  type LadderImportPayload,
  type LadderImportStock,
  type LadderAuctionContext,
  type LadderEventGate,
  type LadderEventReaction,
  type LadderOutcomeArchive,
  type LadderRoleMap,
  type MarketRiskGate,
  type HighBoardRiskContext,
  type FirstBoardScanResponse,
  type NextDayCandidateConfirmation,
  type NextDayManualReviewPayload,
  type NextDayRelayItem,
  type NextDayRelayPlan,
  type NextDayState,
  type LadderState,
  type LadderStockAnalysis,
  type LimitLadderAnalysis,
  type LadderSentimentQuantSnapshot,
  type RelayExpectation,
  type PromotionLane,
  type PromotionStatistics,
} from '../hooks/useLadderAnalysis'
import MarketDatePicker from '../components/MarketDatePicker'
import PremarketWorkbench from '../components/PremarketWorkbench'
import { useTradingDates } from '../hooks/useMoneyFlow'
import { getLastSettledTradingDay } from '../utils/marketHistory'
import type { Translation } from '../types'

interface LadderViewProps {
  t: Translation
  language: 'zh' | 'en'
}

type ViewMode = 'single' | 'list'
type BoardFilter = 'all' | 'main' | 'twenty'
type StateFilter = 'all' | LadderState

const STATE_ORDER: LadderState[] = ['candidate', 'waiting', 'observe', 'exclude']

function recentWeekdaysThrough(endDate: string, lookback = 45): string[] {
  const cursor = new Date(`${endDate}T00:00:00Z`)
  const dates: string[] = []
  for (let index = 0; index < lookback; index += 1) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return dates
}

function fmtTime(value: string): string {
  if (!value) return '--:--'
  const digits = value.padStart(6, '0')
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`
}

function fmtRatio(value: number | null, suffix = 'x'): string {
  return value == null ? '--' : `${value.toFixed(2)}${suffix}`
}

function fmtYi(value: number): string {
  return value > 0 ? `${(value / 1e8).toFixed(2)}亿` : '--'
}

function fmtScore(value: number | null | undefined): string {
  return value == null ? '--' : value.toFixed(1)
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return undefined
}

function numberValue(value: unknown): number | undefined {
  const normalized = String(value ?? '')
    .replace(/[,%亿万]/g, '')
    .trim()
  if (!normalized) return undefined
  const number = Number(normalized)
  return Number.isFinite(number) ? number : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (['true', '1', 'yes', '是', '一字'].includes(normalized)) return true
  if (['false', '0', 'no', '否'].includes(normalized)) return false
  return undefined
}

function normalizeImportRow(row: Record<string, unknown>): LadderImportStock | null {
  const code = String(pick(row, ['code', '代码', '股票代码']) ?? '')
    .replace(/\D/g, '')
    .padStart(6, '0')
    .slice(-6)
  if (!/^\d{6}$/.test(code) || code === '000000') return null
  const themes = String(pick(row, ['themes', 'theme', '题材', '概念']) ?? '')
    .split(/[|、,，]/)
    .map((value) => value.trim())
    .filter(Boolean)
  return {
    code,
    name: String(pick(row, ['name', '名称', '股票名称']) ?? '').trim() || undefined,
    status: String(pick(row, ['status', '状态']) ?? '').trim() || undefined,
    consecutiveDays: numberValue(pick(row, ['consecutiveDays', 'boards', '连板数', '板数'])),
    nDayBoards: String(pick(row, ['nDayBoards', '几天几板', '涨停统计']) ?? '').trim() || undefined,
    themes,
    subtheme: String(pick(row, ['subtheme', '细分题材', '细分']) ?? '').trim() || undefined,
    role: String(pick(row, ['role', '角色', '定位']) ?? '').trim() || undefined,
    reason: String(pick(row, ['reason', '涨停原因', '原因']) ?? '').trim() || undefined,
    firstTime: String(pick(row, ['firstTime', '首次封板', '首封时间']) ?? '').trim() || undefined,
    lastTime: String(pick(row, ['lastTime', '最后封板', '末封时间']) ?? '').trim() || undefined,
    openCount: numberValue(pick(row, ['openCount', '炸板次数', '开板次数'])),
    turnoverRate: numberValue(pick(row, ['turnoverRate', '换手率'])),
    amount: numberValue(pick(row, ['amount', '成交额'])),
    sealAmount: numberValue(pick(row, ['sealAmount', '封单额'])),
    onePrice: booleanValue(pick(row, ['onePrice', '一字板'])),
  }
}

async function parseImportFile(file: File, asof: string): Promise<LadderImportPayload> {
  const text = await file.text()
  if (file.name.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text) as
      | { asof?: string; stocks?: Record<string, unknown>[] }
      | Record<string, unknown>[]
    const rows = Array.isArray(parsed) ? parsed : (parsed.stocks ?? [])
    const stocks = rows.map(normalizeImportRow).filter((row): row is LadderImportStock => !!row)
    return { asof: Array.isArray(parsed) ? asof : (parsed.asof ?? asof), stocks }
  }
  const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true })
  if (parsed.errors.length && parsed.data.length === 0) throw new Error(parsed.errors[0].message)
  return {
    asof,
    stocks: parsed.data.map(normalizeImportRow).filter((row): row is LadderImportStock => !!row),
  }
}

function StateBadge({ state, t }: { state: LadderState; t: Translation['ladder'] }) {
  return <span className={`ladder-state ladder-state--${state}`}>{t.states[state]}</span>
}

function NextDayStateBadge({ state, t }: { state: NextDayState; t: Translation['ladder'] }) {
  return (
    <span className={`ladder-next-state ladder-next-state--${state}`}>
      {t.v2.nextStates[state]}
    </span>
  )
}

function PromotionLaneStrip({
  lanes,
  statistics,
  t,
}: {
  lanes: PromotionLane[]
  statistics?: PromotionStatistics
  t: Translation['ladder']
}) {
  const windows = statistics
    ? ([
        ['1D', statistics.overall.day1],
        ['5D', statistics.overall.day5],
        ['20D', statistics.overall.day20],
        ['60D', statistics.overall.day60],
      ] as const)
    : []
  return (
    <section className="ladder-lanes" aria-label={t.v2.lanes}>
      <header className="ladder-section-heading">
        <div>
          <h2>{t.v2.lanes}</h2>
          <span>{t.v2.research}</span>
        </div>
        <strong>
          {t.v2.dominantLane}: {lanes.find((lane) => lane.dominant)?.label ?? '--'}
        </strong>
      </header>
      {windows.length > 0 && (
        <div className="ladder-promotion-windows">
          {windows.map(([label, estimate]) => (
            <div key={label}>
              <b>{label}</b>
              <span>
                {t.v4.rawRate} {estimate.rawRate == null ? '--' : `${estimate.rawRate.toFixed(1)}%`}
              </span>
              <strong>
                {t.v4.adjustedRate}{' '}
                {estimate.adjustedRate == null ? '--' : `${estimate.adjustedRate.toFixed(1)}%`}
              </strong>
              <small>
                {estimate.promoted}/{estimate.valid} · {t.v4.confidenceLevels[estimate.confidence]}
              </small>
            </div>
          ))}
        </div>
      )}
      <div className="ladder-lane-grid">
        {lanes.map((lane) => (
          <article className={`ladder-lane ${lane.dominant ? 'is-dominant' : ''}`} key={lane.label}>
            <div className="ladder-lane-title">
              <strong>{lane.label}</strong>
              {lane.dominant && <span>{t.v2.dominant}</span>}
              <b className="mono">{fmtScore(lane.score)}</b>
            </div>
            <div className="ladder-lane-track" aria-hidden="true">
              <span style={{ width: `${Math.max(0, Math.min(100, lane.score))}%` }} />
            </div>
            <dl>
              <div>
                <dt>{t.v2.supply}</dt>
                <dd>{lane.supply}</dd>
              </div>
              <div>
                <dt>{t.v4.adjustedRate}</dt>
                <dd>
                  {(lane.adjustedPromotionRate ?? lane.promotionRate) == null
                    ? '--'
                    : `${(lane.adjustedPromotionRate ?? lane.promotionRate)!.toFixed(1)}%`}
                </dd>
              </div>
              <div>
                <dt>{t.v4.rawRate}</dt>
                <dd>
                  {lane.rawPromotionRate == null ? '--' : `${lane.rawPromotionRate.toFixed(1)}%`}
                </dd>
              </div>
              <div>
                <dt>{t.v4.sample}</dt>
                <dd>
                  {lane.rollingPromoted ?? lane.promoted}/{lane.rollingValid ?? lane.promotionTotal}
                  {lane.promotionConfidence
                    ? ` · ${t.v4.confidenceLevels[lane.promotionConfidence]}`
                    : ''}
                </dd>
              </div>
              <div>
                <dt>{t.v2.themeCoverage}</dt>
                <dd>{lane.themeCoverage.toFixed(1)}%</dd>
              </div>
              <div>
                <dt>{t.v2.sealStability}</dt>
                <dd>{lane.sealStability.toFixed(1)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}

function RoleMapPanel({ roleMap, t }: { roleMap: LadderRoleMap; t: Translation['ladder'] }) {
  const profiles = [...roleMap.profiles, ...roleMap.brokenAnchors]
  return (
    <section className="ladder-role-map" aria-label={t.v4.roleMap}>
      <header className="ladder-section-heading">
        <div>
          <h2>{t.v4.roleMap}</h2>
          <span>{t.v4.roleMapSubtitle}</span>
        </div>
        <strong>
          {roleMap.maxBoards}
          {t.boards}
        </strong>
      </header>
      <div className="ladder-role-tiers">
        {(['high', 'middle', 'low'] as const).map((tier) => (
          <div className={`ladder-role-tier ladder-role-tier--${tier}`} key={tier}>
            <h3>{t.v4.heightTiers[tier]}</h3>
            <div className="ladder-role-list">
              {profiles
                .filter((profile) => profile.heightTier === tier)
                .map((profile) => (
                  <article className="ladder-role-item" key={`${tier}-${profile.code}`}>
                    <header>
                      <strong>{profile.name}</strong>
                      <span className="mono">
                        {profile.boards}
                        {t.boards}
                      </span>
                    </header>
                    <p>
                      {t.v4.marketRoles[profile.marketRole]} · {t.v4.themeRoles[profile.themeRole]}
                    </p>
                    <small>
                      {profile.primaryTheme} · {t.v4.lifecycles[profile.lifecycle]} ·{' '}
                      {t.v4.positionDelta} {profile.positionDelta} · {t.v4.followers}{' '}
                      {profile.followerCount} · {t.v2.confidence} {profile.confidence.toFixed(0)}%
                    </small>
                  </article>
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function RiskRadarPanel({ gate, t }: { gate: LadderEventGate; t: Translation['ladder'] }) {
  const actionPriority = {
    'hard-block': 0,
    'risk-cap': 1,
    'theme-adjust': 2,
    informational: 3,
  } as const
  const displayEvents = [...gate.events]
    .sort(
      (a, b) =>
        actionPriority[a.action] - actionPriority[b.action] ||
        b.severity - a.severity ||
        b.publishedAt.localeCompare(a.publishedAt),
    )
    .slice(0, 12)
  return (
    <section className="ladder-risk-radar" aria-label={t.v4.riskRadar}>
      <header className="ladder-section-heading">
        <div>
          <h2>{t.v4.riskRadar}</h2>
          <span>{t.v4.riskRadarSubtitle}</span>
        </div>
        <div className={`ladder-market-risk ladder-market-risk--${gate.marketRisk}`}>
          <span>{t.v4.marketRisk}</span>
          <strong>{t.v4.marketRiskStates[gate.marketRisk]}</strong>
          <b className="mono">{gate.coverage.toFixed(0)}%</b>
        </div>
      </header>
      {displayEvents.length ? (
        <div className="ladder-risk-list">
          {displayEvents.map((event) => (
            <article className="ladder-risk-event" key={event.id}>
              <header>
                <span className={`ladder-event-action ladder-event-action--${event.action}`}>
                  {t.v4.eventActions[event.action]}
                </span>
                <time>{new Date(event.publishedAt).toLocaleString()}</time>
              </header>
              {event.sourceUrl ? (
                <a href={event.sourceUrl} target="_blank" rel="noreferrer">
                  {event.title}
                </a>
              ) : (
                <strong>{event.title}</strong>
              )}
              <small>
                {event.source} ·{' '}
                {event.codes.join(' / ') || event.themes.join(' / ') || event.scope}
              </small>
            </article>
          ))}
        </div>
      ) : (
        <div className="ladder-candidate-empty">{t.v4.noRiskEvents}</div>
      )}
      {gate.warnings.length > 0 && (
        <div className="ladder-candidate-warning">{gate.warnings.join(' · ')}</div>
      )}
    </section>
  )
}

function HighBoardRiskPanel({
  context,
  reaction,
  t,
}: {
  context: HighBoardRiskContext
  reaction?: LadderEventReaction | null
  t: Translation['ladder']
}) {
  const pct = (value: number | null) => (value == null ? '--' : `${value.toFixed(1)}%`)
  return (
    <section className="ladder-high-board-risk" aria-label={t.v4.highBoardRisk}>
      <header className="ladder-section-heading">
        <div>
          <h2>{t.v4.highBoardRisk}</h2>
          <span>{t.v4.highBoardSubtitle}</span>
        </div>
        <div className={`ladder-appetite ladder-appetite--${context.state}`}>
          <span>{context.phase === 'auction' ? '9:25' : '9:35'}</span>
          <strong>{t.v4.appetiteStates[context.state]}</strong>
          <b className="mono">{context.score.toFixed(1)}</b>
        </div>
      </header>
      <div className="ladder-high-board-metrics">
        <div>
          <span>{t.v2.positiveRate}</span>
          <strong>{pct(context.metrics.positiveRate)}</strong>
        </div>
        <div>
          <span>{t.v4.nuclearRate}</span>
          <strong>{pct(context.metrics.nuclearRate)}</strong>
        </div>
        <div>
          <span>{t.v4.onePriceRetention}</span>
          <strong>{pct(context.metrics.onePriceRetentionRate)}</strong>
        </div>
        <div>
          <span>{t.v4.vwapHold}</span>
          <strong>{pct(context.metrics.vwapHoldRate)}</strong>
        </div>
        <div>
          <span>{t.v4.eventReaction}</span>
          <strong>{reaction ? t.v4.reactionStates[reaction.state] : '--'}</strong>
        </div>
        <div>
          <span>{t.v4.resealRate}</span>
          <strong>{pct(context.metrics.resealRate)}</strong>
        </div>
      </div>
      <div className="ladder-high-board-members">
        {context.members.slice(0, 8).map((member) => (
          <div key={member.code}>
            <strong>{member.name}</strong>
            <span>
              {t.v4.marketRoles[member.marketRole]} · {member.boards}
              {t.boards}
            </span>
            <b className="mono">{member.gapPct == null ? '--' : `${member.gapPct.toFixed(1)}%`}</b>
            {member.nuclear && <em>{t.v4.nuclearRate}</em>}
          </div>
        ))}
      </div>
      <div className="ladder-theme-risk-list">
        {context.themes.slice(0, 8).map((theme) => (
          <div key={theme.theme}>
            <strong>{theme.theme}</strong>
            <span>{t.v4.appetiteStates[theme.state]}</span>
            <b className="mono">{theme.score.toFixed(1)}</b>
            {theme.highLowSwitch && <em>{t.v4.highLowSwitch}</em>}
          </div>
        ))}
      </div>
      {context.warnings.length > 0 && (
        <div className="ladder-candidate-warning">{context.warnings.join(' · ')}</div>
      )}
    </section>
  )
}

function MarketGatePanel({ gate, t }: { gate: MarketRiskGate; t: Translation['ladder'] }) {
  const us = gate.premarket?.us ?? []
  const asia = gate.premarket?.asia ?? []
  const macro =
    gate.premarket?.macro.filter((row) => ['us10y', 'vix', 'usdcny'].includes(row.id)) ?? []
  return (
    <section
      className={`ladder-market-gate ladder-market-gate--${gate.state}`}
      aria-label={t.v5.marketGate}
    >
      <header className="ladder-section-heading">
        <div>
          <h2>{t.v5.marketGate}</h2>
          <span>{t.v5.marketGateSubtitle}</span>
        </div>
        <div className="ladder-market-gate-state">
          <span>
            {gate.phase === 'premarket' ? '08:50' : gate.phase === 'auction' ? '09:25' : '09:35'}
          </span>
          <strong>{t.v5.gateStates[gate.state]}</strong>
        </div>
      </header>

      <div className="ladder-market-gate-metrics">
        <div>
          <span>{t.v5.externalRisk}</span>
          <strong>{fmtScore(gate.externalRiskScore)}</strong>
        </div>
        <div>
          <span>{t.v5.domesticRisk}</span>
          <strong>{fmtScore(gate.domesticRiskScore)}</strong>
        </div>
        <div>
          <span>{t.v5.domesticConfirmed}</span>
          <strong>{gate.domesticConfirmed ? t.v5.domesticConfirmed : t.v5.notConfirmed}</strong>
        </div>
        <div>
          <span>{t.v2.coverage}</span>
          <strong>{gate.premarket ? `${gate.premarket.coverage.toFixed(0)}%` : '--'}</strong>
        </div>
      </div>

      {gate.repairContext && (
        <div
          className={`ladder-repair-context ladder-repair-context--${gate.repairContext.state}`}
          aria-label={t.v6.repairStructure}
        >
          <div className="ladder-repair-heading">
            <div>
              <h3>{t.v6.repairStructure}</h3>
              <span>{t.v6.repairSubtitle}</span>
            </div>
            <strong>{t.v6.repairStates[gate.repairContext.state]}</strong>
            {!gate.repairContext.applicable && <em>{t.v6.displayOnly}</em>}
          </div>
          <div className="ladder-repair-metrics">
            <div>
              <span>{t.v6.largeCap}</span>
              <strong>
                {gate.repairContext.largeCapChangePct == null
                  ? '--'
                  : `${gate.repairContext.largeCapChangePct.toFixed(2)}%`}
              </strong>
            </div>
            <div>
              <span>{t.v6.smallCap}</span>
              <strong>
                {gate.repairContext.smallCapChangePct == null
                  ? '--'
                  : `${gate.repairContext.smallCapChangePct.toFixed(2)}%`}
              </strong>
            </div>
            <div>
              <span>{t.v6.sizeSpread}</span>
              <strong>
                {gate.repairContext.sizeSpreadPct == null
                  ? '--'
                  : `${gate.repairContext.sizeSpreadPct >= 0 ? '+' : ''}${gate.repairContext.sizeSpreadPct.toFixed(2)}%`}
              </strong>
            </div>
            <div>
              <span>{t.v6.advanceRate}</span>
              <strong>
                {gate.repairContext.advanceRate == null
                  ? '--'
                  : `${gate.repairContext.advanceRate.toFixed(1)}%`}
              </strong>
            </div>
            <div>
              <span>{t.v6.largeCapAmountShare}</span>
              <strong>
                {gate.repairContext.largeCapAuctionAmountSharePct == null
                  ? '--'
                  : `${gate.repairContext.largeCapAuctionAmountSharePct.toFixed(1)}%`}
              </strong>
            </div>
            <div>
              <span>{t.v6.confidence}</span>
              <strong>{gate.repairContext.confidence.toFixed(0)}%</strong>
            </div>
          </div>
          {(gate.repairContext.reasons.length > 0 || gate.repairContext.warnings.length > 0) && (
            <p>{[...gate.repairContext.reasons, ...gate.repairContext.warnings].join(' · ')}</p>
          )}
        </div>
      )}

      {gate.premarket ? (
        <div className="ladder-market-context">
          <div>
            <h3>{t.v5.overnightContext} · 美股指数</h3>
            <small className="ladder-market-context-note">
              风险 {fmtScore(gate.premarket?.usRiskScore)} · 题材方向另见美股映射研究
            </small>
            {us.map((row) => (
              <span key={row.code}>
                {row.name}{' '}
                <b className={row.changePct < 0 ? 'down' : 'up'}>{row.changePct.toFixed(2)}%</b>
              </span>
            ))}
          </div>
          <div>
            <h3>{t.v5.asiaContext} · 日韩指数/科技大票背景</h3>
            <small className="ladder-market-context-note">
              风险 {fmtScore(gate.premarket?.asiaRiskScore)} · 非科技连板不直接套用
            </small>
            {asia.map((row) => (
              <span key={row.code}>
                {row.name}{' '}
                <b className={row.changePct < 0 ? 'down' : 'up'}>{row.changePct.toFixed(2)}%</b>
              </span>
            ))}
          </div>
          <div>
            <h3>{t.v5.macroContext}</h3>
            {macro.map((row) => (
              <span key={row.id}>
                {row.id.toUpperCase()}{' '}
                <b>
                  {row.deltaBps == null
                    ? `${row.changePct.toFixed(2)}%`
                    : `${row.deltaBps >= 0 ? '+' : ''}${row.deltaBps.toFixed(1)}bp`}
                </b>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="ladder-candidate-warning">{t.v5.noSnapshot}</div>
      )}

      <div className="ladder-theme-permissions">
        <h3>{t.v5.themePermissions}</h3>
        <div>
          {gate.themePermissions.map((permission) => (
            <span
              key={permission.theme}
              className={`ladder-theme-permission ladder-theme-permission--${permission.state}`}
              title={permission.reasons.join(' · ')}
            >
              <strong>{permission.theme}</strong>
              <em>{t.v5.riskClasses[permission.riskClass]}</em>
              <b>{t.v5.permissionStates[permission.state]}</b>
              {permission.independentStrength && <small>{t.v5.independent}</small>}
            </span>
          ))}
        </div>
      </div>
      {(gate.reasons.length > 0 || gate.warnings.length > 0) && (
        <div className="ladder-candidate-warning">
          {[...gate.reasons, ...gate.warnings].join(' · ')}
        </div>
      )}
    </section>
  )
}

function expectationPathLabel(path: string | null, language: 'zh' | 'en'): string {
  if (!path) return '--'
  const labels: Record<string, [string, string]> = {
    'tradable-acceleration': ['可交易加速', 'Tradable acceleration'],
    'divergence-reseal': ['分歧回封', 'Divergence reseal'],
    'one-price-untradeable': ['一字不可交易', 'One-price untradeable'],
    'break-failure': ['炸板失败', 'Break failure'],
    'one-price': ['一字', 'One-price'],
    't-board': ['T字', 'T-board'],
    'gap-turnover': ['高开换手', 'Gap turnover'],
    'flat-turnover': ['平开换手', 'Flat turnover'],
  }
  return labels[path]?.[language === 'zh' ? 0 : 1] ?? path
}

const DEFAULT_LADDER_V7: NonNullable<Translation['ladder']['v7']> = {
  expectation: '预期—确认路径',
  expectationSubtitle: '最近三板板型×量价序列，仅作研究影子层展示',
  sequence: '最近三板序列',
  sequenceDataQuality: '序列质量',
  qingshan: '青山实验签名',
  primaryPath: '主路径',
  probabilities: '路径概率',
  confidence: '置信度',
  expectedOpen: '预期高开',
  expectedTouch: '预期触板窗口',
  expectedReopen: '最多重开',
  allowed: '允许路径',
  prohibited: '禁止路径',
  match: '盘中匹配',
  matchStatuses: { met: '满足', partial: '部分满足', violated: '违背', unavailable: '不可用' },
  sentimentQuant: '双高潮情绪闸门',
  sentimentSubtitle: 'B（情绪）+ M（大盘势能）= C；缺数据不按中性放行',
  emotionScore: '情绪 B',
  marketScore: '大盘 M',
  combinedScore: '合计 C',
  relayWeight: '次日接力权重',
  gate: '闸门状态',
  gateStates: { NORMAL: '常态', HOT: '火热', JOINT_CLIMAX: '双高潮', UNAVAILABLE: '不可用' },
  crowding: '拥挤度',
  unavailable: '不可用',
  noNewRelay: '次日全天 NO_NEW_RELAY',
  researchOnly: '研究输出，不构成自动交易许可',
}

function SentimentQuantPanel({
  snapshot,
  t,
  language,
}: {
  snapshot: LadderSentimentQuantSnapshot
  t: Translation['ladder']
  language: 'zh' | 'en'
}) {
  const score = (value: number | null) => (value == null ? '--' : String(value))
  const v7 = t.v7 ?? DEFAULT_LADDER_V7
  return (
    <section className={`ladder-sentiment-quant ladder-sentiment-quant--${snapshot.gateState}`} aria-label={v7.sentimentQuant}>
      <header className="ladder-section-heading">
        <div>
          <h2>{v7.sentimentQuant}</h2>
          <span>{v7.sentimentSubtitle}</span>
        </div>
        <div className="ladder-sentiment-quant-state">
          <strong>{v7.gateStates[snapshot.gateState]}</strong>
          {snapshot.noNewRelay && <em>{v7.noNewRelay}</em>}
        </div>
      </header>
      <div className="ladder-sentiment-quant-score-grid">
        <div><span>{v7.emotionScore}</span><strong>{score(snapshot.B)}</strong></div>
        <div><span>{v7.marketScore}</span><strong>{score(snapshot.M)}</strong></div>
        <div><span>{v7.combinedScore}</span><strong>{score(snapshot.C)}</strong></div>
        <div><span>{v7.relayWeight}</span><strong>{snapshot.nextDayRelayWeight == null ? '--' : snapshot.nextDayRelayWeight}</strong></div>
        <div><span>{v7.crowding}</span><strong>{snapshot.crowding.percentile == null ? '--' : `P${snapshot.crowding.percentile.toFixed(0)}`}</strong></div>
      </div>
      <div className="ladder-sentiment-quant-metrics">
        {[...snapshot.emotion.metrics, ...snapshot.market.metrics].map((metric) => (
          <div key={metric.id} className={`ladder-sentiment-metric ladder-sentiment-metric--${metric.state}`}>
            <span>{metric.label}</span>
            <b>{metric.score == null ? v7.unavailable : metric.score > 0 ? '+2' : '-2'}</b>
            <small>{metric.evidence}</small>
          </div>
        ))}
      </div>
      {(snapshot.warnings.length > 0 || snapshot.crowding.missingReasons.length > 0) && (
        <div className="ladder-candidate-warning">
          {[...snapshot.warnings, ...snapshot.crowding.missingReasons].join(' · ')}
        </div>
      )}
      <small className="ladder-sentiment-quant-note">{v7.researchOnly} · {language === 'zh' ? snapshot.asof : snapshot.generatedAt}</small>
    </section>
  )
}

function ExpectationPanel({
  expectation,
  match,
  t,
  language,
}: {
  expectation: RelayExpectation
  match?: { status: 'met' | 'partial' | 'violated' | 'unavailable'; fit: number | null }
  t: Translation['ladder']
  language: 'zh' | 'en'
}) {
  const v7 = t.v7 ?? DEFAULT_LADDER_V7
  return (
    <section className="ladder-expectation-panel">
      <header className="ladder-section-heading">
        <div>
          <h3>{v7.expectation}</h3>
          <span>{v7.expectationSubtitle}</span>
        </div>
        {match && <strong className={`ladder-expectation-match ladder-expectation-match--${match.status}`}>
          {v7.match}: {v7.matchStatuses[match.status]}{match.fit == null ? '' : ` ${match.fit.toFixed(0)}%`}
        </strong>}
      </header>
      <div className="ladder-expectation-grid">
        <div><span>{v7.sequence}</span><strong>{expectation.sequence.signature.map((item) => expectationPathLabel(item, language)).join(' → ') || '--'}</strong></div>
        <div><span>{v7.sequenceDataQuality}</span><strong>{expectation.sequence.dataQuality} · {expectation.sequence.coverage.toFixed(0)}%</strong></div>
        <div><span>{v7.qingshan}</span><strong>{expectation.sequence.qingshanPattern ? '✓' : '--'}</strong></div>
        <div><span>{v7.primaryPath}</span><strong>{expectationPathLabel(expectation.primaryPath, language)}</strong></div>
        <div><span>{v7.confidence}</span><strong>{expectation.confidence == null ? '--' : expectation.probabilityStatus === 'research-score' ? `研究分 ${expectation.confidence.toFixed(0)}` : `${(expectation.confidence * 100).toFixed(0)}%`}</strong></div>
        <div><span>{v7.expectedOpen}</span><strong>{expectation.expectedOpenGapPct ? `${expectation.expectedOpenGapPct[0]}% ~ ${expectation.expectedOpenGapPct[1]}%` : '--'}</strong></div>
        <div><span>{v7.expectedTouch}</span><strong>{expectation.expectedTouchTime?.join(' ~ ') ?? '--'}</strong></div>
        <div><span>{v7.expectedReopen}</span><strong>{expectation.expectedMaxReopenCount == null ? '--' : expectation.expectedMaxReopenCount}</strong></div>
      </div>
      {expectation.evidence.length > 0 && <p className="ladder-expectation-evidence">{expectation.evidence.join(' · ')}</p>}
      {expectation.missingReasons.length > 0 && <p className="ladder-expectation-missing">{expectation.missingReasons.join(' · ')}</p>}
    </section>
  )
}

const CAPITAL_LANE_ORDER: CapitalLaneId[] = [
  'hard-tech',
  'innovative-drug',
  'small-theme',
  'index-weight',
]

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

function CapitalSeesawPanel({
  snapshot,
  error,
  language,
}: {
  snapshot: CrossMarketSnapshot | null
  error: string | null
  language: 'zh' | 'en'
}) {
  if (!snapshot && !error) return null
  const isZh = language === 'zh'
  const liquidity = snapshot?.liquidityRegime
  const matrix = snapshot?.capitalSeesaw
  const lanes = CAPITAL_LANE_ORDER.map((id) => matrix?.lanes.find((lane) => lane.id === id)).filter(
    (lane): lane is NonNullable<typeof lane> => !!lane,
  )
  const laneLabels = new Map(matrix?.lanes.map((lane) => [lane.id, lane.label]) ?? [])
  const warnings = Array.from(
    new Set(
      [
        error,
        ...(snapshot?.warnings ?? []),
        ...(snapshot?.dataQuality.warnings ?? []),
        ...(liquidity?.warnings ?? []),
        ...(matrix?.warnings ?? []),
      ].filter((item): item is string => !!item),
    ),
  )
  const phaseLabel =
    snapshot?.phase === 'premarket' ? '09:15' : snapshot?.phase === 'auction' ? '09:25' : '09:35'
  const regimeLabels: Record<string, string> = isZh
    ? {
        'stock-crowding': '存量集中',
        'incremental-broad': '增量普涨',
        balanced: '均衡',
        unavailable: '不可用',
      }
    : {
        'stock-crowding': 'Stock crowding',
        'incremental-broad': 'Broad inflow',
        balanced: 'Balanced',
        unavailable: 'Unavailable',
      }

  return (
    <section className="ladder-capital-seesaw" aria-label="资金跷跷板矩阵">
      <header className="ladder-section-heading">
        <div>
          <h2>{isZh ? '资金跷跷板矩阵' : 'Capital seesaw matrix'}</h2>
          <span>
            {isZh
              ? '美股映射（CPO/大科技、创新药）× A股板块节律 × 同刻流动性；仅表示统计关联'
              : 'Cross-market shock × A-share rhythm × same-time liquidity; statistical association only'}
          </span>
        </div>
        <div className="ladder-seesaw-status">
          <span>{phaseLabel}</span>
          <strong>{snapshot?.probabilityStatus ?? 'unavailable'}</strong>
        </div>
      </header>

      <div className="ladder-seesaw-liquidity">
        <div>
          <span>{isZh ? '流动性状态' : 'Liquidity'}</span>
          <strong>{regimeLabels[liquidity?.state ?? 'unavailable']}</strong>
        </div>
        <div>
          <span>{isZh ? '同刻成交额比' : 'Turnover ratio'}</span>
          <strong>
            {liquidity?.sameTimeTurnoverRatio == null
              ? '--'
              : `${liquidity.sameTimeTurnoverRatio.toFixed(2)}x`}
          </strong>
        </div>
        <div>
          <span>{isZh ? '上涨宽度' : 'Advance breadth'}</span>
          <strong>
            {liquidity?.advanceRatePct == null ? '--' : `${liquidity.advanceRatePct.toFixed(1)}%`}
          </strong>
        </div>
        <div>
          <span>{isZh ? '前50集中度变化' : 'Top-50 concentration'}</span>
          <strong>
            {liquidity?.concentrationDeltaPct == null
              ? '--'
              : `${signed(liquidity.concentrationDeltaPct)}pp`}
          </strong>
        </div>
        <div>
          <span>{isZh ? '大小盘价差' : 'Large-small spread'}</span>
          <strong>
            {liquidity?.largeSmallSpreadPct == null
              ? '--'
              : `${signed(liquidity.largeSmallSpreadPct)}%`}
          </strong>
        </div>
        <div>
          <span>{isZh ? '同刻基线' : 'Baseline'}</span>
          <strong>{liquidity ? `${liquidity.baselineSessions}/20` : '--'}</strong>
        </div>
      </div>

      {lanes.length > 0 ? (
        <div className="ladder-seesaw-lanes">
          {lanes.map((lane) => (
            <article
              key={lane.id}
              className={`ladder-seesaw-lane ladder-seesaw-lane--${lane.state}`}
            >
              <header>
                <div>
                  <h3>{lane.label}</h3>
                  <span>{lane.state}</span>
                </div>
                <strong className="mono" aria-label={`${lane.label} research-score`}>
                  {lane.netResearchScore.toFixed(1)}
                </strong>
              </header>
              <dl>
                <div>
                  <dt>{isZh ? '美股映射' : 'US mapping'}</dt>
                  <dd>
                    {lane.id === 'hard-tech' || lane.id === 'innovative-drug'
                      ? signed(lane.externalShock)
                      : '--'}
                  </dd>
                </div>
                <div>
                  <dt>{isZh ? '昨日节律' : 'Cycle'}</dt>
                  <dd>{signed(lane.domesticCycle)}</dd>
                </div>
                <div>
                  <dt>{isZh ? '竞价确认' : 'Auction'}</dt>
                  <dd>{signed(lane.auctionConfirmation)}</dd>
                </div>
                <div>
                  <dt>{isZh ? '开盘确认' : 'Open'}</dt>
                  <dd>{signed(lane.openConfirmation)}</dd>
                </div>
                <div>
                  <dt>{isZh ? '流动性' : 'Liquidity'}</dt>
                  <dd>{signed(lane.liquidityAdjustment)}</dd>
                </div>
                <div>
                  <dt>{isZh ? '交互项' : 'Interaction'}</dt>
                  <dd>{signed(lane.interactionAdjustment)}</dd>
                </div>
              </dl>
              <p>{lane.reasons.join(' · ')}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="ladder-seesaw-missing">
          {isZh ? '资金通道层尚不可用。' : 'Capital lane layer is unavailable.'}
        </div>
      )}

      <div className="ladder-seesaw-transfers">
        <h3>{isZh ? '统计关联 / 资金偏移' : 'Statistical association / capital tilt'}</h3>
        {matrix?.transfers.length ? (
          matrix.transfers.map((transfer, index) => (
            <div key={`${transfer.from}:${transfer.to}:${index}`}>
              <strong>{transfer.label}</strong>
              <span>
                {laneLabels.get(transfer.from) ?? transfer.from} →{' '}
                {laneLabels.get(transfer.to) ?? transfer.to}
              </span>
              <b className="mono">{transfer.strength.toFixed(1)}</b>
              <em>{transfer.reasons.join(' · ')}</em>
            </div>
          ))
        ) : (
          <p>
            {isZh
              ? '当前未识别出满足完整证据门槛的资金偏移。'
              : 'No capital tilt meets the full evidence gate.'}
          </p>
        )}
      </div>

      {warnings.length > 0 && <div className="ladder-seesaw-warning">{warnings.join(' · ')}</div>}
    </section>
  )
}

function AuctionDirectionPanel({
  context,
  t,
}: {
  context: LadderAuctionContext
  t: Translation['ladder']
}) {
  const style = context.marketStyle
  return (
    <section className="ladder-auction-context" aria-label={t.v2.auctionDirection}>
      <header className="ladder-section-heading">
        <div>
          <h2>{t.v2.auctionDirection}</h2>
          <span>
            {context.snapshotCount}
            {t.v2.processSamples} · {t.v2.coverage} {context.coverage.toFixed(1)}%
          </span>
        </div>
        <div className="ladder-auction-style">
          <span>{t.v2.marketStyle}</span>
          <strong>{style?.label ?? t.v2.unavailable}</strong>
          {style?.score != null && <b className="mono">{style.score.toFixed(1)}</b>}
        </div>
      </header>

      <div className="ladder-auction-metrics">
        <div>
          <span>{t.v2.topFiveConcentration}</span>
          <strong>
            {style?.topFiveConcentrationPct == null
              ? '--'
              : `${style.topFiveConcentrationPct.toFixed(1)}%`}
          </strong>
        </div>
        <div>
          <span>{t.v2.weightedShare}</span>
          <strong>
            {style?.weightedSharePct == null ? '--' : `${style.weightedSharePct.toFixed(1)}%`}
          </strong>
        </div>
        <div>
          <span>{t.v2.confidence}</span>
          <strong>{style ? `${style.confidence.toFixed(0)}%` : '--'}</strong>
        </div>
        <div>
          <span>{t.v2.dataSources}</span>
          <strong>{context.sources.join(' / ') || '--'}</strong>
        </div>
      </div>

      <div className="ladder-auction-grid">
        <div className="ladder-auction-table-wrap">
          <h3>{t.v2.themeAuctionRank}</h3>
          <table className="ladder-auction-table">
            <thead>
              <tr>
                <th>{t.table.theme}</th>
                <th>{t.v2.directionState}</th>
                <th>{t.v2.score}</th>
                <th>{t.v2.positiveRate}</th>
                <th>{t.v2.weightedGap}</th>
                <th>{t.v2.coreAssist}</th>
              </tr>
            </thead>
            <tbody>
              {context.themes.slice(0, 8).map((theme) => (
                <tr key={theme.theme}>
                  <td>
                    <strong>{theme.theme}</strong>
                  </td>
                  <td>
                    <span className={`ladder-auction-state ladder-auction-state--${theme.state}`}>
                      {t.v2.auctionStates[theme.state]}
                    </span>
                  </td>
                  <td className="mono">{fmtScore(theme.score)}</td>
                  <td className="mono">
                    {theme.positiveRate == null ? '--' : `${theme.positiveRate.toFixed(1)}%`}
                  </td>
                  <td className="mono">
                    {theme.weightedGapPct == null ? '--' : `${theme.weightedGapPct.toFixed(1)}%`}
                  </td>
                  <td>
                    <strong>{theme.coreName || '--'}</strong>
                    <span>
                      {theme.assistantCount}
                      {t.v2.assists}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ladder-auction-top">
          <h3>{t.v2.topAuctionAmount}</h3>
          <ol>
            {context.topAmount.slice(0, 5).map((stock) => (
              <li key={stock.code}>
                <span>
                  <strong>{stock.name}</strong>
                  <small>{stock.industry || stock.code}</small>
                </span>
                <b className="mono">{fmtYi(stock.amount)}</b>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {context.warnings.length > 0 && (
        <div className="ladder-candidate-warning">{context.warnings.join(' · ')}</div>
      )}
    </section>
  )
}

function AuctionBriefPanel({
  state,
  error,
  t,
}: {
  state: AuctionBriefState | null
  error: string | null
  t: Translation['ladder']
}) {
  const deliveryByPhase = new Map(
    (state?.deliveries ?? []).map((delivery) => [delivery.phase, delivery]),
  )
  const channelState: NotificationDeliveryStatus = !state
    ? 'pending'
    : !state.notification.configured
      ? 'not-configured'
      : !state.notification.enabled
        ? 'disabled'
        : 'pending'
  const latestDelivery = state?.deliveries.length
    ? state.deliveries[state.deliveries.length - 1]
    : null
  const latestStatus: NotificationDeliveryStatus = latestDelivery?.status ?? channelState
  return (
    <section className="ladder-auction-briefs" aria-label={t.v2.auctionBriefs}>
      <header className="ladder-section-heading">
        <div>
          <h2>{t.v2.auctionBriefs}</h2>
          <span>{t.v2.auctionBriefSchedule}</span>
        </div>
        <div className="ladder-brief-channel">
          <span>Server酱</span>
          <strong>{t.v2.deliveryStates[latestStatus]}</strong>
        </div>
      </header>

      {error && <div className="ladder-candidate-warning">{error}</div>}
      {state?.briefs.length ? (
        <div className="ladder-brief-list">
          {state.briefs.map((brief) => {
            const delivery = deliveryByPhase.get(brief.phase)
            return (
              <article className="ladder-brief-item" key={brief.id}>
                <header>
                  <div>
                    <strong>{t.v2.briefPhases[brief.phase]}</strong>
                    <span>{new Date(brief.generatedAt).toLocaleTimeString('zh-CN')}</span>
                  </div>
                  <span
                    className={`ladder-delivery-state ladder-delivery-state--${delivery?.status ?? 'pending'}`}
                    title={delivery?.error || delivery?.providerMessage}
                  >
                    {t.v2.deliveryStates[delivery?.status ?? 'pending']}
                  </span>
                </header>
                <p>{brief.summary}</p>
                <dl>
                  <div>
                    <dt>{t.v2.strength}</dt>
                    <dd>
                      {brief.strengthLabel} · {fmtScore(brief.strengthScore)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t.v2.confidence}</dt>
                    <dd>{brief.confidence.toFixed(0)}%</dd>
                  </div>
                  <div>
                    <dt>{t.v2.direction}</dt>
                    <dd>{brief.primaryDirection}</dd>
                  </div>
                  <div>
                    <dt>{t.v2.generationMode}</dt>
                    <dd>{t.v2.generationModes[brief.generationMode]}</dd>
                  </div>
                </dl>
                {brief.newsCatalysts?.length ? (
                  <div className="ladder-overnight-news">
                    <div className="ladder-overnight-headline">
                      <strong>隔夜重要新闻</strong>
                      <span>
                        {brief.auctionConfirmedDirections?.length
                          ? `竞价确认：${brief.auctionConfirmedDirections.join('、')}`
                          : `预期方向：${(brief.expectedDirections ?? []).join('、') || '待验证'}`}
                      </span>
                    </div>
                    {brief.newsCatalysts.slice(0, 5).map((news) => (
                      <div className="ladder-overnight-card" key={news.id}>
                        <div className="ladder-overnight-title">
                          <strong>{news.title}</strong>
                          <span>
                            {news.category} · {news.verification} · {news.importanceScore}
                          </span>
                        </div>
                        <p>{news.impactPath}</p>
                        {news.relatedStocks.length > 0 && (
                          <div className="ladder-related-stocks">
                            {news.relatedStocks.map((stock) => (
                              <span
                                className={`ladder-related-stock ladder-related-stock--${stock.validationState}`}
                                key={`${news.id}-${stock.code}`}
                              >
                                <b>{stock.name}</b> <small>{stock.code}</small>
                                <em>{stock.validationState}</em>
                                <i>
                                  {stock.changePct == null
                                    ? '待竞价'
                                    : `${stock.changePct >= 0 ? '+' : ''}${stock.changePct.toFixed(2)}%`}
                                </i>
                                <span title={stock.relationReason}>{stock.relationReason}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                <details>
                  <summary>{t.v2.briefDetails}</summary>
                  <pre>{brief.renderedText}</pre>
                </details>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="ladder-candidate-empty">{t.v2.briefPending}</div>
      )}
    </section>
  )
}

function OutcomeReview({
  outcome,
  t,
}: {
  outcome: LadderOutcomeArchive
  t: Translation['ladder']
}) {
  const { formal, byLane, waitOpen } = outcome.summary
  return (
    <section className="ladder-outcome" aria-label={t.v2.outcomeReview}>
      <header className="ladder-section-heading">
        <div>
          <h2>{t.v2.outcomeReview}</h2>
          <span>{outcome.tradeDate}</span>
        </div>
        <div className="ladder-outcome-headline">
          <span>{t.v2.formalPromotionRate}</span>
          <strong>
            {formal.promotionRate == null ? '--' : `${formal.promotionRate.toFixed(1)}%`}
          </strong>
          <em>
            {formal.promoted}/{formal.valid} · {t.v2.coverage} {formal.coverage.toFixed(1)}%
          </em>
        </div>
      </header>

      <div className="ladder-outcome-lanes">
        {byLane.map((lane) => (
          <div key={lane.promotionLane}>
            <span>{lane.promotionLane}</span>
            <strong>
              {lane.promotionRate == null ? '--' : `${lane.promotionRate.toFixed(1)}%`}
            </strong>
            <small>
              {lane.promoted}/{lane.valid}
            </small>
          </div>
        ))}
        <div>
          <span>{t.v2.waitOpenRate}</span>
          <strong>
            {waitOpen.promotionRate == null ? '--' : `${waitOpen.promotionRate.toFixed(1)}%`}
          </strong>
          <small>
            {waitOpen.promoted}/{waitOpen.valid}
          </small>
        </div>
      </div>

      <div className="ladder-candidate-table-wrap">
        <table className="ladder-outcome-table">
          <thead>
            <tr>
              <th>{t.table.stock}</th>
              <th>{t.v2.population}</th>
              <th>{t.v2.lane}</th>
              <th>{t.v2.outcomeState}</th>
              <th>{t.v2.tradable}</th>
              <th>{t.v2.openClose}（标记）</th>
              <th>MFE</th>
              <th>MAE</th>
            </tr>
          </thead>
          <tbody>
            {outcome.rows.map((row) => (
              <tr key={`${row.population}-${row.code}`}>
                <td>
                  <strong>{row.name}</strong>
                  <span className="mono">{row.code}</span>
                </td>
                <td>{t.v2.populations[row.population]}</td>
                <td>
                  <strong>{row.promotionLane}</strong>
                </td>
                <td title={row.unresolvedReason}>
                  <span
                    className={`ladder-outcome-state ladder-outcome-state--${row.resultStatus}`}
                  >
                    {t.v2.outcomeStates[row.resultStatus]}
                  </span>
                </td>
                <td>{row.tradable == null ? '--' : row.tradable ? t.v2.yes : t.v2.no}</td>
                <td className="mono">
                  {(row.nextDayOpenToCloseMark ?? row.openToClosePct) == null
                    ? '--'
                    : `${(row.nextDayOpenToCloseMark ?? row.openToClosePct)?.toFixed(2)}%`}
                </td>
                <td className="mono">{row.mfePct == null ? '--' : `${row.mfePct.toFixed(2)}%`}</td>
                <td className="mono">{row.maePct == null ? '--' : `${row.maePct.toFixed(2)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function relayStatusLabel(status: NextDayRelayItem['themeFeedback']['status'], language: 'zh' | 'en'): string {
  if (language === 'en') {
    return {
      supportive: 'supportive',
      mixed: 'mixed',
      negative: 'negative',
      unavailable: 'unavailable',
    }[status]
  }
  return {
    supportive: '强化',
    mixed: '分化',
    negative: '转弱',
    unavailable: '不可用',
  }[status]
}

function relayRoleLabel(role: NextDayRelayItem['relayRole'], language: 'zh' | 'en'): string {
  if (language === 'en') {
    return {
      'relay-candidate': 'relay candidate',
      'theme-core-observer': 'theme core observer',
      'emotion-anchor': 'emotion anchor',
      'fallback-observer': 'fallback observer',
    }[role]
  }
  return {
    'relay-candidate': '可接力观察',
    'theme-core-observer': '板块核心观察',
    'emotion-anchor': '情绪/空间锚点',
    'fallback-observer': '补充观察',
  }[role]
}

function themeLadderRelationLabel(
  relation: NonNullable<LadderStockAnalysis['themeLadder']>['relation'],
): string {
  return {
    replenishment: '上方龙头·补涨',
    'leader-driven': '高标带动·有梯队',
    follower: '高标跟随',
    isolated: '未形成结构',
    unavailable: '数据不足',
  }[relation]
}

/**
 * Keep the relay decision trace in the same order as the operator checklist:
 * candidate strength → theme leadership → breadth/assist → extension.  It is
 * deliberately explanatory; execution eligibility remains fail-closed in the
 * server-side confirmation gates.
 */
function relayConfirmationTrace(
  stock: LadderStockAnalysis,
  live: NextDayCandidateConfirmation | undefined,
  language: 'zh' | 'en',
): string {
  if (!live) return language === 'zh' ? '待竞价/开盘快照：尚不能确认接力' : 'waiting for auction/open snapshot'
  if (live.inaccessible) return language === 'zh' ? '止步：一字或高开不可达，不接力' : 'stop: inaccessible one-price/high-gap board'
  if (live.openingConfirmationGate === 'blocked') {
    return language === 'zh'
      ? '竞价/分时不及预期 → 等待09:35量价翻红，不确认接力'
      : 'auction/intraday weak → wait for 09:35 price-volume rebound'
  }
  if (live.themePermission?.state === 'blocked') {
    return language === 'zh'
      ? '未能引领板块走强 → 小弟不助攻 → 不确认接力'
      : 'theme cannot strengthen → no assistant confirmation'
  }
  if (live.themePermission?.state === 'conditional') {
    return language === 'zh'
      ? '板块未形成单边行情 → 转低位补涨观察'
      : 'theme has not formed a one-sided move → observe low-level replenishment'
  }
  if (live.themePermission && !live.themePermission.independentStrength) {
    return language === 'zh'
      ? '核心带动/小弟助攻未同时成立 → 等待20/30cm或反包跟随'
      : 'core leadership/assistant breadth incomplete → wait for 20/30cm or reseal follow-through'
  }
  if (stock.themeLadder?.relation === 'isolated' || stock.themeLadder?.relation === 'unavailable') {
    return language === 'zh'
      ? '梯队未扩散：等待20/30cm或反包跟随，不确认接力'
      : 'no ladder expansion: wait for 20/30cm or reseal follow-through'
  }
  if (live.state === 'confirmed' || live.state === 'auction-qualified') {
    return language === 'zh'
      ? '封单/加速 → 板块走强 → 梯队扩散，研究确认'
      : 'acceleration → theme strength → ladder expansion, research confirmed'
  }
  return language === 'zh'
    ? '等待：继续核对核心强度、小弟助攻与梯队扩散'
    : 'waiting: verify leader strength, assistants, and ladder expansion'
}

function NextDayRelayPlanPanel({
  plan,
  language,
}: {
  plan: NextDayRelayPlan
  language: 'zh' | 'en'
}) {
  const zh = language === 'zh'
  const feedbackLabel = (label: string, feedback: NextDayRelayItem['themeFeedback']) => (
    <div className="ladder-relay-feedback">
      <strong>{label}</strong>
      <span className={'ladder-relay-status ladder-relay-status--' + feedback.status}>
        {relayStatusLabel(feedback.status, language)}
      </span>
      <small>{feedback.evidence[0] ?? (zh ? '等待本阶段数据' : 'waiting for current-stage data')}</small>
      {feedback.related.length > 0 && (
        <small>
          {(zh ? '关联：' : 'Related: ') +
            feedback.related.slice(0, 3).map((related) => related.name).join('、')}
        </small>
      )}
    </div>
  )
  return (
    <section className="ladder-relay-plan" aria-label={zh ? '次日接力计划' : 'Next-day relay plan'}>
      <header className="ladder-section-heading">
        <div>
          <h2>{zh ? '次日接力计划' : 'Next-day relay plan'}</h2>
          <span>
            research-score · {zh ? '研究排序，不代表概率或交易指令' : 'research ranking; not probability or instruction'}
          </span>
        </div>
        <div className="ladder-stage">
          <span>{zh ? '数据阶段' : 'Stage'}</span>
          <strong>{plan.stage}</strong>
          <small>{plan.tradeDate || '--'}</small>
        </div>
      </header>
      {plan.warnings.length > 0 && (
        <div className="ladder-candidate-warning">{plan.warnings.join(' · ')}</div>
      )}
      <div className="ladder-relay-grid">
        {plan.items.slice(0, 12).map((item) => (
          <article
            key={item.code}
            className="ladder-relay-card"
            data-testid={'relay-plan-item-' + item.code}
            data-stage={plan.stage}
            data-execution-eligible={item.executionEligible ? 'true' : 'false'}
          >
            <div className="ladder-relay-card__heading">
              <div>
                <strong>{item.name}</strong>
                <span className="mono">{item.code} · {item.boards}板 · {item.promotionLane}</span>
              </div>
              <div className="ladder-relay-card__badges">
                <span className="ladder-relay-role">{relayRoleLabel(item.relayRole, language)}</span>
                <span className="ladder-relay-priority">P{item.researchPriority}</span>
              </div>
            </div>
            <div className="ladder-relay-card__meta">
              <span>{item.primaryTheme} → {item.researchTheme}</span>
              <strong className={item.executionEligible ? 'is-eligible' : 'is-ineligible'}>
                {item.executionEligible
                  ? (zh ? '严格闸门通过（研究展示）' : 'strict gate passed (research)')
                  : (zh ? '不可执行/仅观察' : 'observation only')}
              </strong>
            </div>
            <div className="ladder-relay-feedback-grid">
              {feedbackLabel(zh ? '同板块高标' : 'Theme leaders', item.themeFeedback)}
              {feedbackLabel(zh ? '同身位梯队' : 'Same lane', item.sameLevelFeedback)}
            </div>
            <details>
              <summary>{zh ? '确认条件 / 失效条件 / 不追价原因' : 'Confirmation / invalidation / no-chase'}</summary>
              <div className="ladder-relay-details">
                <div><b>{zh ? '确认' : 'Confirm'}：</b>{item.confirmationConditions.join('；')}</div>
                <div><b>{zh ? '实战闸门' : 'Execution gate'}：</b>{(item.executionGateReasons ?? []).join('；') || (zh ? '全部通过（研究展示）' : 'all passed (research)')}</div>
                <div><b>{zh ? '失效' : 'Invalidate'}：</b>{item.invalidationReasons.join('；') || '--'}</div>
                <div><b>{zh ? '不追价' : 'No chase'}：</b>{item.noChaseReasons.join('；') || '--'}</div>
              </div>
            </details>
          </article>
        ))}
      </div>
    </section>
  )
}
function candidateDataBlock(
  analysis: LimitLadderAnalysis & { formalSignalEligible?: boolean },
  language: 'zh' | 'en',
): { reasons: string[]; warnings: string[] } | null {
  const quality = analysis.quality
  const eligibility = quality as typeof quality & { formalSignalEligible?: boolean }
  const zh = language === 'zh'
  const reasons: string[] = []
  if (quality.degraded) reasons.push(zh ? '整体数据质量已降级' : 'Overall data quality is degraded')
  if (!analysis.archived) reasons.push(zh ? '收盘归档尚未完成' : 'The close archive is not complete')
  if (analysis.formalSignalEligible === false || eligibility.formalSignalEligible === false) {
    reasons.push(zh ? '归档尚未达到正式信号条件' : 'The archive is not eligible for formal signals')
  }
  if (quality.sentimentStatus && quality.sentimentStatus !== 'full') {
    reasons.push(zh ? `情绪数据不完整：${quality.sentimentStatus}` : `Sentiment data is incomplete: ${quality.sentimentStatus}`)
  }
  if (!quality.limitFieldsComplete) {
    reasons.push(zh ? '正式归档股票的板数或封板时间不完整' : 'Board counts or seal times are incomplete in the formal archive universe')
  }
  if (quality.klineTotal <= 0 || quality.klineComplete !== quality.klineTotal) {
    reasons.push(zh ? `正式归档股票K线覆盖不完整：${quality.klineComplete}/${quality.klineTotal}` : `K-line coverage in the formal archive universe is incomplete: ${quality.klineComplete}/${quality.klineTotal}`)
  }
  if (quality.settled === false) reasons.push(zh ? 'K线尚未完成收盘定盘' : 'K-lines are not settled')
  if (quality.providerAt === null) reasons.push(zh ? '缺少可信K线来源时间（providerAt）' : 'Trusted K-line provider time (providerAt) is missing')
  if (!reasons.length) return null
  // Optional fields may be absent in legacy archives. Explain their absence only
  // once an explicit quality/eligibility failure has established the block.
  if (quality.providerAt === undefined) reasons.push(zh ? '缺少可信K线来源时间（providerAt）' : 'Trusted K-line provider time (providerAt) is missing')
  return { reasons, warnings: Array.from(new Set(quality.warnings)) }
}

function NextDayCandidates({
  candidates,
  confirmations,
  relayItems,
  dataDate,
  stage,
  snapshotAvailable,
  warning,
  resultAvailable,
  dataBlock,
  onImportManualReviews,
  manualReviewMessage,
  t,
  language,
  onSelect,
}: {
  candidates: LadderStockAnalysis[]
  confirmations: Map<string, NextDayCandidateConfirmation>
  relayItems?: Map<string, NextDayRelayItem>
  dataDate?: string
  stage: 'pending' | 'auction' | 'open' | 'settled'
  snapshotAvailable: boolean | null
  warning: string
  resultAvailable: boolean
  dataBlock: ReturnType<typeof candidateDataBlock>
  onImportManualReviews: () => void
  manualReviewMessage: string
  t: Translation['ladder']
  language: 'zh' | 'en'
  onSelect: (stock: LadderStockAnalysis) => void
}) {
  return (
    <section className="ladder-candidates" aria-label={t.v2.candidates}>
      <header className="ladder-section-heading">
        <div>
          <h2>{t.v2.candidates}</h2>
          <span>{t.v2.candidateScope}</span>
        </div>
        <div className="ladder-stage">
          <button type="button" className="ladder-manual-review-button" onClick={onImportManualReviews}>
            截图补录 JSON
          </button>
          <span>{t.v2.stage}</span>
          <strong>{t.v2.stages[stage]}</strong>
          {snapshotAvailable === false && (stage === 'open' || stage === 'settled') && (
            <em>{t.v2.auctionSnapshotMissing}</em>
          )}
          {manualReviewMessage && <small>{manualReviewMessage}</small>}
        </div>
      </header>
      {warning && <div className="ladder-candidate-warning">{warning}</div>}
      {candidates.length ? (
        <div className="ladder-candidate-table-wrap">
          <table className="ladder-candidate-table">
            <thead>
              <tr>
                <th>{t.table.rank}</th>
                <th>{t.table.stock}</th>
                <th>{t.v2.lane}</th>
                <th>{t.table.theme}</th>
                <th>题材梯队</th>
                <th>截图复核</th>
                <th>最终复核分</th>
                <th>研究定位</th>
                <th>反馈/阶段</th>
                <th>接力确认流程</th>
                <th>{t.v2.dragonIdentity}</th>
                <th>{t.v6.sizeBucket}</th>
                <th>{t.v2.promotionScore}</th>
                <th>{t.v2.tradabilityScore}</th>
                <th>{t.v2.baseScore}</th>
                <th>{t.v2.auctionScore}</th>
                <th>{t.v2.openScore}</th>
                <th>{t.v2.liveScore}</th>
                <th>{t.v5.environmentAdjustment}</th>
                <th>{t.v6.liquidityStyleAdjustment}</th>
                <th>{t.v5.decisionScore}</th>
                <th>{t.v5.themePermissions}</th>
                <th>{t.v2.turnover}</th>
                <th>{t.table.state}</th>
              </tr>
            </thead>
            <tbody>
              {candidates.slice(0, 10).map((stock, index) => {
                const live = confirmations.get(stock.code)
                const research = relayItems?.get(stock.code)
                const nextState = live?.state ?? 'pending'
                return (
                  <tr key={stock.code} onClick={() => onSelect(stock)}>
                    <td className="mono">{stock.candidateRank ?? index + 1}</td>
                    <td>
                      <strong>{stock.name}</strong>
                      <span className="mono">{stock.code}</span>
                    </td>
                    <td>
                      <strong>{stock.promotionLane ?? '--'}</strong>
                      <span>
                        {stock.consecutiveDays}
                        {t.boards}
                      </span>
                    </td>
                    <td>
                      <span className={'ladder-theme ladder-theme--' + stock.themeGrade}>
                        {stock.primaryTheme}
                      </span>
                    </td>
                    <td
                      title={stock.themeLadder
                        ? [...stock.themeLadder.evidence, ...stock.themeLadder.missingReasons].join(' · ')
                        : '缺少题材梯队关系证据'}
                    >
                      {stock.themeLadder ? (
                        <>
                          <strong>{themeLadderRelationLabel(stock.themeLadder.relation)}</strong>
                          <span className="ladder-cell-subtext">
                            {stock.themeLadder.bonus > 0 ? `结构 +${stock.themeLadder.bonus.toFixed(1)}` : '结构 +0'}
                          </span>
                        </>
                      ) : (
                        <span className="ladder-cell-subtext">--</span>
                      )}
                    </td>
                    <td
                      title={live?.manualReview?.missingReasons.join(' · ') ?? '尚未补录截图证据'}
                    >
                      {live?.manualReview ? (
                        <>
                          <strong>
                            {live.manualReview.status === 'reviewed'
                              ? '已复核'
                              : live.manualReview.status === 'partial'
                                ? '部分'
                                : '待补录'}
                          </strong>
                          <span className="ladder-cell-subtext">
                            覆盖 {live.manualReview.coveragePct.toFixed(0)}%
                          </span>
                        </>
                      ) : (
                        <span className="ladder-cell-subtext">待截图</span>
                      )}
                    </td>
                    <td className="mono score-live">
                      {live?.manualReview?.finalScore == null
                        ? '--'
                        : live.manualReview.finalScore.toFixed(1)}
                      {live?.manualReview?.provisionalScore != null &&
                        live.manualReview.finalScore == null && (
                          <span className="ladder-cell-subtext">
                            临时 {live.manualReview.provisionalScore.toFixed(1)}
                          </span>
                        )}
                    </td>
                    <td>
                      <span>{research ? relayRoleLabel(research.relayRole, 'zh') : '--'}</span>
                      <span className="ladder-cell-subtext">
                        {research ? 'P' + research.researchPriority : '--'}
                      </span>
                    </td>
                    <td title={research ? [...research.researchReasons, ...(research.executionGateReasons ?? [])].join(' · ') : undefined}>
                      {research
                        ? [
                            research.themeFeedback.status,
                            research.sameLevelFeedback.status,
                          ].join(' / ')
                        : '--'}
                      <span className="ladder-cell-subtext">
                        {(dataDate || '--') + ' · ' + stage}
                      </span>
                    </td>
                    <td title={[...(live?.gateReasons ?? []), ...(live?.warnings ?? [])].join(' · ')}>
                      <span>{relayConfirmationTrace(stock, live, language)}</span>
                    </td>
                    <td
                      className="mono score-base"
                      title={[
                        stock.dragonIdentity?.verdict ?? 'insufficient-data',
                        ...(stock.dragonIdentity?.hardGate.failed ?? []),
                        ...(stock.dragonIdentity?.evidence ?? []),
                      ].join(' · ')}
                    >
                      {stock.dragonIdentity ? stock.dragonIdentity.score.toFixed(1) : '--'}
                      <span className="ladder-cell-subtext">
                        {stock.dragonIdentity?.verdict === 'true-dragon'
                          ? '真龙'
                          : stock.dragonIdentity?.verdict === 'core'
                            ? '核心'
                            : stock.dragonIdentity?.verdict === 'follower'
                              ? '跟风'
                              : '数据不足'}
                      </span>
                    </td>
                    <td>
                      {live?.sizeBucket
                        ? t.v6.sizeBuckets[live.sizeBucket]
                        : t.v6.sizeBuckets.unknown}
                    </td>
                    <td className="mono score-promotion">{fmtScore(stock.promotionScore)}</td>
                    <td className="mono score-tradability">{fmtScore(stock.tradabilityScore)}</td>
                    <td className="mono score-base">{fmtScore(stock.baseScore ?? stock.score)}</td>
                    <td className="mono">{fmtScore(live?.auctionScore)}</td>
                    <td className="mono">{fmtScore(live?.openScore)}</td>
                    <td className="mono score-live">{fmtScore(live?.liveScore)}</td>
                    <td className="mono">
                      {live?.environmentAdjustment == null
                        ? '--'
                        : `${live.environmentAdjustment >= 0 ? '+' : ''}${live.environmentAdjustment.toFixed(1)}`}
                    </td>
                    <td className="mono" title={(live?.styleGateReasons ?? []).join(' · ')}>
                      {live?.liquidityStyleAdjustment == null
                        ? '--'
                        : `${live.liquidityStyleAdjustment >= 0 ? '+' : ''}${live.liquidityStyleAdjustment.toFixed(1)}`}
                    </td>
                    <td
                      className="mono score-live"
                      title={[
                        live?.openingGapAdjustment
                          ? `开盘脆弱性调整 ${live.openingGapAdjustment >= 0 ? '+' : ''}${live.openingGapAdjustment.toFixed(1)}`
                          : '',
                        live?.auctionTailBonus
                          ? `9:24翘尾抢筹 ${live.auctionTailBonus >= 0 ? '+' : ''}${live.auctionTailBonus.toFixed(1)}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    >
                      {fmtScore(live?.decisionScore)}
                    </td>
                    <td title={live?.themePermission?.reasons.join(' · ')}>
                      {live?.themePermission
                        ? t.v5.permissionStates[live.themePermission.state]
                        : '--'}
                    </td>
                    <td className="mono">
                      {stock.turnoverCapacity?.effectiveTurnoverPct == null
                        ? '--'
                        : `${stock.turnoverCapacity.effectiveTurnoverPct.toFixed(1)}%`}
                    </td>
                    <td
                      title={[...(live?.gateReasons ?? []), ...(live?.warnings ?? [])].join(' · ')}
                    >
                      <NextDayStateBadge state={nextState} t={t} />
                      {live && (
                        <span className="ladder-cell-subtext">
                          {language === 'zh'
                            ? `${live.researchConfirmed ? '研究确认' : '研究观察'} · ${live.executionEligible ? '执行许可' : '不可执行'}`
                            : `${live.researchConfirmed ? 'research confirmed' : 'research only'} · ${live.executionEligible ? 'execution eligible' : 'not executable'}`}
                        </span>
                      )}
                      {live?.openingConfirmationGate === 'blocked' && (
                        <span className="ladder-cell-subtext">
                          {language === 'zh'
                            ? '低/平开 · 等9:35量价翻红'
                            : 'low/flat auction · wait for 09:35 rebound'}
                        </span>
                      )}
                      {live?.openingConfirmationGate === 'passed' && (
                        <span className="ladder-cell-subtext">
                          {language === 'zh'
                            ? `低/平开后9:35量价翻红${live.auctionTailBuyConfirmed ? ' · 9:24翘尾加分' : ''}`
                            : `09:35 rebound after low/flat${live.auctionTailBuyConfirmed ? ' · 09:24 tail bonus' : ''}`}
                        </span>
                      )}
                      {live?.openingConfirmationGate !== 'passed' &&
                        live?.auctionTailBuyConfirmed && (
                          <span className="ladder-cell-subtext">
                            {language === 'zh' ? '9:24翘尾抢筹 · 已加分' : '09:24 tail buying · bonus added'}
                          </span>
                        )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : dataBlock ? (
        <div className="ladder-candidate-empty">
          <strong>{language === 'zh' ? '数据质量阻断，正式候选未生成' : 'Data quality blocks formal candidate generation'}</strong>
          <ul>{dataBlock.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          {dataBlock.warnings.length > 0 && (
            <details>
              <summary>{language === 'zh' ? '其他数据提示（含观察池及可选数据缺口，不全部属于正式候选阻断）' : 'Other data notes (including observation and optional gaps; not all block formal candidates)'}</summary>
              <ul>{dataBlock.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </details>
          )}
        </div>
      ) : resultAvailable ? (
        <div className="ladder-candidate-empty">{t.v2.candidateEmpty}</div>
      ) : null}
    </section>
  )
}

function FirstBoardScanPanel({
  scan,
  error,
  t,
}: {
  scan: FirstBoardScanResponse | null
  error: string | null
  t: Translation['ladder']
}) {
  const dimensionLabels: Record<string, string> = {
    market: '市场',
    theme: '题材',
    seal: '封板',
    structure: '结构',
    'price-volume': '量价',
    wyckoff: '维科夫代理',
    brooks: 'Brooks代理',
  }
  const lifecycleLabels: Record<string, string> = {
    detected: '发现',
    sealed: '仍封板',
    opened: '炸板/离开',
    resealed: '回封',
    'closed-limit': '收盘封住',
    failed: '收盘未封',
  }
  const categoryLabels: Record<string, string> = {
    focus: '重点观察',
    observe: '观察',
    'low-priority': '低优先',
    'data-insufficient': '数据不足',
  }
  const status = scan?.status ?? 'unavailable'
  const statusLabel = t.firstBoardScan.statuses[status]
  const emptyMessage = status === 'live'
    ? t.firstBoardScan.empty
    : status === 'unavailable'
      ? t.firstBoardScan.unavailableEmpty
      : t.firstBoardScan.closedEmpty
  const lastScan = scan?.lastScanAt
    ? new Date(scan.lastScanAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '--:--'
  const snapshots = scan?.snapshots ?? []
  return (
    <section className="ladder-first-board-scan" aria-label={t.firstBoardScan.title}>
      <header className="ladder-section-heading">
        <div>
          <h2>{t.firstBoardScan.title}</h2>
          <span>{t.firstBoardScan.subtitle}</span>
        </div>
        <div className={`ladder-first-board-status ladder-first-board-status--${status}`}>
          <span>{scan?.tradeDate ?? '--'}</span>
          <strong>{statusLabel}</strong>
        </div>
      </header>

      {scan && (
        <div className="ladder-first-board-metrics">
          <div>
            <span>{t.firstBoardScan.window}</span>
            <strong>
              {scan.window.start}–{scan.window.end} · {scan.window.intervalMinutes}{' '}
              {t.firstBoardScan.minutes}
            </strong>
          </div>
          <div>
            <span>{t.firstBoardScan.scanCount}</span>
            <strong>{scan.scanCount}</strong>
          </div>
          <div>
            <span>{t.firstBoardScan.newCount}</span>
            <strong>{(scan.allCandidates ?? scan.candidates).length}</strong>
            <small>全量合格池</small>
          </div>
          <div>
            <span>展示 / 合格池</span>
            <strong>{scan.candidates.length} / {(scan.allCandidates ?? scan.candidates).length}</strong>
          </div>
          <div>
            <span>{t.firstBoardScan.lastScan}</span>
            <strong>{lastScan}</strong>
          </div>
          <div>
            <span>{t.firstBoardScan.stExcluded}</span>
            <strong>{scan.excludedStCount}</strong>
          </div>
        </div>
      )}

      {error && <div className="ladder-candidate-warning">{error}</div>}
      {scan?.warnings.length ? (
        <div className="ladder-candidate-warning">{scan.warnings.join(' · ')}</div>
      ) : null}
      {scan && scan.dataQuality !== 'full' && (
        <div className="ladder-candidate-warning">
          数据质量：{scan.dataQuality} · 来源：{scan.source} · 研究观察，不构成交易许可
        </div>
      )}
      {scan && (
        <div className="ladder-candidate-warning">
          研究状态：{scan.strategyStatus ?? 'research'} · Top10 仅为展示截面，不能作为策略池截断
        </div>
      )}

      {scan?.candidates.length ? (
        <div className="ladder-first-board-grid">
          {scan.candidates.map((candidate) => (
            <article className="ladder-first-board-card" key={candidate.code}>
                <header>
                  <div>
                    <strong>{candidate.name}</strong>
                    <span className="mono">{candidate.code}</span>
                  </div>
                  <div className="ladder-first-board-score">
                    <b className="mono">{candidate.selectionScore ?? candidate.discoveryScore.finalScore ?? '--'}</b>
                    <small>{categoryLabels[candidate.discoveryScore.category]}</small>
                  </div>
                </header>
                <div className="ladder-first-board-tags">
                  <span>{candidate.primaryTheme || '其他'}</span>
                  <span>{candidate.reason}</span>
                  <span>{lifecycleLabels[candidate.lifecycle] ?? candidate.lifecycle}</span>
                  <span>{candidate.evidenceStatus}</span>
                  <span>
                    {candidate.themeLadder?.state === 'complete'
                      ? `完整梯队补涨 +${candidate.themeLadder.bonus}`
                      : '板块非入池门槛'}
                  </span>
                </div>
                <div className="ladder-first-board-score-meta">
                  <span>涨幅 +{candidate.changePct.toFixed(2)}%</span>
                  <span>覆盖 {(candidate.discoveryScore.coverage * 100).toFixed(0)}%</span>
                  <span>开板 {candidate.openCount} 次</span>
                  <span>可成交 {candidate.tradability.status}</span>
                  <span>形态/量价优先</span>
                </div>
                {candidate.relayPathScore && (
                  <div className="ladder-first-board-score-meta">
                    <span>
                      路径研究分 {candidate.relayPathScore.pathResearchScore ?? '--'}
                    </span>
                    <span>
                      路径覆盖 {(candidate.relayPathScore.pathCoverage != null
                        ? candidate.relayPathScore.pathCoverage
                        : (candidate.relayPathEvidence?.coverage?.overall ?? 0) * 100).toFixed(0)}%
                    </span>
                    <span>{candidate.relayPathEvidence?.boardClass ?? '路径分型未知'}</span>
                    {(candidate.relayPathScore.failedConditions?.length ?? 0) > 0 && (
                      <span title={candidate.relayPathScore.failedConditions?.join(' · ')}>存在路径失败条件</span>
                    )}
                  </div>
                )}
                <div className="ladder-first-board-dimensions">
                  {candidate.discoveryScore.dimensions.map((dimension) => (
                    <span key={dimension.key} title={dimension.evidence.join(' · ') || dimension.unavailableReason}>
                      {dimensionLabels[dimension.key]} {dimension.score == null ? '--' : dimension.score.toFixed(0)}
                    </span>
                  ))}
                </div>
                <dl>
                <div>
                  <dt>{t.firstBoardScan.firstSeal}</dt>
                  <dd className="mono">{fmtTime(candidate.firstTime)}</dd>
                </div>
                <div>
                  <dt>{t.firstBoardScan.turnover}</dt>
                  <dd className="mono">
                    {candidate.turnoverRate > 0 ? `${candidate.turnoverRate.toFixed(2)}%` : '--'}
                  </dd>
                </div>
                <div>
                  <dt>{t.firstBoardScan.amount}</dt>
                  <dd className="mono">{fmtYi(candidate.amount)}</dd>
                </div>
                <div>
                  <dt>{t.firstBoardScan.price}</dt>
                  <dd className="mono">{candidate.price.toFixed(2)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <div className="ladder-candidate-empty">
          {emptyMessage}
        </div>
      )}

      {snapshots.length > 0 && (
        <div className="ladder-first-board-timeline">
          {snapshots.map((snapshot) => (
            <span key={snapshot.observationKey}>
              {snapshot.scannedAt.slice(11, 16)} · +{snapshot.newCount}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function StockCard({
  stock,
  t,
  onSelect,
}: {
  stock: LadderStockAnalysis
  t: Translation['ladder']
  onSelect: (stock: LadderStockAnalysis) => void
}) {
  const isChiNext = /^(300|301)/.test(stock.code)
  return (
    <button
      type="button"
      className={`ladder-stock ladder-stock--${stock.state}`}
      onClick={() => onSelect(stock)}
      title={`${stock.name} · ${stock.nDayBoards} · ${t.states[stock.state]} · ${stock.score}`}
    >
      <div className="ladder-stock-meta">
        <span className="ladder-stock-flags">
          {stock.isMarginEligible && (
            <span className="ladder-flag ladder-flag--margin">{t.badges.margin}</span>
          )}
          {isChiNext && (
            <span className="ladder-flag ladder-flag--chinext">{t.badges.chiNext}</span>
          )}
          {stock.onePrice && (
            <span className="ladder-flag ladder-flag--one">{t.badges.onePrice}</span>
          )}
          {stock.tBoard && <span className="ladder-flag ladder-flag--t">{t.badges.tBoard}</span>}
        </span>
        <span className="ladder-first-time mono">
          {t.firstSealShort}
          {fmtTime(stock.firstTime)}
        </span>
      </div>
      <strong>{stock.name}</strong>
      <span className="ladder-stock-code mono">{stock.code}</span>
      <span className="ladder-stock-themes">
        {stock.themes.slice(0, 2).map((theme, index) => (
          <span
            className={`ladder-theme ${index === 0 ? `ladder-theme--${stock.themeGrade}` : ''}`}
            key={theme}
          >
            {theme}
          </span>
        ))}
      </span>
    </button>
  )
}

function EvidenceDrawer({
  stock,
  date,
  t,
  language,
  onClose,
}: {
  stock: LadderStockAnalysis
  date: string
  t: Translation['ladder']
  language: 'zh' | 'en'
  onClose: () => void
}) {
  const { detail, loading: reasonLoading, error: reasonError } = useLadderReason(stock.code, date)
  const { detail: hithinkAnomaly, loading: anomalyLoading, error: anomalyError } = useHithinkAnomaly(stock.code)
  const reason = detail?.reason || stock.reason
  const extraExplanation =
    detail?.explanation && !reason.includes(detail.explanation) ? detail.explanation : ''
  const reasonParagraphs = reason
    .split(/\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const dimensions = [
    ['market', t.detail.market],
    ['theme', t.detail.theme],
    ['ladder', t.detail.ladder],
    ['technical', t.detail.technical],
    ['fundFlow', t.detail.fundFlow],
    ['seal', t.detail.seal],
  ] as const
  const promotionDimensions = stock.v2
    ? ([
        ['market', t.detail.market],
        ['lane', t.v2.factorLane],
        ['theme', t.detail.theme],
        ['popularity', t.v2.factorPopularity],
        ['seal', t.detail.seal],
        ['technical', t.detail.technical],
      ] as const)
    : []
  const tradabilityDimensions = stock.v2
    ? ([
        ['accessibility', t.v2.factorAccessibility],
        ['turnoverCapacity', t.v2.factorTurnoverCapacity],
        ['liquidity', t.v2.factorLiquidity],
        ['structure', t.v2.factorStructure],
        ['reopen', t.v2.factorReopen],
      ] as const)
    : []
  return (
    <div
      className="ladder-drawer-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="ladder-drawer" aria-label={t.detail.title}>
        <header className="ladder-drawer-header">
          <div>
            <div className="ladder-drawer-titleline">
              <h2>{stock.name}</h2>
              <StateBadge state={stock.state} t={t} />
            </div>
            <span className="mono">
              {stock.code} · {stock.consecutiveDays}
              {t.boards} · {t.roles[stock.role]}
            </span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title={t.detail.close}>
            <X size={18} />
          </button>
        </header>

        {stock.v2 ? (
          <div className="ladder-drawer-score-grid">
            <div>
              <span>{t.v2.promotionScore}</span>
              <strong>{fmtScore(stock.promotionScore)}</strong>
            </div>
            <div>
              <span>{t.v2.tradabilityScore}</span>
              <strong>{fmtScore(stock.tradabilityScore)}</strong>
            </div>
            <div>
              <span>{t.v2.baseScore}</span>
              <strong>{fmtScore(stock.baseScore)}</strong>
            </div>
          </div>
        ) : (
          <div className="ladder-drawer-score">
            <span>{t.detail.score}</span>
            <strong>{stock.score}</strong>
          </div>
        )}

        {stock.roleProfile && (
          <section className="ladder-role-profile-detail">
            <strong>{t.v4.marketRoles[stock.roleProfile.marketRole]}</strong>
            <span>{t.v4.themeRoles[stock.roleProfile.themeRole]}</span>
            <span>{t.v4.heightTiers[stock.roleProfile.heightTier]}</span>
            <span>{t.v4.lifecycles[stock.roleProfile.lifecycle]}</span>
            <small>{stock.roleProfile.evidence.join(' · ')}</small>
          </section>
        )}

        {stock.expectation && (
          <ExpectationPanel expectation={stock.expectation} t={t} language={language} />
        )}

        {stock.relayPathScore && (
          <section className="ladder-expectation-panel">
            <div className="ladder-section-heading">
              <div>
                <h3>1～N板来时路（研究影子分）</h3>
                <span>{stock.relayPathEvidence?.boardClass ?? '分型未知'} · {stock.relayPathEvidence?.quality ?? '质量未知'}</span>
              </div>
              <strong>{stock.relayPathScore.pathResearchScore ?? '--'}</strong>
            </div>
            <div className="ladder-expectation-grid">
              <div><span>路径覆盖</span><strong>{stock.relayPathScore.pathCoverage ?? '--'}</strong></div>
              <div><span>数据置信</span><strong>{stock.relayPathScore.dataConfidence ?? '--'}</strong></div>
              <div><span>概率状态</span><strong>{stock.relayPathScore.probabilityStatus ?? 'research-score'}</strong></div>
            </div>
            {(stock.relayPathScore.failedConditions?.length ?? 0) > 0 && (
              <p className="ladder-expectation-missing">{stock.relayPathScore.failedConditions?.join(' · ')}</p>
            )}
            {(stock.relayPathEvidence?.missingReasons?.length ?? 0) > 0 && (
              <p className="ladder-expectation-missing">{stock.relayPathEvidence?.missingReasons?.join(' · ')}</p>
            )}
          </section>
        )}

        <section className="ladder-evidence">
          <h3>{stock.v2 ? t.v2.legacyEvidence : t.detail.evidence}</h3>
          {dimensions.map(([key, label]) => {
            const evidence = stock.dimensions[key]
            if (!evidence) return null
            return (
              <div className="ladder-evidence-row" key={key}>
                <span>{label}</span>
                <div className="ladder-evidence-track">
                  <span style={{ width: `${evidence.score}%` }} />
                </div>
                <strong className="mono">{Math.round(evidence.score)}</strong>
                <small>{evidence.note}</small>
              </div>
            )
          })}
        </section>

        {stock.v2 && (
          <section className="ladder-v2-evidence">
            <div>
              <h3>{t.v2.promotionEvidence}</h3>
              {promotionDimensions.map(([key, label]) => {
                const evidence = stock.v2?.promotionDimensions[key]
                if (!evidence) return null
                return (
                  <div className="ladder-factor-row" key={key}>
                    <span>{label}</span>
                    <div className="ladder-evidence-track">
                      <span style={{ width: `${evidence.score}%` }} />
                    </div>
                    <strong className="mono">{fmtScore(evidence.score)}</strong>
                    <small>{evidence.note}</small>
                  </div>
                )
              })}
            </div>
            <div>
              <h3>{t.v2.tradabilityEvidence}</h3>
              {tradabilityDimensions.map(([key, label]) => {
                const evidence = stock.v2?.tradabilityDimensions[key]
                if (!evidence) return null
                return (
                  <div className="ladder-factor-row" key={key}>
                    <span>{label}</span>
                    <div className="ladder-evidence-track">
                      <span style={{ width: `${evidence.score}%` }} />
                    </div>
                    <strong className="mono">{fmtScore(evidence.score)}</strong>
                    <small>{evidence.note}</small>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <section className="ladder-detail-metrics">
          <div>
            <span>{t.detail.amountRatio}</span>
            <strong>{fmtRatio(stock.technical.amountRatio20)}</strong>
          </div>
          <div>
            <span>{t.detail.range20}</span>
            <strong>{fmtRatio(stock.technical.pre20RangePct, '%')}</strong>
          </div>
          <div>
            <span>{t.detail.position120}</span>
            <strong>{fmtRatio(stock.technical.prePosition120Pct, '%')}</strong>
          </div>
          <div>
            <span>{t.detail.episodeReturn}</span>
            <strong>{fmtRatio(stock.technical.episodeReturnPct, '%')}</strong>
          </div>
          <div>
            <span>{t.detail.onset}</span>
            <strong className="mono">{stock.technical.episodeOnsetDate ?? '--'}</strong>
          </div>
          <div>
            <span>{t.table.shape}</span>
            <strong>{t.shapes[stock.technical.shape]}</strong>
          </div>
          {stock.turnoverCapacity && (
            <>
              <div>
                <span>{t.v2.floatCap}</span>
                <strong>{fmtYi(stock.turnoverCapacity.circulatingMarketCap ?? 0)}</strong>
              </div>
              <div>
                <span>{t.v2.amountFloatRatio}</span>
                <strong>
                  {stock.turnoverCapacity.amountToFloatCapPct == null
                    ? '--'
                    : `${stock.turnoverCapacity.amountToFloatCapPct.toFixed(2)}%`}
                </strong>
              </div>
              <div>
                <span>{t.v2.effectiveTurnover}</span>
                <strong>
                  {stock.turnoverCapacity.effectiveTurnoverPct == null
                    ? '--'
                    : `${stock.turnoverCapacity.effectiveTurnoverPct.toFixed(2)}%`}
                </strong>
              </div>
              <div>
                <span>{t.v2.amountPercentile}</span>
                <strong>P{Math.round(stock.turnoverCapacity.amountPercentile)}</strong>
              </div>
            </>
          )}
          {stock.popularity && (
            <>
              <div>
                <span>{t.v2.popularity}</span>
                <strong>{fmtScore(stock.popularity.score)}</strong>
              </div>
              <div>
                <span>{t.v2.followers}</span>
                <strong>{stock.popularity.followerCount}</strong>
              </div>
            </>
          )}
        </section>

        <section className="ladder-action-band ladder-action-band--trigger">
          <span>{t.detail.trigger}</span>
          <p>{stock.trigger}</p>
        </section>
        <section className="ladder-action-band ladder-action-band--risk">
          <span>{t.detail.invalidation}</span>
          <p>{stock.invalidation}</p>
        </section>

        {(stock.penalties.length > 0 ||
          stock.warnings.length > 0 ||
          (stock.gateReasons?.length ?? 0) > 0) && (
          <section className="ladder-drawer-notes">
            {stock.penalties.length > 0 && (
              <div>
                <strong>{t.detail.penalty}</strong>
                <p>{stock.penalties.join(' · ')}</p>
              </div>
            )}
            {stock.warnings.length > 0 && (
              <div>
                <strong>{t.detail.warnings}</strong>
                <p>{stock.warnings.join(' · ')}</p>
              </div>
            )}
            {(stock.gateReasons?.length ?? 0) > 0 && (
              <div>
                <strong>{t.v4.riskRadar}</strong>
                <p>{stock.gateReasons?.join(' · ')}</p>
              </div>
            )}
          </section>
        )}

        <section className="ladder-reason-detail">
          <header>
            <h3>{t.detail.limitReason}</h3>
            {(detail || stock.reasonSource !== 'none') && <span>{t.detail.kaipanlaSource}</span>}
          </header>
          <div className="ladder-reason-themes">
            {stock.themes.slice(0, 6).map((theme) => (
              <span key={theme}>{theme}</span>
            ))}
          </div>
          {reasonLoading && <div className="ladder-reason-loading">{t.detail.reasonLoading}</div>}
          {reasonParagraphs.length > 0 ? (
            <div className="ladder-reason-copy">
              {reasonParagraphs.map((paragraph, index) => (
                <p key={`${index}-${paragraph}`}>{paragraph}</p>
              ))}
              {extraExplanation && <p>{extraExplanation}</p>}
            </div>
          ) : !reasonLoading ? (
            <p className="ladder-reason-empty">{reasonError || t.detail.reasonUnavailable}</p>
          ) : null}
          {(detail?.marketRole || detail?.hotReason) && (
            <dl className="ladder-reason-signals">
              {detail.marketRole && (
                <div>
                  <dt>{t.detail.marketRole}</dt>
                  <dd>{detail.marketRole}</dd>
                </div>
              )}
              {detail.hotReason && (
                <div>
                  <dt>{t.detail.hotReason}</dt>
                  <dd>{detail.hotReason}</dd>
                </div>
              )}
            </dl>
          )}
        </section>

        <section className="ladder-reason-detail">
          <header>
            <h3>{language === 'zh' ? '同花顺异动原因' : 'Tonghuashun anomaly reason'}</h3>
            <span>{language === 'zh' ? '当日最新 · 研究参考' : 'latest today · research only'}</span>
          </header>
          {anomalyLoading && <div className="ladder-reason-loading">{language === 'zh' ? '正在读取同花顺异动原因…' : 'Loading anomaly reason…'}</div>}
          {hithinkAnomaly ? (
            <div className="ladder-reason-copy">
              {hithinkAnomaly.tagName && <p><strong>{hithinkAnomaly.tagName}</strong></p>}
              {hithinkAnomaly.content && <p>{hithinkAnomaly.content}</p>}
              {hithinkAnomaly.keywords.length > 0 && (
                <div className="ladder-reason-themes">
                  {hithinkAnomaly.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
                </div>
              )}
            </div>
          ) : !anomalyLoading ? (
            <p className="ladder-reason-empty">
              {anomalyError || (language === 'zh' ? '当前暂无同花顺异动原因' : 'No current anomaly reason')}
            </p>
          ) : null}
        </section>
      </aside>
    </div>
  )
}

export default function LadderView({ t, language }: LadderViewProps) {
  const copy = t.ladder
  const [date, setDate] = useState(getLastSettledTradingDay)
  const [mode, setMode] = useState<ViewMode>('single')
  const [selectedThemes, setSelectedThemes] = useState<Set<string>>(new Set())
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('all')
  const [heightFilter, setHeightFilter] = useState('all')
  const [selectedStock, setSelectedStock] = useState<LadderStockAnalysis | null>(null)
  const [importMessage, setImportMessage] = useState('')
  const [manualReviewMessage, setManualReviewMessage] = useState('')
  const [liveRefreshKey, setLiveRefreshKey] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const manualReviewFileRef = useRef<HTMLInputElement>(null)
  const { dates: ladderArchiveDates } = useLadderArchiveDates()
  const { dates: tradingCalendarDates } = useTradingCalendarDates()
  const { data, loading, error, refresh, importData } = useLadderAnalysis(date)
  // The server freezes a settled ladder. Keep its dependent selections stable
  // after close; manual refresh remains available through liveRefreshKey.
  const pollLiveLadder = data?.archived === false
  const { data: firstBoardScan, error: firstBoardScanError } = useFirstBoardScan(
    date,
    mode === 'single',
    liveRefreshKey,
    pollLiveLadder,
  )
  const isResearchLadder = /^limit-ladder-v[23456]$/.test(data?.ruleVersion ?? '')
  const supportsNextDayReview = /^limit-ladder-v[123456]$/.test(data?.ruleVersion ?? '')
  const { data: nextDay, error: nextDayError, saveManualReviews } = useLadderNextDay(
    date,
    supportsNextDayReview,
    liveRefreshKey,
    pollLiveLadder,
  )
  const { data: auctionBriefs, error: auctionBriefError } = useAuctionBriefs(
    date,
    /^limit-ladder-v[3456]$/.test(data?.ruleVersion ?? ''),
    liveRefreshKey,
    pollLiveLadder,
  )
  const crossMarketPhase: CrossMarketPhase =
    nextDay?.stage === 'open' || nextDay?.stage === 'settled'
      ? 'open'
      : nextDay?.stage === 'auction' || nextDay?.auctionSnapshotAvailable
        ? 'auction'
        : 'premarket'
  const { data: crossMarket, error: crossMarketError } = useCrossMarketSnapshot(
    nextDay?.tradeDate ?? '',
    crossMarketPhase,
    mode === 'single' && supportsNextDayReview && !!nextDay?.tradeDate,
    liveRefreshKey,
    false,
  )
  const { dates: allTradingDates } = useTradingDates()
  const calendarTradingDates = useMemo(() => {
    const settledThrough = getLastSettledTradingDay()
    const dates = new Set(
      [...allTradingDates, ...ladderArchiveDates, ...tradingCalendarDates]
        .filter((tradingDate) => tradingDate <= settledThrough),
    )
    // The money-flow/archive endpoints are data-availability lists, not a
    // trading calendar. Keep the recent calendar navigable when archives lag;
    // selecting a date with no archive must still render unavailable rather
    // than silently falling back to an older ladder.
    // Only use the weekday fallback while the independent calendar endpoint
    // has no result; never re-add dates that an injected holiday calendar has
    // explicitly excluded.
    if (tradingCalendarDates.size === 0) {
      for (const tradingDate of recentWeekdaysThrough(settledThrough)) dates.add(tradingDate)
    }
    // The latest settled date may not be present in a lagging upstream calendar
    // yet. Keep it visible/selectable so an unavailable current date is shown
    // explicitly instead of silently falling back to an older archive.
    dates.add(date)
    return dates
  }, [allTradingDates, date, ladderArchiveDates, tradingCalendarDates])

  const filteredStocks = useMemo(() => {
    if (!data) return []
    return data.stocks.filter((stock) => {
      if (selectedThemes.size && !stock.themes.some((theme) => selectedThemes.has(theme)))
        return false
      if (stateFilter !== 'all' && stock.state !== stateFilter) return false
      if (boardFilter === 'main' && stock.boardType !== 'main') return false
      if (boardFilter === 'twenty' && stock.boardType !== 'twenty') return false
      if (heightFilter !== 'all' && stock.consecutiveDays !== Number(heightFilter)) return false
      return true
    })
  }, [boardFilter, data, heightFilter, selectedThemes, stateFilter])

  const ladderLevels = useMemo(() => {
    const levels = new Map<number, LadderStockAnalysis[]>()
    for (const stock of filteredStocks.filter((item) => item.consecutiveDays >= 2)) {
      levels.set(stock.consecutiveDays, [...(levels.get(stock.consecutiveDays) ?? []), stock])
    }
    return Array.from(levels.entries()).sort(([a], [b]) => b - a)
  }, [filteredStocks])
  const firstBoards = filteredStocks.filter((stock) => stock.consecutiveDays === 1)
  const confirmationMap = useMemo(
    () => new Map((nextDay?.candidates ?? []).map((candidate) => [candidate.code, candidate])),
    [nextDay],
  )
  const orderedNextDayCandidates = useMemo(() => {
    const base = data?.nextDayCandidates ?? []
    if (!nextDay?.candidates.length) return base
    const byCode = new Map(base.map((stock) => [stock.code, stock]))
    const ordered = nextDay.candidates
      .map((candidate) => byCode.get(candidate.code))
      .filter((stock): stock is LadderStockAnalysis => !!stock)
    const seen = new Set(ordered.map((stock) => stock.code))
    return [...ordered, ...base.filter((stock) => !seen.has(stock.code))]
  }, [data, nextDay])

  const toggleTheme = (name: string) => {
    setSelectedThemes((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const payload = await parseImportFile(file, date)
      if (!payload.stocks.length) throw new Error(copy.empty)
      const ok = await importData(payload)
      setImportMessage(ok ? copy.importOk : copy.importFail)
    } catch (err) {
      setImportMessage(`${copy.importFail}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleManualReviewImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const raw = JSON.parse(await file.text()) as Partial<NextDayManualReviewPayload> | NextDayManualReviewPayload
      const payload: NextDayManualReviewPayload = {
        signalDate: String(raw.signalDate ?? date),
        reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
      }
      if (payload.signalDate !== date) {
        throw new Error(`文件信号日${payload.signalDate}与当前页面${date}不一致`)
      }
      if (!payload.reviews.length) throw new Error('reviews 不能为空')
      await saveManualReviews(payload)
      setManualReviewMessage(`已保存${payload.reviews.length}只截图复核，正在刷新最终分`)
      setLiveRefreshKey((current) => current + 1)
    } catch (err) {
      setManualReviewMessage(`截图复核导入失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleRefresh = async () => {
    await refresh()
    setLiveRefreshKey((current) => current + 1)
  }

  const archiveUnavailable = Boolean(error && error.startsWith('未找到'))

  return (
    <div className="ladder-page" lang={language === 'zh' ? 'zh-CN' : 'en'}>
      <section className="ladder-toolbar">
        <div className="ladder-mode" role="tablist">
          {(['single', 'list'] as ViewMode[]).map((value) => (
            <button
              key={value}
              type="button"
              className={mode === value ? 'active' : ''}
              onClick={() => setMode(value)}
              role="tab"
              aria-selected={mode === value}
            >
              {copy[value]}
            </button>
          ))}
        </div>
        <div className="ladder-market-strip">
          {data && (
            <>
              <span className={`ladder-phase ladder-phase--${data.market.cycle.phase}`}>
                {copy.phases[data.market.cycle.phase]}
              </span>
              <span>
                {copy.limitUp} <b>{data.market.limitUp ?? '—'}</b>
              </span>
              <span>
                {copy.limitDown} <b>{data.market.limitDown ?? '—'}</b>
              </span>
              <span>
                {copy.breakRate}{' '}
                <b>{data.market.breakRate == null ? '—' : `${data.market.breakRate.toFixed(1)}%`}</b>
              </span>
              <span>
                {copy.promotionRate}{' '}
                <b>{data.market.promotionRate == null ? '—' : `${data.market.promotionRate.toFixed(1)}%`}</b>
              </span>
              <span>
                {copy.maxBoards}{' '}
                <b>
                  {data.market.maxBoards}
                  {copy.boards}
                </b>
              </span>
            </>
          )}
        </div>
        <div className="ladder-toolbar-actions">
          <div className="ladder-date">
            <span>{copy.date}</span>
            <MarketDatePicker
              selectedDate={date}
              onSelect={setDate}
              onRefresh={() => void handleRefresh()}
              t={t}
              availableDates={calendarTradingDates}
            />
          </div>
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            accept=".csv,.json"
            onChange={handleImport}
          />
          <input
            ref={manualReviewFileRef}
            className="sr-only"
            type="file"
            accept=".json"
            onChange={handleManualReviewImport}
          />
          <button
            type="button"
            className="icon-button"
            onClick={() => fileRef.current?.click()}
            title={copy.import}
          >
            <FileArrowUp size={18} />
          </button>
        </div>
      </section>

      {importMessage && <div className="ladder-notice">{importMessage}</div>}
      {data?.warnings.length ? (
        <div className="ladder-quality-warning">{data.warnings.join(' · ')}</div>
      ) : null}

      {mode === 'single' && (
        <PremarketWorkbench refreshKey={liveRefreshKey} crossMarket={crossMarket} />
      )}

      {mode === 'single' && (
        <FirstBoardScanPanel
          scan={firstBoardScan}
          error={firstBoardScanError}
          t={copy}
        />
      )}

      {mode === 'single' && nextDay?.marketGate && (
        <MarketGatePanel gate={nextDay.marketGate} t={copy} />
      )}

      {mode === 'single' && (nextDay?.sentimentQuant ?? data?.sentimentQuant) && (
        <SentimentQuantPanel
          snapshot={(nextDay?.sentimentQuant ?? data?.sentimentQuant) as LadderSentimentQuantSnapshot}
          t={copy}
          language={language}
        />
      )}

      {mode === 'single' && (
        <CapitalSeesawPanel snapshot={crossMarket} error={crossMarketError} language={language} />
      )}

      {mode === 'single' &&
        /^limit-ladder-v[456]$/.test(data?.ruleVersion ?? '') &&
        data?.eventGate && <RiskRadarPanel gate={data.eventGate} t={copy} />}

      {mode === 'single' && isResearchLadder && data?.promotionLanes && (
        <PromotionLaneStrip
          lanes={data.promotionLanes}
          statistics={data.promotionStatistics}
          t={copy}
        />
      )}

      {mode === 'single' &&
        /^limit-ladder-v[456]$/.test(data?.ruleVersion ?? '') &&
        data?.roleMap && <RoleMapPanel roleMap={data.roleMap} t={copy} />}

      {mode === 'single' && isResearchLadder && nextDay?.auctionContext && (
        <AuctionDirectionPanel context={nextDay.auctionContext} t={copy} />
      )}

      {mode === 'single' && nextDay?.highBoardContext && (
        <HighBoardRiskPanel
          context={nextDay.highBoardContext}
          reaction={nextDay.eventReaction}
          t={copy}
        />
      )}

      {mode === 'single' && /^limit-ladder-v[3456]$/.test(data?.ruleVersion ?? '') && (
        <AuctionBriefPanel state={auctionBriefs} error={auctionBriefError} t={copy} />
      )}

      {mode === 'single' && supportsNextDayReview && nextDay?.outcome && (
        <OutcomeReview outcome={nextDay.outcome} t={copy} />
      )}

      {mode === 'single' && isResearchLadder && nextDay?.relayPlan && (
        <NextDayRelayPlanPanel plan={nextDay.relayPlan} language={language} />
      )}

      {mode === 'single' && isResearchLadder && data && (
        <NextDayCandidates
          candidates={orderedNextDayCandidates}
          confirmations={confirmationMap}
          relayItems={new Map((nextDay?.relayPlan?.items ?? []).map((item) => [item.code, item]))}
          dataDate={nextDay?.tradeDate}
          stage={nextDay?.stage ?? 'pending'}
          snapshotAvailable={nextDay ? nextDay.auctionSnapshotAvailable : null}
          warning={[nextDayError, ...(nextDay?.warnings ?? [])].filter(Boolean).join(' · ')}
          resultAvailable={!!nextDay}
          dataBlock={candidateDataBlock(data, language)}
          onImportManualReviews={() => manualReviewFileRef.current?.click()}
          manualReviewMessage={manualReviewMessage}
          t={copy}
          language={language}
          onSelect={setSelectedStock}
        />
      )}

      {data && (
        <section className="ladder-theme-strip" aria-label={copy.allThemes}>
          <button
            type="button"
            className={selectedThemes.size === 0 ? 'active' : ''}
            onClick={() => setSelectedThemes(new Set())}
          >
            {copy.allThemes} {data.stocks.length}
          </button>
          {data.themes.map((theme) => (
            <button
              type="button"
              key={theme.name}
              className={`${selectedThemes.has(theme.name) ? 'active ' : ''}grade-${theme.grade}`}
              onClick={() => toggleTheme(theme.name)}
            >
              {theme.name} {theme.count}
            </button>
          ))}
        </section>
      )}

      {loading && !data && <div className="ladder-loading">{copy.loading}</div>}
      {error && !data && (
        <div className={`ladder-error${archiveUnavailable ? ' ladder-error--unavailable' : ''}`}>
          <strong>{archiveUnavailable ? copy.archiveUnavailable : copy.loadFail}</strong>
          {archiveUnavailable && <span>{copy.archiveUnavailableHint}</span>}
          <span>{error}</span>
        </div>
      )}

      {data && mode === 'single' && (
        <section className="ladder-board">
          {ladderLevels.map(([boards, stocks]) => (
            <div className="ladder-level" key={boards}>
              <div className="ladder-level-rail">
                <span>{boards}</span>
              </div>
              <div className="ladder-level-track">
                {stocks.map((stock) => (
                  <StockCard key={stock.code} stock={stock} t={copy} onSelect={setSelectedStock} />
                ))}
              </div>
            </div>
          ))}
          <div className="ladder-first-title">
            <FlagBanner size={16} />
            <strong>
              {copy.firstBoard} ({firstBoards.length})
            </strong>
          </div>
          <div className="ladder-first-grid">
            {firstBoards.map((stock) => (
              <StockCard key={stock.code} stock={stock} t={copy} onSelect={setSelectedStock} />
            ))}
          </div>
          {!filteredStocks.length && <div className="ladder-empty">{copy.empty}</div>}
        </section>
      )}

      {data && mode === 'list' && (
        <section className="ladder-list">
          <div className="ladder-list-filters">
            <label>
              {copy.filters.state}
              <select
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value as StateFilter)}
              >
                <option value="all">{copy.filters.all}</option>
                {STATE_ORDER.map((state) => (
                  <option key={state} value={state}>
                    {copy.states[state]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.filters.board}
              <select
                value={boardFilter}
                onChange={(event) => setBoardFilter(event.target.value as BoardFilter)}
              >
                <option value="all">{copy.filters.all}</option>
                <option value="main">{copy.filters.main}</option>
                <option value="twenty">{copy.filters.twenty}</option>
              </select>
            </label>
            <label>
              {copy.filters.height}
              <select
                value={heightFilter}
                onChange={(event) => setHeightFilter(event.target.value)}
              >
                <option value="all">{copy.filters.all}</option>
                {Array.from(new Set(data.stocks.map((stock) => stock.consecutiveDays)))
                  .sort((a, b) => b - a)
                  .map((height) => (
                    <option key={height} value={height}>
                      {height}
                      {copy.boards}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="ladder-table-wrap">
            <table className="ladder-table">
              <thead>
                <tr>
                  <th>{copy.table.rank}</th>
                  <th>{copy.table.state}</th>
                  <th>{copy.table.stock}</th>
                  <th>{copy.filters.height}</th>
                  <th>{copy.table.role}</th>
                  <th>{copy.table.theme}</th>
                  <th>{copy.table.shape}</th>
                  <th>{copy.table.volume}</th>
                  <th>{copy.table.position}</th>
                  <th>{copy.table.firstSeal}</th>
                  <th>{copy.table.opens}</th>
                  <th>{copy.table.trigger}</th>
                  <th>{copy.table.risk}</th>
                </tr>
              </thead>
              <tbody>
                {filteredStocks.map((stock) => (
                  <tr key={stock.code} onClick={() => setSelectedStock(stock)}>
                    <td className="mono">{stock.rank}</td>
                    <td>
                      <StateBadge state={stock.state} t={copy} />
                    </td>
                    <td>
                      <strong>{stock.name}</strong>
                      <span className="mono">{stock.code}</span>
                    </td>
                    <td>
                      {stock.consecutiveDays}
                      {copy.boards}
                    </td>
                    <td>{copy.roles[stock.role]}</td>
                    <td>
                      <span className={`ladder-theme ladder-theme--${stock.themeGrade}`}>
                        {stock.primaryTheme}
                      </span>
                    </td>
                    <td>{copy.shapes[stock.technical.shape]}</td>
                    <td className="mono">{fmtRatio(stock.technical.amountRatio20)}</td>
                    <td className="mono">{fmtRatio(stock.technical.prePosition120Pct, '%')}</td>
                    <td className="mono">{fmtTime(stock.firstTime)}</td>
                    <td className="mono">{stock.openCount}</td>
                    <td>{stock.trigger}</td>
                    <td>{stock.mainRisk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data && (
        <footer className="ladder-footer">
          <span>
            {copy.source}: {data.quality.source}
          </span>
          <span>
            {copy.quality}: {data.quality.klineComplete}/{data.quality.klineTotal}
          </span>
          {data.quality.degraded && <span>{copy.degraded}</span>}
          {data.archived && <span>{copy.archived}</span>}
          <span className="mono">{data.ruleVersion}</span>
          <span>{fmtYi(data.stocks.reduce((sum, stock) => sum + stock.amount, 0))}</span>
        </footer>
      )}

      {selectedStock && (
        <EvidenceDrawer
          stock={selectedStock}
          date={date}
          t={copy}
          language={language}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </div>
  )
}
