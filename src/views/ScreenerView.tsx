import { useState, useCallback } from 'react'
import { ArrowClockwise, Lightning, Crosshair, CheckCircle, Trophy, TrendUp, Binoculars, Fire, Coins, FlagBanner, Stack } from 'phosphor-react'
import {
  useScreener,
  type ScreenerCandidate,
  type PullbackScreenerCandidate,
  type HighDivScreenerCandidate,
  type VolBreakScreenerCandidate,
  type FundResScreenerCandidate,
  type BHoldScreenerCandidate,
  type TrendNewScreenerCandidate,
  type TrendWatchScreenerCandidate,
  type AccumScreenerCandidate,
  type TechnicalCombo,
  type ScreenerRegime,
} from '../hooks/useScreener'
import { useScreenerForward } from '../hooks/useScreenerForward'
import { useMarketStructure } from '../hooks/useMarketStructure'
import { useDailyReview } from '../hooks/useDailyReview'
import { useFundResonanceBoard, type FundResonanceBoardRow } from '../hooks/useFundResonanceBoard'
import { useOrgSurveyBoard, type OrgSurveyBoardRow } from '../hooks/useOrgSurveyBoard'
import TrackRecordPanel from './TrackRecordPanel'
import { isPostCloseReview } from '../utils/marketStatus'
import type { Translation } from '../types'

interface ScreenerViewProps {
  t: Translation
  language: 'zh' | 'en'
}

/** A-share convention: red = up, green = down. */
function colorClass(n: number | null | undefined): string {
  if (n == null || n === 0) return ''
  return n > 0 ? 'positive-text' : 'negative-text'
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}
function fmtPrice(n: number): string {
  return n.toFixed(2)
}
/** 元 → 亿(主力净流入展示)。 */
function fmtYi(n: number): string {
  return `${(n / 1e8).toFixed(2)}亿`
}

/** 龙虎榜徽标:机构/游资拆成两个独立标签(各跟天数,如「机构1」「游资2」)。
 *  机构=金、游资=紫;都无但在榜→「净买」兜底。明细(含净买天数)留在 tooltip。 */
function lhbBadges(l: NonNullable<ScreenerCandidate['lhbInst']>, k: Translation['screener']['card']) {
  const title = `${k.lhbInst} ${l.instDays}${k.lhbDays} · ${k.lhbHot} ${l.hotDays}${k.lhbDays} · ${k.lhbNet} ${l.onDays}${k.lhbDays}`
  const out: { label: string; cls: string; title: string }[] = []
  if (l.instDays > 0) out.push({ label: `${k.lhbInst}${l.instDays}`, cls: 'sc-badge lhb inst', title })
  if (l.hotDays > 0) out.push({ label: `${k.lhbHot}${l.hotDays}`, cls: 'sc-badge lhb hot', title })
  if (out.length === 0 && l.onDays > 0) out.push({ label: k.lhbNet, cls: 'sc-badge lhb', title })
  return out
}

/** 枢轴位两行(压力 R1/R2、支撑 S1/S2)。 */
function PivotRows({ p, k }: { p: NonNullable<ScreenerCandidate['pivots']>; k: Translation['screener']['card'] }) {
  return (
    <>
      <div className="sc-metric">
        <span className="sc-metric-label">{k.pivR} R1/R2</span>
        <span className="sc-metric-value mono">
          {fmtPrice(p.r1)} / {fmtPrice(p.r2)}
        </span>
      </div>
      <div className="sc-metric">
        <span className="sc-metric-label">{k.pivS} S1/S2</span>
        <span className="sc-metric-value mono">
          {fmtPrice(p.s1)} / {fmtPrice(p.s2)}
        </span>
      </div>
    </>
  )
}

function RegimeBanner({ r, t }: { r: ScreenerRegime; t: Translation }) {
  const rt = t.screener.regime
  const label = rt[r.phase]
  return (
    <div className={`sc-regime sc-regime--${r.phase}`}>
      <span className="sc-regime-tag">{label}</span>
      <span className="sc-regime-stats">
        {rt.temp} {r.temperature} · {rt.limitUp} {r.limitUp} · {rt.breakRate} {r.breakRate}%
        {' · '}
        {rt.market} {rt[r.marketTrend]} · {rt.targetR} {r.targetRMult}R
        {r.marketChgPct != null && (
          <>
            {' · '}
            {rt.marketChg} <span className={colorClass(r.marketChgPct)}>{fmtPct(r.marketChgPct)}</span>
          </>
        )}
      </span>
      <span className="sc-regime-note">{r.note}</span>
    </div>
  )
}

/** 技术分析组合(Wyckoff+道氏+AlBrooks)chip:bias 着色 + distribution ⚠;全卡片复用。tooltip 给阶段+信号。 */
function TaChip({ ta, t }: { ta?: TechnicalCombo; t: Translation }) {
  if (!ta) return null
  const k = t.screener.ta
  const label = ta.bias === 'demand' ? k.demand : ta.bias === 'supply' ? k.supply : k.neutral
  const cls = ta.bias === 'demand' ? 'sc-chip ok' : ta.bias === 'supply' ? 'sc-chip hot' : 'sc-chip'
  const title = `${k.title}: ${ta.wyckoffPhase} · ${ta.note}${ta.tags.length ? ' · ' + ta.tags.join(' · ') : ''}`
  return (
    <>
      {ta.distribution && (
        <span className="sc-chip hot" title={title}>
          ⚠ {k.distribution}
        </span>
      )}
      <span className={cls} title={title}>
        {k.title} {label}
      </span>
    </>
  )
}

/** 卡片右上角:分数 + 左侧「连续出现天数」小药丸(N≥2 才显示)。三类卡片复用。 */
function StreakScore({ c, k }: { c: { appearStreak?: number; score: number }; k: Translation['screener']['card'] }) {
  const streak = c.appearStreak
  return (
    <div className="sc-card-right">
      {streak != null && streak >= 2 && (
        <span className={`sc-streak${streak >= 5 ? ' hot' : ''}`} title={k.appearStreakTip.replace('{n}', String(streak))}>
          {k.appearStreak.replace('{n}', String(streak))}
        </span>
      )}
      <span className="sc-score" title={k.score}>
        {Math.round(c.score)}
      </span>
    </div>
  )
}

/** 基准按板块选展示文案:300/301(创业板)→ 相对创业板、688(科创板)→ 相对科创50、其余 → 相对大盘。 */
function benchmarkLabel(code: string, k: Translation['screener']['card']): string {
  if (code.startsWith('300') || code.startsWith('301')) return k.relStrChinext
  if (code.startsWith('688')) return k.relStrStar
  return k.relStr
}

/** 相对大盘强度徽标:个股−基准指数 当日涨跌幅(pp);暴跌日逆势红盘(counterTrend)红色高亮「逆势强」。 */
function RelStrBadge({ c, k }: { c: { code: string; relStrength?: number; counterTrend?: boolean }; k: Translation['screener']['card'] }) {
  if (c.relStrength == null) return null
  const sign = c.relStrength >= 0 ? '+' : ''
  return (
    <div className={`sc-relstr${c.counterTrend ? ' sc-countertrend' : ''}`}>
      {c.counterTrend && '🔴 '}
      {benchmarkLabel(c.code, k)} <span className="mono">{sign}{c.relStrength.toFixed(1)}pp</span>
      {c.counterTrend && ` · ${k.counterTrend}`}
    </div>
  )
}

function Card({ c, t, tag, variant }: { c: ScreenerCandidate; t: Translation; tag?: string; variant?: 'watch' }) {
  const k = t.screener.card
  const s = c.signals
  // 突破组:介入(突破日收盘)→ 加仓(金字塔+1R,高于介入);扳机/观察组:试探(现价)→ 加主仓(突破位)。
  const isBreakout = c.group === 'breakout'
  const entryLabel = isBreakout ? k.entry : k.probe
  const addLabel = isBreakout ? k.add : k.addMain
  const entryVal = c.entry ?? c.price
  const addVal = c.add ?? (isBreakout ? undefined : c.pivot)
  const lvlTip = isBreakout ? k.entryTip : k.probeTip
  return (
    <div className={`sc-card${variant === 'watch' ? ' sc-card--watch' : ''}`}>
      <div className="sc-card-top">
        <div className="sc-card-id">
          <span className="sc-card-name">{c.name}</span>
          <span className="sc-card-code">{c.code}</span>
          {tag && <span className="sc-card-tag">{tag}</span>}
        </div>
        <StreakScore c={c} k={k} />
      </div>

      <div className="sc-card-metrics">
        <div className="sc-metric">
          <span className="sc-metric-label">{k.price}</span>
          <span className="sc-metric-value mono">
            {fmtPrice(c.price)} <small className={colorClass(c.changePct)}>{fmtPct(c.changePct)}</small>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label" title={lvlTip}>
            {entryLabel} → {addLabel}
          </span>
          <span className="sc-metric-value mono">
            <span className="positive-text">{fmtPrice(entryVal)}</span> →{' '}
            {addVal != null ? fmtPrice(addVal) : '—'}
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{k.stop} → {k.target}</span>
          <span className="sc-metric-value mono">
            <span className="negative-text">{fmtPrice(c.stopLoss)}</span> →{' '}
            <span className="positive-text">{fmtPrice(c.target)}</span>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{k.hi52}</span>
          <span className="sc-metric-value mono">{c.dist52Pct.toFixed(1)}%</span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{k.dist}</span>
          <span className="sc-metric-value mono">{c.distToPivotPct.toFixed(1)}%</span>
        </div>
        {c.pivots && <PivotRows p={c.pivots} k={k} />}
      </div>

      {c.watchReason && <div className="sc-watch-note">{c.watchReason}</div>}
      <RelStrBadge c={c} k={k} />

      {(c.lhbInst || c.board) && (
        <div className="sc-badges">
          {c.lhbInst &&
            lhbBadges(c.lhbInst, k).map((b, i) => (
              <span key={i} className={b.cls} title={b.title}>
                {b.label}
              </span>
            ))}
          {c.board && (
            <span className={`sc-badge board${c.board.strong ? ' strong' : ''}`} title={c.board.name}>
              {k.board} {k.quad[c.board.quadrant]}{' '}
              <small className={colorClass(c.board.shortChg)}>{fmtPct(c.board.shortChg)}</small>
            </span>
          )}
        </div>
      )}

      <div className="sc-chips">
        <TaChip ta={c.ta} t={t} />
        {s.trendOk && <span className="sc-chip ok">{k.trend}✓</span>}
        {s.volDry && <span className="sc-chip">{k.volDry}</span>}
        {s.atrContract && <span className="sc-chip">{k.atrContract}</span>}
        {s.breakoutVol && (
          <span className="sc-chip hot">
            {k.breakoutVol}
            {c.breakoutVolRatio != null ? ` ${c.breakoutVolRatio.toFixed(1)}x` : ''}
          </span>
        )}
        <span className="sc-chip">{k.vol} {c.volRatio.toFixed(2)}</span>
        <span className="sc-chip">RS {(c.rsRaw * 100).toFixed(0)}</span>
      </div>
    </div>
  )
}

function PullbackCard({ c, t }: { c: PullbackScreenerCandidate; t: Translation }) {
  const k = t.screener.pbCard
  const ck = t.screener.card
  const s = c.signals
  return (
    <div className="sc-card">
      <div className="sc-card-top">
        <div className="sc-card-id">
          <span className="sc-card-name">{c.name}</span>
          <span className="sc-card-code">{c.code}</span>
        </div>
        <StreakScore c={c} k={ck} />
      </div>

      <div className="sc-card-metrics">
        <div className="sc-metric">
          <span className="sc-metric-label">{ck.price}</span>
          <span className="sc-metric-value mono">
            {fmtPrice(c.price)} <small className={colorClass(c.changePct)}>{fmtPct(c.changePct)}</small>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{k.priorHigh}</span>
          <span className="sc-metric-value mono">{fmtPrice(c.priorHigh)}</span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{k.arcLow} → {ck.target}</span>
          <span className="sc-metric-value mono">
            <span className="negative-text">{fmtPrice(c.stopLoss)}</span> →{' '}
            <span className="positive-text">{fmtPrice(c.target)}</span>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{k.retrace}</span>
          <span className="sc-metric-value mono">
            {c.retracePct.toFixed(1)}% · {c.daysSinceHigh}
            {ck.lhbDays}
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{k.recover}</span>
          <span className="sc-metric-value mono">{c.recoverPct.toFixed(1)}%</span>
        </div>
        {c.pivots && <PivotRows p={c.pivots} k={ck} />}
      </div>

      {c.lhbInst &&
        (() => {
          const bs = lhbBadges(c.lhbInst, ck)
          return bs.length ? (
            <div className="sc-badges">
              {bs.map((b, i) => (
                <span key={i} className={b.cls} title={b.title}>
                  {b.label}
                </span>
              ))}
            </div>
          ) : null
        })()}

      <div className="sc-chips">
        <TaChip ta={c.ta} t={t} />
        {s.leader && <span className="sc-chip ok">{k.leader}✓</span>}
        {s.arcUp && <span className="sc-chip">{k.arcUp}</span>}
        {s.maCrossNear && <span className="sc-chip">{k.cross}</span>}
        {s.volSpike && (
          <span className="sc-chip hot">
            {k.volSpike}
            {c.volSpikeRatio != null ? ` ${c.volSpikeRatio.toFixed(1)}x` : ''}
          </span>
        )}
        <span className="sc-chip">RS {(c.rsRaw * 100).toFixed(0)}</span>
      </div>
    </div>
  )
}

/** 连续新高·分歧低吸卡片(缩量十字星守MA5);仿操盘卡片含交易计划。复用现有 sc-* 类,无新 CSS。 */
function HighDivCard({ c, t }: { c: HighDivScreenerCandidate; t: Translation }) {
  const k = t.screener.card
  const hk = t.screener.hdCard
  const stars = '★'.repeat(Math.max(1, Math.min(3, c.tier)))
  return (
    <div className="sc-card">
      <div className="sc-card-top">
        <div className="sc-card-id">
          <span className="sc-card-name">{c.name}</span>
          <span className="sc-card-code">{c.code}</span>
          <span className="sc-card-tag" title={`tier ${c.tier}`}>{stars}</span>
        </div>
        <StreakScore c={c} k={k} />
      </div>

      <div className="sc-card-metrics">
        <div className="sc-metric">
          <span className="sc-metric-label">{k.price}</span>
          <span className="sc-metric-value mono">
            {fmtPrice(c.price)} <small className={colorClass(c.changePct)}>{fmtPct(c.changePct)}</small>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {hk.nh} / {hk.retrace}
          </span>
          <span className="sc-metric-value mono">
            {fmtPrice(c.nhHigh)} / {c.retraceFromHigh.toFixed(1)}%
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {hk.dry} / {hk.doji}
          </span>
          <span className="sc-metric-value mono">
            {c.dryRatio.toFixed(2)}x / {(c.bodyRatio * 100).toFixed(0)}%
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {hk.consol} / {hk.turnover}
          </span>
          <span className="sc-metric-value mono">
            {c.consolDays}
            {hk.days} / {c.turnoverRate != null ? `${c.turnoverRate.toFixed(1)}%` : '—'}
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label" title={c.reason}>
            {hk.buy} → {hk.target}
          </span>
          <span className="sc-metric-value mono">
            <span className="positive-text">{fmtPrice(c.entry)}</span> → <span className="positive-text">{fmtPrice(c.target)}</span>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {hk.stop} · {hk.rr}
          </span>
          <span className="sc-metric-value mono">
            <span className="negative-text">{fmtPrice(c.stop)}</span> · 1:{c.riskReward}
          </span>
        </div>
      </div>

      <div className="sc-watch-note">
        {hk.plan}: {hk.pos} {c.positionHint}
      </div>
      <div className="sc-watch-note">
        {hk.path}: {c.kPath}
      </div>
      {c.riskNote && <div className="sc-watch-note">⚠ {c.riskNote}</div>}

      <div className="sc-chips">
        <TaChip ta={c.ta} t={t} />
        <span className="sc-chip ok">{hk.ma5ok}✓</span>
        <span className="sc-chip">
          {hk.dry} {c.dryRatio.toFixed(2)}x
        </span>
        {c.bodyRatio <= 0.2 && <span className="sc-chip">{hk.doji}≤20%</span>}
        {c.upperHalf && <span className="sc-chip ok">{hk.w2s}✓</span>}
        {c.lowerWick >= 0.3 && <span className="sc-chip">{hk.wick}</span>}
        {c.board?.quadrant === 'hs' && <span className="sc-chip hot">🔥 {hk.hsBadge}</span>}
      </div>
    </div>
  )
}

/** 放量新高·资金驱动突破卡片(MA5>MA21 + 持续放量 + 真52周新高);含交易计划。 */
function VolBreakCard({ c, t }: { c: VolBreakScreenerCandidate; t: Translation }) {
  const k = t.screener.card
  const vk = t.screener.vbCard
  const stars = '★'.repeat(Math.max(1, Math.min(3, c.tier)))
  return (
    <div className="sc-card">
      <div className="sc-card-top">
        <div className="sc-card-id">
          <span className="sc-card-name">{c.name}</span>
          <span className="sc-card-code">{c.code}</span>
          <span className="sc-card-tag" title={`tier ${c.tier}`}>{stars}</span>
        </div>
        <StreakScore c={c} k={k} />
      </div>

      <div className="sc-card-metrics">
        <div className="sc-metric">
          <span className="sc-metric-label">{k.price}</span>
          <span className="sc-metric-value mono">
            {fmtPrice(c.price)} <small className={colorClass(c.changePct)}>{fmtPct(c.changePct)}</small>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {vk.hi} / {k.hi52}
          </span>
          <span className="sc-metric-value mono">
            {fmtPrice(c.priorHigh)} / {c.dist52Pct.toFixed(1)}%
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {vk.burst} / {vk.avg}
          </span>
          <span className="sc-metric-value mono">
            {c.volBurstDays}
            {vk.days} / {c.volAvgRatio.toFixed(2)}x
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label" title={c.reason}>
            {vk.buy} → {vk.target}
          </span>
          <span className="sc-metric-value mono">
            <span className="positive-text">{fmtPrice(c.entry)}</span> → <span className="positive-text">{fmtPrice(c.target)}</span>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {vk.stop} · {vk.rr}
          </span>
          <span className="sc-metric-value mono">
            <span className="negative-text">{fmtPrice(c.stop)}</span> · 1:{c.riskReward}
          </span>
        </div>
      </div>

      <div className="sc-watch-note">
        {vk.plan}: {vk.pos} {c.positionHint}
      </div>
      {c.riskNote && <div className="sc-watch-note">⚠ {c.riskNote}</div>}

      <div className="sc-chips">
        <TaChip ta={c.ta} t={t} />
        <span className="sc-chip ok">{vk.ma5ok}✓</span>
        <span className="sc-chip hot">
          {vk.burst} {c.volBurstDays}/{12}
        </span>
        <span className="sc-chip">
          {vk.avg} {c.volAvgRatio.toFixed(2)}x
        </span>
      </div>
    </div>
  )
}

/** 资金流共振·机构调研卡片(放量+短期多头+机构调研);含交易计划 + 资金共振徽标。 */
/** 资金共振榜 Top10(纯排行·非战法·非买点·未回测):成交额前200∩净流入前200,按净流入降序,叠加龙虎榜。 */
function FundResonanceBoardTable({ rows, t }: { rows: FundResonanceBoardRow[]; t: Translation }) {
  const fb = t.screener.frBoard
  return (
    <>
      <div className="sc-group-head">
        <Coins size={16} weight="fill" /> {fb.title}
      </div>
      <div className="sc-watch-note">{fb.disclaimer}</div>
      {rows.length === 0 ? (
        <div className="sc-empty">{fb.empty}</div>
      ) : (
        <div className="data-table fr-board-table">
          <div className="table-head">
            <span>{fb.colRank}</span>
            <span>{fb.colName}</span>
            <span>{fb.colPrice}</span>
            <span>{fb.colChange}</span>
            <span>{fb.colNetInflow}</span>
            <span>{fb.colTurnRank}</span>
            <span>{fb.colInRank}</span>
            <span>{fb.colLhb}</span>
          </div>
          {rows.map((r, i) => (
            <div key={r.code} className="table-row">
              <span className="mono">{i + 1}</span>
              <span>
                {r.name} <span className="sc-card-code">{r.code}</span>
              </span>
              <span className="mono">{fmtPrice(r.price)}</span>
              <span className={`mono ${colorClass(r.changePct)}`}>{fmtPct(r.changePct)}</span>
              <span className="mono positive-text">{fmtYi(r.netInflow)}</span>
              <span className="mono">#{r.turnoverRank}</span>
              <span className="mono">#{r.inflowRank}</span>
              <span>
                {r.lhb ? (
                  <span title={r.lhb.reason}>
                    {fmtYi(r.lhb.netAmt)}
                    {r.lhb.buySeats[0] ? ` · ${r.lhb.buySeats[0].name}` : ''}
                  </span>
                ) : (
                  '—'
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** 机构调研榜(纯排行·非战法·非买点·未回测):近20交易日机构调研关注度排行,按机构家数降序。 */
function OrgSurveyBoardTable({ rows, t }: { rows: OrgSurveyBoardRow[]; t: Translation }) {
  const ob = t.screener.osBoard
  if (rows.length === 0) return <div className="sc-empty">{ob.empty}</div>
  return (
    <div className="data-table os-board-table">
      <div className="table-head">
        <span>{ob.colRank}</span>
        <span>{ob.colName}</span>
        <span>{ob.colPrice}</span>
        <span>{ob.colChange}</span>
        <span>{ob.colOrgs}</span>
        <span>{ob.colSurveyDays}</span>
        <span>{ob.colLatest}</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.code} className="table-row">
          <span className="mono">{i + 1}</span>
          <span>
            {r.name} <span className="sc-card-code">{r.code}</span>
          </span>
          <span className="mono">{fmtPrice(r.price)}</span>
          <span className={`mono ${colorClass(r.changePct)}`}>{fmtPct(r.changePct)}</span>
          <span className="mono positive-text">{r.orgs}</span>
          <span className="mono">{r.surveyDays}</span>
          <span className="mono">{r.latestDate}</span>
        </div>
      ))}
    </div>
  )
}

function FundResCard({ c, t }: { c: FundResScreenerCandidate; t: Translation }) {
  const k = t.screener.card
  const fk = t.screener.frCard
  const stars = '★'.repeat(Math.max(1, Math.min(3, c.tier)))
  return (
    <div className="sc-card">
      <div className="sc-card-top">
        <div className="sc-card-id">
          <span className="sc-card-name">{c.name}</span>
          <span className="sc-card-code">{c.code}</span>
          <span className="sc-card-tag" title={`tier ${c.tier}`}>{stars}</span>
        </div>
        <StreakScore c={c} k={k} />
      </div>

      <div className="sc-card-metrics">
        <div className="sc-metric">
          <span className="sc-metric-label">{k.price}</span>
          <span className="sc-metric-value mono">
            {fmtPrice(c.price)} <small className={colorClass(c.changePct)}>{fmtPct(c.changePct)}</small>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {fk.survey} / {fk.gap}
          </span>
          <span className="sc-metric-value mono">
            {c.surveyOrgs}
            {fk.orgs} / {c.gapUp ? <span className="positive-text">{fmtPct(c.gapPct)}</span> : '—'}
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {fk.vol} / {fk.mom}
          </span>
          <span className="sc-metric-value mono">
            {c.volRatio.toFixed(2)}x / <span className={colorClass(c.mom)}>{fmtPct(c.mom)}</span>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label" title={c.reason}>
            {fk.buy} → {fk.target}
          </span>
          <span className="sc-metric-value mono">
            <span className="positive-text">{fmtPrice(c.entry)}</span> → <span className="positive-text">{fmtPrice(c.target)}</span>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {fk.stop} · {fk.rr}
          </span>
          <span className="sc-metric-value mono">
            <span className="negative-text">{fmtPrice(c.stop)}</span> · 1:{c.riskReward}
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{fk.hold}</span>
          <span className="sc-metric-value mono">
            {c.holdHint}
            {fk.days}
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label" title="主力净流入 = 买1/买2 档主动成交净额">{fk.netBuy}</span>
          <span className="sc-metric-value mono">
            {c.fundFlow?.netInflow != null ? (
              <span className={colorClass(c.fundFlow.netInflow)}>
                {fmtYi(c.fundFlow.netInflow)}
                {c.fundFlow.netInflowPct != null ? ` ${c.fundFlow.netInflowPct.toFixed(1)}%` : ''}
              </span>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {fk.turnRank} / {fk.inRank}
          </span>
          <span className="sc-metric-value mono">
            {c.fundFlow?.turnoverRank != null ? `#${c.fundFlow.turnoverRank}` : '—'} /{' '}
            {c.fundFlow?.inflowRank != null ? `#${c.fundFlow.inflowRank}` : '—'}
          </span>
        </div>
      </div>

      {(c.fundFlow?.resonance || c.lhbInst) && (
        <div className="sc-badges">
          {c.fundFlow?.resonance && (
            <span
              className="sc-badge lhb inst"
              title={`${fk.fundFlow}: ${fk.turnRank} #${c.fundFlow.turnoverRank} ∩ ${fk.inRank} #${c.fundFlow.inflowRank}`}
            >
              {fk.fundFlow}
            </span>
          )}
          {c.lhbInst && lhbBadges(c.lhbInst, k).map((b, i) => (
            <span key={i} className={b.cls} title={b.title}>
              {b.label}
            </span>
          ))}
        </div>
      )}

      <div className="sc-watch-note">
        {fk.plan}: {fk.pos} {c.positionHint}
      </div>
      {c.riskNote && <div className="sc-watch-note">⚠ {c.riskNote}</div>}

      <div className="sc-chips">
        <TaChip ta={c.ta} t={t} />
        <span className="sc-chip ok">{fk.ma5ok}✓</span>
        <span className="sc-chip hot">
          {fk.vol} {c.volRatio.toFixed(2)}x
        </span>
        {c.surveyOrgs > 0 && (
          <span className="sc-chip">
            {fk.survey} {c.surveyOrgs}
            {fk.orgs}
          </span>
        )}
        {c.gapUp && <span className="sc-chip">{fk.gap}</span>}
      </div>
    </div>
  )
}

/** 突破整理·延续卡片(放量大阳过前高 + 十字星整理 + 高低点双抬);信号日=整理日,实战次日突破 trigger 介入。 */
function BHoldCard({ c, t, variant }: { c: BHoldScreenerCandidate; t: Translation; variant?: 'watch' }) {
  const k = t.screener.card
  const bk = t.screener.bhCard
  const stars = '★'.repeat(Math.max(1, Math.min(3, c.tier)))
  return (
    <div className={`sc-card${variant === 'watch' ? ' sc-card--watch' : ''}`}>
      <div className="sc-card-top">
        <div className="sc-card-id">
          <span className="sc-card-name">{c.name}</span>
          <span className="sc-card-code">{c.code}</span>
          <span className="sc-card-tag" title={`tier ${c.tier}`}>{stars}</span>
        </div>
        <StreakScore c={c} k={k} />
      </div>

      <div className="sc-card-metrics">
        <div className="sc-metric">
          <span className="sc-metric-label">{k.price}</span>
          <span className="sc-metric-value mono">
            {fmtPrice(c.price)} <small className={colorClass(c.changePct)}>{fmtPct(c.changePct)}</small>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {bk.pole} / {bk.consol}
          </span>
          <span className="sc-metric-value mono">
            <span className="positive-text">+{c.poleBodyPct.toFixed(1)}%</span> {c.poleVolRatio.toFixed(1)}x / {c.consolDays}
            {bk.days}
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label" title={c.reason}>
            {bk.trigger}
          </span>
          <span className="sc-metric-value mono positive-text">{fmtPrice(c.trigger)}</span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {bk.stop} · {bk.rr}
          </span>
          <span className="sc-metric-value mono">
            <span className="negative-text">{fmtPrice(c.stop)}</span> · 1:{c.riskReward}
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{bk.target}</span>
          <span className="sc-metric-value mono positive-text">{fmtPrice(c.target)}</span>
        </div>
      </div>

      <div className="sc-watch-note">
        {bk.plan}: 次日突破 <span className="positive-text">{fmtPrice(c.trigger)}</span> {bk.buy} · {fmtPrice(c.consolLow)} {bk.hold} · {bk.pos} {c.positionHint}
      </div>
      {c.riskNote && <div className="sc-watch-note">⚠ {c.riskNote}</div>}
      {variant === 'watch' && <div className="sc-watch-note">{bk.watchNote}</div>}

      {c.lhbInst && (
        <div className="sc-badges">
          {lhbBadges(c.lhbInst, k).map((b, i) => (
            <span key={i} className={b.cls} title={b.title}>
              {b.label}
            </span>
          ))}
        </div>
      )}

      <div className="sc-chips">
        <TaChip ta={c.ta} t={t} />
        <span className="sc-chip hot">
          {bk.pole} {c.poleVolRatio.toFixed(1)}x
        </span>
        {c.higherHigh && c.higherLow && <span className="sc-chip ok">{bk.stepUp}✓</span>}
        <span className="sc-chip">
          {bk.consol} {c.consolDays}
          {bk.days}
        </span>
      </div>
    </div>
  )
}

function TrendNewCard({ c, t }: { c: TrendNewScreenerCandidate; t: Translation }) {
  const k = t.screener.card
  const tn = t.screener.tnCard
  const stars = '★'.repeat(Math.max(1, Math.min(3, c.tier)))
  return (
    <div className="sc-card">
      <div className="sc-card-top">
        <div className="sc-card-id">
          <span className="sc-card-name">{c.name}</span>
          <span className="sc-card-code">{c.code}</span>
          <span className="sc-card-tag" title={`tier ${c.tier}`}>{stars}</span>
        </div>
        <StreakScore c={c} k={k} />
      </div>

      <div className="sc-card-metrics">
        <div className="sc-metric">
          <span className="sc-metric-label">{k.price}</span>
          <span className="sc-metric-value mono">
            {fmtPrice(c.price)} <small className={colorClass(c.changePct)}>{fmtPct(c.changePct)}</small>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {tn.nh} / {tn.dist}
          </span>
          <span className="sc-metric-value mono">
            <span className="positive-text">{c.nhDays}{tn.times}</span> / {c.dist52Pct.toFixed(1)}%
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label" title={c.reason}>
            {tn.entry}
          </span>
          <span className="sc-metric-value mono positive-text">{fmtPrice(c.entry)}</span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {tn.stop} · {tn.rr}
          </span>
          <span className="sc-metric-value mono">
            <span className="negative-text">{fmtPrice(c.stop)}</span> · 1:{c.riskReward}
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{tn.target}</span>
          <span className="sc-metric-value mono positive-text">{fmtPrice(c.target)}</span>
        </div>
      </div>

      <div className="sc-watch-note">
        {tn.plan}: {fmtPrice(c.entry)} {tn.buy} · {tn.ma} {fmtPrice(c.maRef)} {tn.stop} · {tn.pos} {c.positionHint}
      </div>
      {c.riskNote && <div className="sc-watch-note">⚠ {c.riskNote}</div>}

      {c.lhbInst && (
        <div className="sc-badges">
          {lhbBadges(c.lhbInst, k).map((b, i) => (
            <span key={i} className={b.cls} title={b.title}>
              {b.label}
            </span>
          ))}
        </div>
      )}

      <div className="sc-chips">
        <TaChip ta={c.ta} t={t} />
        <span className="sc-chip hot">
          {tn.nh} {c.nhDays}{tn.times}
        </span>
        <span className="sc-chip ok">
          {tn.rs} {c.rs.toFixed(2)}
        </span>
      </div>
    </div>
  )
}

// 趋势中军·监控卡:发现型清单,【无买点】——去掉介入/止损/目标行,只给监控指标 + "非买点"提示。
function TrendLeaderCard({ c, t }: { c: TrendWatchScreenerCandidate; t: Translation }) {
  const k = t.screener.card
  const tw = t.screener.twCard
  const tn = t.screener.tnCard
  const stars = '★'.repeat(Math.max(1, Math.min(3, c.tier)))
  const extWarn = c.extPct > 20 // 偏离 MA20 过大 → 标红提示追高
  return (
    <div className="sc-card">
      <div className="sc-card-top">
        <div className="sc-card-id">
          <span className="sc-card-name">{c.name}</span>
          <span className="sc-card-code">{c.code}</span>
          <span className="sc-card-tag" title={`tier ${c.tier}`}>{stars}</span>
        </div>
        <StreakScore c={c} k={k} />
      </div>

      <div className="sc-card-metrics">
        <div className="sc-metric">
          <span className="sc-metric-label">{k.price}</span>
          <span className="sc-metric-value mono">
            {fmtPrice(c.price)} <small className={colorClass(c.changePct)}>{fmtPct(c.changePct)}</small>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">
            {tw.nh} / {tw.dist}
          </span>
          <span className="sc-metric-value mono">
            <span className="positive-text">{c.nhDays}{tn.times}</span> / {c.dist52Pct.toFixed(1)}%
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{tw.ma5hold}</span>
          <span className="sc-metric-value mono positive-text">{c.ma5HoldDays}{tw.days}</span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label" title={`MA20 ${fmtPrice(c.maRef)}`}>
            {tw.ext}
          </span>
          <span className={`sc-metric-value mono ${extWarn ? 'negative-text' : ''}`}>+{c.extPct.toFixed(1)}%</span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{tw.rs}</span>
          <span className="sc-metric-value mono">{c.rs.toFixed(2)}</span>
        </div>
      </div>

      <div className="sc-monitor-note" title={c.reason}>
        {tw.monitorNote}
      </div>
      <RelStrBadge c={c} k={k} />
      {c.riskNote && <div className="sc-watch-note">⚠ {c.riskNote}</div>}

      <div className="sc-chips">
        <TaChip ta={c.ta} t={t} />
        <span className="sc-chip hot">
          {tw.nh} {c.nhDays}{tn.times}
        </span>
        <span className="sc-chip ok">
          {tw.ma5hold} {c.ma5HoldDays}{tw.days}
        </span>
      </div>
    </div>
  )
}

/** 放量吸筹·监控卡(发现型·非买点):持续异常放量 + 均线走平 + 横盘 = 主力箱体内吸筹。
 *  突出用户关心的三因子(放量倍数/MA20走平/横盘天数)+ 观察触发位(箱体上沿)。无买卖点。 */
function AccumCard({ c, t }: { c: AccumScreenerCandidate; t: Translation }) {
  const k = t.screener.card
  const ac = t.screener.acCard
  const stars = '★'.repeat(Math.max(1, Math.min(3, c.tier)))
  const flatOk = c.flat01 >= 0.5 // 均线走平(斜率小)
  return (
    <div className="sc-card">
      <div className="sc-card-top">
        <div className="sc-card-id">
          <span className="sc-card-name">{c.name}</span>
          <span className="sc-card-code">{c.code}</span>
          <span className="sc-card-tag" title={`tier ${c.tier}`}>{stars}</span>
        </div>
        <StreakScore c={c} k={k} />
      </div>

      <div className="sc-card-metrics">
        <div className="sc-metric">
          <span className="sc-metric-label">{k.price}</span>
          <span className="sc-metric-value mono">
            {fmtPrice(c.price)} <small className={colorClass(c.changePct)}>{fmtPct(c.changePct)}</small>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{ac.vol}</span>
          <span className="sc-metric-value mono positive-text">
            {c.avgVolRatio.toFixed(2)}× <small>({c.surgeRunDays}{ac.days})</small>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{ac.flat}</span>
          <span className={`sc-metric-value mono ${flatOk ? 'positive-text' : ''}`}>
            {c.maSlopePct.toFixed(1)}%{flatOk ? ` ${ac.flatOk}` : ''}
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{ac.consol}</span>
          <span className="sc-metric-value mono positive-text">{c.consolDays}{ac.days}</span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label" title={`${fmtPrice(c.boxLow)} ~ ${fmtPrice(c.boxHigh)}`}>{ac.trigger}</span>
          <span className="sc-metric-value mono">{fmtPrice(c.breakLevel)}</span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{ac.pos}</span>
          <span className="sc-metric-value mono">{Math.round(c.posPct)}%</span>
        </div>
      </div>

      {/* 确认买点(回测 0.20R/PF1.33):放量站上箱体上沿才介入,非吸筹途中埋伏。 */}
      <div className="sc-watch-note">
        {ac.plan}: {ac.buy} <span className="positive-text">{fmtPrice(c.entryTrigger)}</span> · {ac.stop}{' '}
        {fmtPrice(c.stopRef)} · {ac.target} <span className="positive-text">{fmtPrice(c.targetRef)}</span>
      </div>

      <div className="sc-monitor-note" title={c.reason}>
        {ac.monitorNote}
      </div>
      <RelStrBadge c={c} k={k} />
      {c.riskNote && <div className="sc-watch-note">⚠ {c.riskNote}</div>}

      <div className="sc-chips">
        <span className="sc-chip hot">
          {ac.vol} {c.avgVolRatio.toFixed(1)}×
        </span>
        {flatOk && <span className="sc-chip ok">{ac.flatOk}</span>}
        <span className="sc-chip ok">
          {ac.consol} {c.consolDays}{ac.days}
        </span>
      </div>
    </div>
  )
}

export default function ScreenerView({ t }: ScreenerViewProps) {
  const { data, loading, error, lastUpdated, refresh } = useScreener()
  const fwd = useScreenerForward()
  const structure = useMarketStructure()
  const review = useDailyReview(false) // 只用 refresh 串联盘后落盘,不做挂载拉取(卡片在板块轮动视图)
  const resBoard = useFundResonanceBoard()
  const osBoard = useOrgSurveyBoard()
  const sc = t.screener
  const [tab, setTab] = useState<'newhigh' | 'pullback' | 'highdiv' | 'volbreak' | 'fundres' | 'bhold' | 'trendnew' | 'trendwatch' | 'accum' | 'orgsurvey' | 'track'>('newhigh')
  const tabTitle = { newhigh: sc.title, pullback: sc.titlePullback, highdiv: sc.tabs.highDiv, volbreak: sc.tabs.volBreak, fundres: sc.tabs.fundRes, bhold: sc.tabs.bhold, trendnew: sc.tabs.trendNew, trendwatch: sc.tabs.trendWatch, accum: sc.tabs.accum, orgsurvey: sc.tabs.orgSurvey, track: sc.tabs.track }[tab]
  const tabDesc = { newhigh: sc.desc, pullback: sc.pbDesc, highdiv: sc.hdDesc, volbreak: sc.vbDesc, fundres: sc.frDesc, bhold: sc.bhDesc, trendnew: sc.tnDesc, trendwatch: sc.twDesc, accum: sc.acDesc, orgsurvey: sc.osDesc, track: sc.track.desc }[tab]
  // 「每日扫描」日终一键:重扫+存当日快照;盘后(15:00后/周末)再连带复盘并保存实盘战绩。
  const [dailySavedAt, setDailySavedAt] = useState<Date | null>(null)
  const handleScan = useCallback(async () => {
    if (tab === 'track') {
      await fwd.refresh() // 在战绩 tab:只刷战绩
      return
    }
    await refresh() // 重扫 + 存档当日快照(先落盘,forward 才能纳入今天 picks)
    if (isPostCloseReview()) {
      await fwd.refresh() // 盘后:实盘战绩复盘重算 + 存 forward-<date>.json
      await structure.refresh() // 盘后:市场结构(板块集中度/抱团象限)重算 + 存 structure-<date>.json
      await review.refresh() // 盘后:每日复盘综述(吃到刚刷新的结构数据+LLM叙事) + 存 review-<date>.json
      setDailySavedAt(new Date())
    }
  }, [tab, refresh, fwd, structure, review])
  const activeBusy = loading || fwd.loading // 串联期间任一忙都禁用
  // 缓存/磁盘兜底响应用后端真实生成时刻(savedAt),而非"刚刚 fetch 到"的客户端时间——
  // 避免旧数据顶着"刚更新"的假象(缺 savedAt 的旧快照则优雅回退)。
  const updatedLabel = data?.fromCache && data.savedAt
    ? `${sc.generatedAt} ${new Date(data.savedAt).toLocaleString()}`
    : lastUpdated
      ? `${sc.lastUpdated} ${lastUpdated.toLocaleTimeString()}`
      : null

  return (
    <section className="view-stack">
      {data && <RegimeBanner r={data.regime} t={t} />}
      <div className="panel-title themes-toolbar">
        <h2>
          <Crosshair size={18} weight="bold" style={{ verticalAlign: '-3px', marginRight: 6 }} />
          {tabTitle}
        </h2>
        {(data || lastUpdated) && (
          <span className="themes-updated">
            {data?.asof && (
              <>
                {sc.dataAsof} {data.asof}
                {data.fromCache && <span className="sc-cache-badge">{sc.cached}</span>}
                {updatedLabel && ' · '}
              </>
            )}
            {updatedLabel}
            {tab !== 'track' && dailySavedAt && (
              <>
                {' · '}
                <span className="sc-saved-badge">✓ {sc.dailySaved} {dailySavedAt.toLocaleTimeString()}</span>
              </>
            )}
          </span>
        )}
        <button className="sc-scan-btn" onClick={handleScan} disabled={activeBusy} title={sc.scanTip}>
          <ArrowClockwise size={15} className={activeBusy ? 'spin' : ''} />
          {activeBusy ? sc.scanning : sc.scan}
        </button>
      </div>
      <p className="themes-desc">{tabDesc}</p>

      {error && !data && <div className="alert-item danger">{sc.loadFail}</div>}
      {!data && loading && <div className="themes-desc">{sc.scanning}</div>}

      {data && (
        <>
          <div>
            <div className="seg-group">
              <button
                className={`seg-btn${tab === 'newhigh' ? ' active' : ''}`}
                onClick={() => setTab('newhigh')}
              >
                {sc.tabs.newHigh} ({data.breakout.length + data.trigger.length})
              </button>
              <button
                className={`seg-btn${tab === 'pullback' ? ' active' : ''}`}
                onClick={() => setTab('pullback')}
              >
                {sc.tabs.pullback} ({data.pullback.length})
              </button>
              <button
                className={`seg-btn${tab === 'highdiv' ? ' active' : ''}`}
                onClick={() => setTab('highdiv')}
              >
                {sc.tabs.highDiv} ({data.highdiv?.length ?? 0})
              </button>
              <button
                className={`seg-btn${tab === 'volbreak' ? ' active' : ''}`}
                onClick={() => setTab('volbreak')}
              >
                {sc.tabs.volBreak} ({data.volbreak?.length ?? 0})
              </button>
              <button
                className={`seg-btn${tab === 'fundres' ? ' active' : ''}`}
                onClick={() => setTab('fundres')}
              >
                {sc.tabs.fundRes} ({data.fundres?.length ?? 0})
              </button>
              <button
                className={`seg-btn${tab === 'bhold' ? ' active' : ''}`}
                onClick={() => setTab('bhold')}
              >
                {sc.tabs.bhold} ({data.bhold?.length ?? 0})
              </button>
              <button
                className={`seg-btn${tab === 'trendnew' ? ' active' : ''}`}
                onClick={() => setTab('trendnew')}
              >
                {sc.tabs.trendNew} ({data.trendnew?.length ?? 0})
              </button>
              <button
                className={`seg-btn${tab === 'trendwatch' ? ' active' : ''}`}
                onClick={() => setTab('trendwatch')}
              >
                {sc.tabs.trendWatch} ({data.trendwatch?.length ?? 0})
              </button>
              <button
                className={`seg-btn${tab === 'accum' ? ' active' : ''}`}
                onClick={() => setTab('accum')}
              >
                {sc.tabs.accum} ({data.accum?.length ?? 0})
              </button>
              <button
                className={`seg-btn${tab === 'orgsurvey' ? ' active' : ''}`}
                onClick={() => setTab('orgsurvey')}
              >
                {sc.tabs.orgSurvey} ({osBoard.data?.length ?? 0})
              </button>
              <button
                className={`seg-btn${tab === 'track' ? ' active' : ''}`}
                onClick={() => setTab('track')}
              >
                {sc.tabs.track} ({fwd.data?.totalPicks ?? 0})
              </button>
            </div>
          </div>

          {tab === 'track' && <TrackRecordPanel fwd={fwd} t={t} />}

          {tab === 'newhigh' && (
            <>
              <div className="sc-meta">
                {sc.universe} {data.universe} · {sc.scanned} {data.scanned}
                {data.truncated ? ` · ${sc.truncatedNote}` : ''}
              </div>

              {(() => {
                // 持续新高:连续 ≥3 日在榜的老面孔,从扳机/临界中摘出单列。
                const PERSIST_STREAK = 3
                const isPersistent = (c: ScreenerCandidate) => (c.appearStreak ?? 0) >= PERSIST_STREAK
                const trigger = data.trigger.filter((c) => !isPersistent(c))
                const watch = (data.watch ?? []).filter((c) => !isPersistent(c))
                const persistent = [...data.trigger, ...(data.watch ?? [])]
                  .filter(isPersistent)
                  .sort((a, b) => (b.appearStreak ?? 0) - (a.appearStreak ?? 0) || b.score - a.score)
                return (
                  <>
                    <div className="sc-group-head">
                      <Lightning size={16} weight="fill" /> {sc.groups.trigger} ({trigger.length})
                    </div>
                    {trigger.length === 0 ? (
                      <div className="sc-empty">{sc.empty}</div>
                    ) : (
                      <div className="sc-grid">
                        {trigger.map((c) => (
                          <Card key={c.code} c={c} t={t} />
                        ))}
                      </div>
                    )}

                    {watch.length > 0 && (
                      <>
                        <div className="sc-group-head sc-group-head--watch">
                          <Binoculars size={16} weight="fill" /> {sc.groups.watch} ({watch.length})
                        </div>
                        <div className="sc-grid">
                          {watch.map((c) => (
                            <Card key={`w-${c.code}`} c={c} t={t} variant="watch" />
                          ))}
                        </div>
                      </>
                    )}

                    {persistent.length > 0 && (
                      <>
                        <div className="sc-group-head">
                          <TrendUp size={16} weight="fill" /> {sc.groups.persistentHigh} ({persistent.length})
                        </div>
                        <p className="sc-cross-desc">{sc.phNote}</p>
                        <div className="sc-grid">
                          {persistent.map((c) => (
                            <Card key={`ph-${c.code}`} c={c} t={t} />
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )
              })()}

              {(() => {
                // 今日首次突破:只列今天首次站上前高的(firstBreakout!==false;旧快照无此字段→保留显示)。
                const firstBreaks = data.breakout.filter((c) => c.firstBreakout !== false)
                return (
                  <>
                    <div className="sc-group-head">
                      <CheckCircle size={16} weight="fill" /> {sc.groups.breakout} ({firstBreaks.length})
                    </div>
                    {firstBreaks.length === 0 ? (
                      <div className="sc-empty">{sc.empty}</div>
                    ) : (
                      <div className="sc-grid">
                        {firstBreaks.map((c) => (
                          <Card key={c.code} c={c} t={t} />
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}

              {(() => {
                // 已突破·延续:昨日已站上前高(firstBreakout===false)→ 连续新高/趋势延续段,非「今日首次」。
                const conts = data.breakout.filter((c) => c.firstBreakout === false)
                if (conts.length === 0) return null
                return (
                  <>
                    <div className="sc-group-head">
                      <TrendUp size={16} weight="fill" /> {sc.groups.breakoutCont} ({conts.length})
                    </div>
                    <div className="sc-grid">
                      {conts.map((c) => (
                        <Card key={`bc-${c.code}`} c={c} t={t} />
                      ))}
                    </div>
                  </>
                )
              })()}

              {(() => {
                // 反向交叉:既在近 5 日龙虎榜(机构/资金净买)、又符合突破/扳机的标的(主力共振)。
                const lhbKey = (c: ScreenerCandidate) => (c.lhbInst ? c.lhbInst.instNet || c.lhbInst.net : 0)
                const cross = [...data.breakout, ...data.trigger]
                  .filter((c) => c.lhbInst)
                  .sort((a, b) => lhbKey(b) - lhbKey(a))
                return (
                  <>
                    <div className="sc-group-head">
                      <Trophy size={16} weight="fill" /> {sc.crossTitle} ({cross.length})
                    </div>
                    <p className="sc-cross-desc">{sc.crossDesc}</p>
                    {cross.length === 0 ? (
                      <div className="sc-empty">{sc.crossEmpty}</div>
                    ) : (
                      <div className="sc-grid">
                        {cross.map((c) => (
                          <Card key={`x-${c.code}`} c={c} t={t} tag={c.group === 'breakout' ? sc.card.bo : sc.card.tr} />
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}
            </>
          )}

          {tab === 'pullback' && (
            <>
              <div className="sc-meta">
                {sc.universe} {data.universe} · {sc.scanned} {data.scannedPullback}
              </div>
              <div className="sc-group-head">
                <TrendUp size={16} weight="fill" /> {sc.groups.pullback} ({data.pullback.length})
              </div>
              {data.pullback.length === 0 ? (
                <div className="sc-empty">{sc.empty}</div>
              ) : (
                <div className="sc-grid">
                  {data.pullback.map((c) => (
                    <PullbackCard key={`pb-${c.code}`} c={c} t={t} />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'highdiv' && (
            <>
              <div className="sc-meta">
                {sc.universe} {data.universe} · {sc.scanned} {data.scanned}
              </div>
              <div className="sc-group-head">
                <TrendUp size={16} weight="fill" /> {sc.groups.highdiv} ({data.highdiv?.length ?? 0})
              </div>
              {(data.highdiv?.length ?? 0) === 0 ? (
                <div className="sc-empty">{sc.empty}</div>
              ) : (
                <div className="sc-grid">
                  {(data.highdiv ?? []).map((c) => (
                    <HighDivCard key={`hd-${c.code}`} c={c} t={t} />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'volbreak' && (
            <>
              <div className="sc-meta">
                {sc.universe} {data.universe} · {sc.scanned} {data.scanned}
              </div>
              <div className="sc-group-head">
                <Fire size={16} weight="fill" /> {sc.groups.volbreak} ({data.volbreak?.length ?? 0})
              </div>
              {(data.volbreak?.length ?? 0) === 0 ? (
                <div className="sc-empty">{sc.empty}</div>
              ) : (
                <div className="sc-grid">
                  {(data.volbreak ?? []).map((c) => (
                    <VolBreakCard key={`vb-${c.code}`} c={c} t={t} />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'fundres' && (
            <>
              <FundResonanceBoardTable rows={resBoard.data ?? []} t={t} />

              <div className="sc-meta">
                {sc.universe} {data.universe} · {sc.scanned} {data.scanned}
              </div>
              <div className="sc-group-head">
                <Coins size={16} weight="fill" /> {sc.groups.fundres} ({data.fundres?.length ?? 0})
                <small className="tr-muted"> · {sc.frBoard.backtestNote}</small>
              </div>
              {(data.fundres?.length ?? 0) === 0 ? (
                <div className="sc-empty">{sc.empty}</div>
              ) : (
                <div className="sc-grid">
                  {(data.fundres ?? []).map((c) => (
                    <FundResCard key={`fr-${c.code}`} c={c} t={t} />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'bhold' && (
            <>
              <div className="sc-meta">
                {sc.universe} {data.universe} · {sc.scanned} {data.scanned}
              </div>
              <div className="sc-group-head">
                <FlagBanner size={16} weight="fill" /> {sc.groups.bhold} ({data.bhold?.length ?? 0})
              </div>
              {(data.bhold?.length ?? 0) === 0 ? (
                <div className="sc-empty">{sc.empty}</div>
              ) : (
                <div className="sc-grid">
                  {(data.bhold ?? []).map((c) => (
                    <BHoldCard key={`bh-${c.code}`} c={c} t={t} />
                  ))}
                </div>
              )}

              {(data.bholdWatch?.length ?? 0) > 0 && (
                <>
                  <div className="sc-group-head sc-group-head--watch">
                    <FlagBanner size={16} weight="fill" /> {sc.groups.bholdWatch} ({data.bholdWatch?.length ?? 0})
                  </div>
                  <div className="sc-grid">
                    {(data.bholdWatch ?? []).map((c) => (
                      <BHoldCard key={`bhw-${c.code}`} c={c} t={t} variant="watch" />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'trendnew' && (
            <>
              <div className="sc-meta">
                {sc.universe} {data.universe} · {sc.scanned} {data.scanned}
              </div>
              <div className="sc-group-head">
                <TrendUp size={16} weight="fill" /> {sc.groups.trendnew} ({data.trendnew?.length ?? 0})
              </div>
              {(data.trendnew?.length ?? 0) === 0 ? (
                <div className="sc-empty">{sc.empty}</div>
              ) : (
                <div className="sc-grid">
                  {(data.trendnew ?? []).map((c) => (
                    <TrendNewCard key={`tn-${c.code}`} c={c} t={t} />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'trendwatch' && (
            <>
              <div className="sc-meta">
                {sc.universe} {data.universe} · {sc.scanned} {data.scanned}
              </div>
              <div className="sc-group-head">
                <Binoculars size={16} weight="fill" /> {sc.groups.trendwatch} ({data.trendwatch?.length ?? 0})
              </div>
              {(data.trendwatch?.length ?? 0) === 0 ? (
                <div className="sc-empty">{sc.empty}</div>
              ) : (
                <div className="sc-grid">
                  {(data.trendwatch ?? []).map((c) => (
                    <TrendLeaderCard key={`tw-${c.code}`} c={c} t={t} />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'accum' && (
            <>
              <div className="sc-meta">
                {sc.universe} {data.universe} · {sc.scanned} {data.scanned}
              </div>
              <div className="sc-group-head">
                <Stack size={16} weight="fill" /> {sc.groups.accum} ({data.accum?.length ?? 0})
              </div>
              {(data.accum?.length ?? 0) === 0 ? (
                <div className="sc-empty">{sc.empty}</div>
              ) : (
                <div className="sc-grid">
                  {(data.accum ?? []).map((c) => (
                    <AccumCard key={`ac-${c.code}`} c={c} t={t} />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'orgsurvey' && (
            <>
              <div className="sc-group-head">
                <Binoculars size={16} weight="fill" /> {sc.osBoard.title} ({osBoard.data?.length ?? 0})
              </div>
              <div className="sc-watch-note">{sc.osBoard.disclaimer}</div>
              {osBoard.loading && !osBoard.data ? (
                <div className="themes-desc">{sc.scanning}</div>
              ) : osBoard.error && !osBoard.data ? (
                <div className="alert-item danger">{sc.loadFail}</div>
              ) : (
                <OrgSurveyBoardTable rows={osBoard.data ?? []} t={t} />
              )}
            </>
          )}

          <p className="sc-disclaimer">{sc.disclaimer}</p>
        </>
      )}
    </section>
  )
}
