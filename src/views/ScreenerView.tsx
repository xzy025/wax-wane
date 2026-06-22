import { ArrowClockwise, Lightning, Crosshair, CheckCircle } from 'phosphor-react'
import { useScreener, type ScreenerCandidate, type ScreenerRegime } from '../hooks/useScreener'
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
      </span>
      <span className="sc-regime-note">{r.note}</span>
    </div>
  )
}

function Card({ c, t }: { c: ScreenerCandidate; t: Translation }) {
  const k = t.screener.card
  const s = c.signals
  return (
    <div className="sc-card">
      <div className="sc-card-top">
        <div className="sc-card-id">
          <span className="sc-card-name">{c.name}</span>
          <span className="sc-card-code">{c.code}</span>
        </div>
        <span className="sc-score" title={k.score}>
          {Math.round(c.score)}
        </span>
      </div>

      <div className="sc-card-metrics">
        <div className="sc-metric">
          <span className="sc-metric-label">{k.price}</span>
          <span className="sc-metric-value mono">
            {fmtPrice(c.price)} <small className={colorClass(c.changePct)}>{fmtPct(c.changePct)}</small>
          </span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{k.pivot}</span>
          <span className="sc-metric-value mono">{fmtPrice(c.pivot)}</span>
        </div>
        <div className="sc-metric">
          <span className="sc-metric-label">{k.stop} → {k.target}</span>
          <span className="sc-metric-value mono">
            <span className="negative-text">{fmtPrice(c.stopLoss)}</span> →{' '}
            <span className="positive-text">{fmtPrice(c.target)}</span>
          </span>
        </div>
        {c.group === 'trigger' && (
          <div className="sc-metric">
            <span className="sc-metric-label">{k.dist}</span>
            <span className="sc-metric-value mono">{c.distToPivotPct.toFixed(1)}%</span>
          </div>
        )}
      </div>

      <div className="sc-chips">
        {s.trendOk && <span className="sc-chip ok">{k.trend}✓</span>}
        {s.volDry && <span className="sc-chip">{k.volDry}</span>}
        {s.atrContract && <span className="sc-chip">{k.atrContract}</span>}
        {s.breakoutVol && <span className="sc-chip hot">{k.breakoutVol}</span>}
        <span className="sc-chip">{k.vol} {c.volRatio.toFixed(2)}</span>
        <span className="sc-chip">RS {(c.rsRaw * 100).toFixed(0)}</span>
      </div>
    </div>
  )
}

export default function ScreenerView({ t }: ScreenerViewProps) {
  const { data, loading, error, lastUpdated, refresh } = useScreener()
  const sc = t.screener

  return (
    <section className="view-stack">
      <div className="panel-title themes-toolbar">
        <h2>
          <Crosshair size={18} weight="bold" style={{ verticalAlign: '-3px', marginRight: 6 }} />
          {sc.title}
        </h2>
        {lastUpdated && (
          <span className="themes-updated">
            {sc.lastUpdated} {lastUpdated.toLocaleTimeString()}
          </span>
        )}
        <button className="sc-scan-btn" onClick={refresh} disabled={loading}>
          <ArrowClockwise size={15} className={loading ? 'spin' : ''} />
          {loading ? sc.scanning : sc.scan}
        </button>
      </div>
      <p className="themes-desc">{sc.desc}</p>

      {error && !data && <div className="alert-item danger">{sc.loadFail}</div>}
      {!data && loading && <div className="themes-desc">{sc.scanning}</div>}

      {data && (
        <>
          <RegimeBanner r={data.regime} t={t} />
          <div className="sc-meta">
            {sc.universe} {data.universe} · {sc.scanned} {data.scanned}
            {data.truncated ? ` · ${sc.truncatedNote}` : ''}
          </div>

          <div className="sc-group-head">
            <CheckCircle size={16} weight="fill" /> {sc.groups.breakout} ({data.breakout.length})
          </div>
          {data.breakout.length === 0 ? (
            <div className="sc-empty">{sc.empty}</div>
          ) : (
            <div className="sc-grid">
              {data.breakout.map((c) => (
                <Card key={c.code} c={c} t={t} />
              ))}
            </div>
          )}

          <div className="sc-group-head">
            <Lightning size={16} weight="fill" /> {sc.groups.trigger} ({data.trigger.length})
          </div>
          {data.trigger.length === 0 ? (
            <div className="sc-empty">{sc.empty}</div>
          ) : (
            <div className="sc-grid">
              {data.trigger.map((c) => (
                <Card key={c.code} c={c} t={t} />
              ))}
            </div>
          )}

          <p className="sc-disclaimer">{sc.disclaimer}</p>
        </>
      )}
    </section>
  )
}
