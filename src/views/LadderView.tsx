import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import Papa from 'papaparse'
import { FileArrowUp, FlagBanner, X } from 'phosphor-react'
import {
  useAuctionBriefs,
  useLadderAnalysis,
  useLadderNextDay,
  useLadderReason,
  type AuctionBriefState,
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
  type NextDayCandidateConfirmation,
  type NextDayState,
  type LadderState,
  type LadderStockAnalysis,
  type PromotionLane,
  type PromotionStatistics,
} from '../hooks/useLadderAnalysis'
import MarketDatePicker from '../components/MarketDatePicker'
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
            <h3>{t.v5.overnightContext}</h3>
            {us.map((row) => (
              <span key={row.code}>
                {row.name}{' '}
                <b className={row.changePct < 0 ? 'down' : 'up'}>{row.changePct.toFixed(2)}%</b>
              </span>
            ))}
          </div>
          <div>
            <h3>{t.v5.asiaContext}</h3>
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
                          <span>{news.category} · {news.verification} · {news.importanceScore}</span>
                        </div>
                        <p>{news.impactPath}</p>
                        {news.relatedStocks.length > 0 && (
                          <div className="ladder-related-stocks">
                            {news.relatedStocks.map((stock) => (
                              <span className={`ladder-related-stock ladder-related-stock--${stock.validationState}`} key={`${news.id}-${stock.code}`}>
                                <b>{stock.name}</b> <small>{stock.code}</small>
                                <em>{stock.validationState}</em>
                                <i>{stock.changePct == null ? '待竞价' : `${stock.changePct >= 0 ? '+' : ''}${stock.changePct.toFixed(2)}%`}</i>
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
              <th>{t.v2.openClose}</th>
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
                  {row.openToClosePct == null ? '--' : `${row.openToClosePct.toFixed(2)}%`}
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

function NextDayCandidates({
  candidates,
  confirmations,
  stage,
  snapshotAvailable,
  warning,
  t,
  onSelect,
}: {
  candidates: LadderStockAnalysis[]
  confirmations: Map<string, NextDayCandidateConfirmation>
  stage: 'pending' | 'auction' | 'open' | 'settled'
  snapshotAvailable: boolean | null
  warning: string
  t: Translation['ladder']
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
          <span>{t.v2.stage}</span>
          <strong>{t.v2.stages[stage]}</strong>
          {snapshotAvailable === false && (stage === 'open' || stage === 'settled') && (
            <em>{t.v2.auctionSnapshotMissing}</em>
          )}
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
                      <span className={`ladder-theme ladder-theme--${stock.themeGrade}`}>
                        {stock.primaryTheme}
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
                    <td className="mono score-live">{fmtScore(live?.decisionScore)}</td>
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ladder-candidate-empty">{t.v2.candidateEmpty}</div>
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
  onClose,
}: {
  stock: LadderStockAnalysis
  date: string
  t: Translation['ladder']
  onClose: () => void
}) {
  const { detail, loading: reasonLoading, error: reasonError } = useLadderReason(stock.code, date)
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
  const [liveRefreshKey, setLiveRefreshKey] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const { data, loading, error, refresh, importData } = useLadderAnalysis(date)
  const isResearchLadder = /^limit-ladder-v[23456]$/.test(data?.ruleVersion ?? '')
  const supportsNextDayReview = /^limit-ladder-v[123456]$/.test(data?.ruleVersion ?? '')
  const { data: nextDay, error: nextDayError } = useLadderNextDay(
    date,
    supportsNextDayReview,
    liveRefreshKey,
  )
  const { data: auctionBriefs, error: auctionBriefError } = useAuctionBriefs(
    date,
    /^limit-ladder-v[3456]$/.test(data?.ruleVersion ?? ''),
    liveRefreshKey,
  )
  const { dates: allTradingDates } = useTradingDates()
  const recentTradingDates = useMemo(() => {
    const settledThrough = getLastSettledTradingDay()
    return new Set(
      Array.from(allTradingDates)
        .filter((tradingDate) => tradingDate <= settledThrough)
        .slice(0, 5),
    )
  }, [allTradingDates])
  const latestSettled = recentTradingDates.values().next().value as string | undefined

  useEffect(() => {
    if (latestSettled && !recentTradingDates.has(date)) setDate(latestSettled)
  }, [date, latestSettled, recentTradingDates])

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

  const handleRefresh = async () => {
    await refresh()
    setLiveRefreshKey((current) => current + 1)
  }

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
                {copy.limitUp} <b>{data.market.limitUp}</b>
              </span>
              <span>
                {copy.limitDown} <b>{data.market.limitDown}</b>
              </span>
              <span>
                {copy.breakRate} <b>{data.market.breakRate.toFixed(1)}%</b>
              </span>
              <span>
                {copy.promotionRate} <b>{data.market.promotionRate.toFixed(1)}%</b>
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
              availableDates={recentTradingDates.size ? recentTradingDates : new Set([date])}
            />
          </div>
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            accept=".csv,.json"
            onChange={handleImport}
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

      {mode === 'single' && nextDay?.marketGate && (
        <MarketGatePanel gate={nextDay.marketGate} t={copy} />
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

      {mode === 'single' && isResearchLadder && data && (
        <NextDayCandidates
          candidates={orderedNextDayCandidates}
          confirmations={confirmationMap}
          stage={nextDay?.stage ?? 'pending'}
          snapshotAvailable={nextDay ? nextDay.auctionSnapshotAvailable : null}
          warning={[nextDayError, ...(nextDay?.warnings ?? [])].filter(Boolean).join(' · ')}
          t={copy}
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
        <div className="ladder-error">
          <strong>{copy.loadFail}</strong>
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
          onClose={() => setSelectedStock(null)}
        />
      )}
    </div>
  )
}
