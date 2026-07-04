import { useState } from 'react'
import { ArrowClockwise, CaretDown, CaretRight, Trophy } from 'phosphor-react'
import type { Translation } from '../types'
import type {
  BuyGroup,
  ForwardPick,
  ForwardReason,
  Metrics,
  SampleConfidence,
  ScreenerForwardHookResult,
  SegmentGroup,
  StrategyTrack,
} from '../hooks/useScreenerForward'

interface TrackRecordPanelProps {
  fwd: ScreenerForwardHookResult
  t: Translation
}

/** A-share convention: red = up/good, green = down/bad. Positive R → red. */
function rColor(n: number | null | undefined): string {
  if (n == null || n === 0) return ''
  return n > 0 ? 'positive-text' : 'negative-text'
}
function fmtR(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}R`
}
/** PF:null=∞(零亏损,server 约定)。 */
function fmtPF(pf: number | null): string {
  return pf == null ? '∞' : pf.toFixed(2)
}

/** 样本量可信度徽标(仿 optimize.ts MIN_N=30 门槛);high 不展示,避免小样本数字被误读为信号。 */
function ConfidenceBadge({ level, tr }: { level: SampleConfidence; tr: Translation['screener']['track'] }) {
  if (level === 'high') return null
  return (
    <span className={`tr-confidence-badge tr-confidence-${level}`} title={tr.confidence[level]}>
      {tr.confidence[level]}
    </span>
  )
}

/** breakout 切片归因的单个维度小表(标签→n/期望R/PF/胜率 + 样本可信度)。 */
function SegmentTable({ seg, t }: { seg: SegmentGroup; t: Translation }) {
  const sg = t.screener.track.segments
  const rt = t.rotation.quads
  const dimLabel: Record<string, string> = {
    taBias: sg.taBias, lhb: sg.lhb, board: sg.board, scoreTier: sg.scoreTier,
    regimePhase: sg.regimePhase, marketTrend: sg.marketTrend,
  }
  const bucketLabel = (by: string, label: string): string => {
    if (by === 'taBias') return sg.taBiasLabel[label as 'demand' | 'supply' | 'neutral'] ?? label
    if (by === 'lhb') return sg.lhbLabel[label as 'inst' | 'none'] ?? label
    if (by === 'board') return rt[label as 'hs' | 'ls' | 'hw' | 'lw']?.tag ?? label
    if (by === 'scoreTier') return sg.scoreTierLabel[label as 'high' | 'mid' | 'low'] ?? label
    if (by === 'regimePhase') return sg.regimePhaseLabel[label as 'attack' | 'caution' | 'retreat'] ?? label
    if (by === 'marketTrend') return sg.marketTrendLabel[label as 'strong' | 'neutral' | 'weak'] ?? label
    return label
  }
  return (
    <div className="tr-segment">
      <div className="tr-segment-title">{dimLabel[seg.by] ?? seg.by}</div>
      <div className="tr-segment-buckets">
        {seg.buckets.map((b) => (
          <div key={b.label} className="tr-segment-bucket">
            <span className="tr-segment-label">{bucketLabel(seg.by, b.label)}</span>
            <span className="tr-num">n={b.metrics.n}</span>
            <span className={`tr-num ${rColor(b.metrics.expectancyR)}`}>{fmtR(b.metrics.expectancyR)}</span>
            <span className="tr-num">PF {fmtPF(b.metrics.profitFactor)}</span>
            <span className="tr-num">{b.metrics.winRate.toFixed(0)}%</span>
            <ConfidenceBadge level={b.sampleConfidence} tr={t.screener.track} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TrackRecordPanel({ fwd, t }: TrackRecordPanelProps) {
  const sc = t.screener
  const tr = sc.track
  const { data, loading, error } = fwd
  const [expanded, setExpanded] = useState<Set<BuyGroup>>(new Set())

  const GROUP_LABEL: Record<BuyGroup, string> = {
    breakout: sc.card.bo,
    trigger: sc.card.tr,
    pullback: sc.tabs.pullback,
    highdiv: sc.tabs.highDiv,
    volbreak: sc.tabs.volBreak,
    fundres: sc.tabs.fundRes,
    bhold: sc.tabs.bhold,
    trendnew: sc.tabs.trendNew,
  }

  if (error && !data) return <div className="alert-item danger">{tr.loadFail}</div>
  if (!data && loading) return <div className="themes-desc">{tr.refreshing}</div>
  if (!data) return <div className="themes-desc">{tr.refreshing}</div>
  if (data.strategies.length === 0) return <div className="sc-empty">{tr.empty}</div>

  // Maturity = fraction of *entered* positions (closed+open, excl. pending) that have resolved.
  // Low maturity ⇒ closed sample is stop-dominated (winners still open), so closed expR is understated.
  const closedTotal = data.overall.n
  const enteredTotal = data.totalPicks - data.pendingCount - (data.skippedCount ?? 0) // skipped=未入场,不算已入场
  const maturedPct = enteredTotal > 0 ? Math.round((100 * closedTotal) / enteredTotal) : 0
  const premature = enteredTotal > 0 && maturedPct < 60

  const toggle = (g: BuyGroup) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })
  }

  const reasonLabel = (r: ForwardReason): string => tr.reason[r] ?? r

  const metricCells = (m: Metrics) => (
    <>
      <td className={`tr-num ${rColor(m.expectancyR)}`}>{m.n ? fmtR(m.expectancyR) : tr.na}</td>
      <td className="tr-num">{m.n ? fmtPF(m.profitFactor) : tr.na}</td>
      <td className="tr-num">{m.n ? `${m.winRate.toFixed(0)}%` : tr.na}</td>
      <td className="tr-num">{m.n ? m.avgHoldBars.toFixed(1) : tr.na}</td>
    </>
  )

  const strategyRow = (s: StrategyTrack) => {
    const isOpen = expanded.has(s.group)
    const bt = s.backtestExpectancyR
    const delta = bt != null && s.closed.n ? s.closed.expectancyR - bt : null
    return (
      <tbody key={s.group}>
        <tr className="tr-row" onClick={() => toggle(s.group)}>
          <td className="tr-strat">
            {isOpen ? <CaretDown size={13} weight="bold" /> : <CaretRight size={13} weight="bold" />}
            {GROUP_LABEL[s.group]}
            {s.note ? <span className="tr-note-flag" title={s.note}>⚠</span> : null}
          </td>
          <td className="tr-num">
            {s.closedCount}/{s.openCount}/{s.pendingCount}
            {(s.staleCount ?? 0) > 0 && (
              <span className="tr-note-flag" title={tr.reason.stale}>{tr.staleShort}{s.staleCount}</span>
            )}
            {(s.skippedCount ?? 0) > 0 && (
              <span className="tr-note-flag" title={tr.reason.skipped}>{tr.skippedShort}{s.skippedCount}</span>
            )}
            <ConfidenceBadge level={s.sampleConfidence} tr={tr} />
          </td>
          {metricCells(s.closed)}
          <td className="tr-num tr-muted">{bt != null ? fmtR(bt) : tr.na}</td>
          <td className={`tr-num ${rColor(delta)}`}>{delta != null ? fmtR(delta) : tr.na}</td>
          <td className={`tr-num ${rColor(s.openCount ? s.unrealizedAvgR : null)}`}>
            {s.openCount ? fmtR(s.unrealizedAvgR) : tr.na}
          </td>
        </tr>
        {isOpen && (
          <tr className="tr-detail-row">
            <td colSpan={9}>
              {s.note && <div className="sc-watch-note">⚠ {s.note}</div>}
              {s.group === 'breakout' && (data?.breakoutSegments ?? []).length > 0 && (
                <div className="tr-segments">
                  <div className="tr-segments-title">{tr.segments.title}</div>
                  {(data?.breakoutSegments ?? []).map((seg) => (
                    <SegmentTable key={seg.by} seg={seg} t={t} />
                  ))}
                </div>
              )}
              <div className="tr-picks">
                {s.picks.map((p, i) => (
                  <PickRow key={`${p.code}-${p.asof}-${i}`} p={p} tr={tr} reasonLabel={reasonLabel} />
                ))}
              </div>
            </td>
          </tr>
        )}
      </tbody>
    )
  }

  return (
    <div className="track-record">
      <div className="tr-head">
        <span className="tr-summary">
          {data.dateRange && (
            <>
              {tr.signalRange} <b>{data.dateRange[0]}</b>~<b>{data.dateRange[1]}</b> ·{' '}
            </>
          )}
          {tr.snapshots} {data.snapshotCount}{tr.snapshotsUnit} · {tr.hold} {data.hold}
          {tr.holdUnit} · {tr.tracked} {data.totalPicks}{tr.trackedUnit}
          {data.pendingCount ? ` · ${tr.pending} ${data.pendingCount}` : ''}
          {enteredTotal > 0 && (
            <>
              {' · '}
              {tr.matured}{' '}
              <b className={premature ? 'negative-text' : 'positive-text'}>{maturedPct}%</b>{' '}
              ({closedTotal}/{enteredTotal})
            </>
          )}
          {data.fromCache && <span className="sc-cache-badge">{sc.cached}</span>}
        </span>
        <button className="sc-scan-btn" onClick={fwd.refresh} disabled={loading}>
          <ArrowClockwise size={15} className={loading ? 'spin' : ''} />
          {loading ? tr.refreshing : tr.refresh}
        </button>
      </div>
      {premature && <div className="sc-watch-note">⚠ {tr.prematureNote}</div>}
      <div className="tr-method">{tr.methodNote}</div>

      {(data.regimeSegments ?? []).length > 0 && (
        <div className="tr-segments">
          <div className="tr-segments-title">{tr.segments.regimeTitle}</div>
          {(data.regimeSegments ?? []).map((seg) => (
            <SegmentTable key={seg.by} seg={seg} t={t} />
          ))}
        </div>
      )}

      <div className="tr-table-wrap">
        <table className="tr-table">
          <thead>
            <tr>
              <th className="tr-strat">{tr.colStrategy}</th>
              <th className="tr-num">{tr.colCounts}</th>
              <th className="tr-num">{tr.colLiveExpR}</th>
              <th className="tr-num">{tr.colLivePF}</th>
              <th className="tr-num">{tr.colWin}</th>
              <th className="tr-num">{tr.colHold}</th>
              <th className="tr-num">{tr.colBtExpR}</th>
              <th className="tr-num">{tr.colDelta}</th>
              <th className="tr-num">{tr.colFloatR}</th>
            </tr>
          </thead>
          <tbody className="tr-overall">
            <tr>
              <td className="tr-strat">
                <Trophy size={13} weight="fill" /> {tr.overall}
              </td>
              <td className="tr-num">
                {data.overall.n}/{Math.max(0, data.totalPicks - data.overall.n - data.pendingCount - (data.skippedCount ?? 0))}/{data.pendingCount}
              </td>
              {metricCells(data.overall)}
              <td className="tr-num tr-muted">{tr.na}</td>
              <td className="tr-num">{tr.na}</td>
              <td className="tr-num">{tr.na}</td>
            </tr>
          </tbody>
          {data.strategies.map(strategyRow)}
        </table>
      </div>
    </div>
  )
}

function PickRow({
  p,
  tr,
  reasonLabel,
}: {
  p: ForwardPick
  tr: Translation['screener']['track']
  reasonLabel: (r: ForwardReason) => string
}) {
  const statusKey = p.status
  return (
    <div className={`tr-pick tr-pick-${statusKey}`}>
      <span className="tr-pick-date">{p.asof}</span>
      <span className="tr-pick-name">
        {p.name} <span className="tr-pick-code">{p.code}</span>
      </span>
      <span className={`tr-pick-status tr-status-${statusKey}`}>{tr.status[statusKey]}</span>
      <span className="tr-pick-px">
        {p.entry.toFixed(2)}
        {p.status !== 'pending' && (
          <>
            {' → '}
            {p.exit.toFixed(2)}
          </>
        )}
      </span>
      <span className={`tr-pick-r ${p.R > 0 ? 'positive-text' : p.R < 0 ? 'negative-text' : ''}`}>
        {p.status === 'pending' ? tr.na : fmtR(p.R)}
      </span>
      <span className="tr-pick-reason">{reasonLabel(p.reason)}</span>
      <span className="tr-pick-held">
        {p.status === 'pending' ? tr.na : `${tr.held} ${p.barsHeld}${tr.heldUnit}`}
      </span>
    </div>
  )
}
