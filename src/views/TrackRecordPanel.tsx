import { useState } from 'react'
import { ArrowClockwise, CaretDown, CaretRight, Trophy } from 'phosphor-react'
import type { Translation } from '../types'
import type {
  BuyGroup,
  ForwardPick,
  ForwardReason,
  Metrics,
  ScreenerForwardHookResult,
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
      <td className="tr-num">{m.n ? m.profitFactor.toFixed(2) : tr.na}</td>
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
          {data.fromCache && <span className="sc-cache-badge">{sc.cached}</span>}
        </span>
        <button className="sc-scan-btn" onClick={fwd.refresh} disabled={loading}>
          <ArrowClockwise size={15} className={loading ? 'spin' : ''} />
          {loading ? tr.refreshing : tr.refresh}
        </button>
      </div>
      <div className="tr-method">{tr.methodNote}</div>

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
                {data.overall.n}/{data.totalPicks - data.overall.n - data.pendingCount}/{data.pendingCount}
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
