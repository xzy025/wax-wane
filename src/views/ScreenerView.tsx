import { useState } from 'react'
import { ArrowClockwise, Lightning, Crosshair, CheckCircle, Trophy, TrendUp } from 'phosphor-react'
import {
  useScreener,
  type ScreenerCandidate,
  type PullbackScreenerCandidate,
  type ScreenerRegime,
} from '../hooks/useScreener'
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

/** 龙虎榜徽标:按机构/游资命中算 标签+样式类。机游结合 > 仅机构 > 仅游资 > 净买。 */
function lhbBadge(l: NonNullable<ScreenerCandidate['lhbInst']>, k: Translation['screener']['card']) {
  const both = l.instDays > 0 && l.hotDays > 0
  const cls = both ? 'both' : l.instDays > 0 ? 'inst' : l.hotDays > 0 ? 'hot' : ''
  const main = both
    ? k.lhbBoth
    : l.instDays > 0
      ? `${k.lhbInst}${l.instDays}${k.lhbDays}`
      : l.hotDays > 0
        ? `${k.lhbHot}${l.hotDays}${k.lhbDays}`
        : k.lhbNet
  const title = `${k.lhbInst} ${l.instDays}${k.lhbDays} · ${k.lhbHot} ${l.hotDays}${k.lhbDays} · ${k.lhbNet} ${l.onDays}${k.lhbDays}`
  return { label: `${k.lhb} ${main}`, cls: `sc-badge lhb ${cls}`.trim(), title }
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
      </span>
      <span className="sc-regime-note">{r.note}</span>
    </div>
  )
}

function Card({ c, t, tag }: { c: ScreenerCandidate; t: Translation; tag?: string }) {
  const k = t.screener.card
  const s = c.signals
  return (
    <div className="sc-card">
      <div className="sc-card-top">
        <div className="sc-card-id">
          <span className="sc-card-name">{c.name}</span>
          <span className="sc-card-code">{c.code}</span>
          {tag && <span className="sc-card-tag">{tag}</span>}
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

      {(c.lhbInst || c.board) && (
        <div className="sc-badges">
          {c.lhbInst &&
            (() => {
              const b = lhbBadge(c.lhbInst, k)
              return (
                <span className={b.cls} title={b.title}>
                  {b.label}
                </span>
              )
            })()}
          {c.board && (
            <span className={`sc-badge board${c.board.strong ? ' strong' : ''}`} title={c.board.name}>
              {k.board} {k.quad[c.board.quadrant]}{' '}
              <small className={colorClass(c.board.shortChg)}>{fmtPct(c.board.shortChg)}</small>
            </span>
          )}
        </div>
      )}

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
        <span className="sc-score" title={ck.score}>
          {Math.round(c.score)}
        </span>
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
          const b = lhbBadge(c.lhbInst, ck)
          return (
            <div className="sc-badges">
              <span className={b.cls} title={b.title}>
                {b.label}
              </span>
            </div>
          )
        })()}

      <div className="sc-chips">
        {s.leader && <span className="sc-chip ok">{k.leader}✓</span>}
        {s.arcUp && <span className="sc-chip">{k.arcUp}</span>}
        {s.maCrossNear && <span className="sc-chip">{k.cross}</span>}
        {s.volSpike && <span className="sc-chip hot">{k.volSpike}</span>}
        <span className="sc-chip">RS {(c.rsRaw * 100).toFixed(0)}</span>
      </div>
    </div>
  )
}

export default function ScreenerView({ t }: ScreenerViewProps) {
  const { data, loading, error, lastUpdated, refresh } = useScreener()
  const sc = t.screener
  const [tab, setTab] = useState<'newhigh' | 'pullback'>('newhigh')

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
            </div>
          </div>

          {tab === 'newhigh' && (
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
              <p className="sc-cross-desc">{sc.pbDesc}</p>
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

          <p className="sc-disclaimer">{sc.disclaimer}</p>
        </>
      )}
    </section>
  )
}
