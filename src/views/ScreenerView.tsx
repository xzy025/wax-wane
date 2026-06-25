import { useState } from 'react'
import { ArrowClockwise, Lightning, Crosshair, CheckCircle, Trophy, TrendUp, Binoculars, Fire } from 'phosphor-react'
import {
  useScreener,
  type ScreenerCandidate,
  type PullbackScreenerCandidate,
  type HighDivScreenerCandidate,
  type VolBreakScreenerCandidate,
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
      </span>
      <span className="sc-regime-note">{r.note}</span>
    </div>
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
        <span className="sc-chip ok">{hk.ma5ok}✓</span>
        <span className="sc-chip">
          {hk.dry} {c.dryRatio.toFixed(2)}x
        </span>
        {c.bodyRatio <= 0.2 && <span className="sc-chip">{hk.doji}≤20%</span>}
        {c.upperHalf && <span className="sc-chip ok">{hk.w2s}✓</span>}
        {c.lowerWick >= 0.3 && <span className="sc-chip">{hk.wick}</span>}
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

export default function ScreenerView({ t }: ScreenerViewProps) {
  const { data, loading, error, lastUpdated, refresh } = useScreener()
  const sc = t.screener
  const [tab, setTab] = useState<'newhigh' | 'pullback' | 'highdiv' | 'volbreak'>('newhigh')

  return (
    <section className="view-stack">
      {data && <RegimeBanner r={data.regime} t={t} />}
      <div className="panel-title themes-toolbar">
        <h2>
          <Crosshair size={18} weight="bold" style={{ verticalAlign: '-3px', marginRight: 6 }} />
          {tab === 'newhigh' ? sc.title : tab === 'pullback' ? sc.titlePullback : tab === 'highdiv' ? sc.tabs.highDiv : sc.tabs.volBreak}
        </h2>
        {(data || lastUpdated) && (
          <span className="themes-updated">
            {data?.asof && (
              <>
                {sc.dataAsof} {data.asof}
                {data.fromCache && <span className="sc-cache-badge">{sc.cached}</span>}
                {lastUpdated && ' · '}
              </>
            )}
            {lastUpdated && `${sc.lastUpdated} ${lastUpdated.toLocaleTimeString()}`}
          </span>
        )}
        <button className="sc-scan-btn" onClick={refresh} disabled={loading}>
          <ArrowClockwise size={15} className={loading ? 'spin' : ''} />
          {loading ? sc.scanning : sc.scan}
        </button>
      </div>
      <p className="themes-desc">{tab === 'newhigh' ? sc.desc : tab === 'pullback' ? sc.pbDesc : tab === 'highdiv' ? sc.hdDesc : sc.vbDesc}</p>

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
            </div>
          </div>

          {tab === 'newhigh' && (
            <>
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

              {(data.watch?.length ?? 0) > 0 && (
                <>
                  <div className="sc-group-head sc-group-head--watch">
                    <Binoculars size={16} weight="fill" /> {sc.groups.watch} ({data.watch?.length})
                  </div>
                  <div className="sc-grid">
                    {(data.watch ?? []).map((c) => (
                      <Card key={`w-${c.code}`} c={c} t={t} variant="watch" />
                    ))}
                  </div>
                </>
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

          <p className="sc-disclaimer">{sc.disclaimer}</p>
        </>
      )}
    </section>
  )
}
