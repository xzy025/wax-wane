import { useMemo, useState } from 'react'
import { ArrowClockwise, CaretDown, CaretUp, Crown } from 'phosphor-react'
import { useThemes, type ThemeBlock, type ThemeRow, type PeerRow } from '../hooks/useThemes'
import { useSortableRows, type Accessors } from '../hooks/useSortableRows'
import type { Translation } from '../types'

interface ThemesViewProps {
  t: Translation
  language: 'zh' | 'en'
}

type SortKey = 'price' | 'change' | 'pe' | 'pb' | 'mcap' | 'd60' | 'ytd'

// Module-level so the accessor map is a stable reference across renders.
const ACCESSORS: Accessors<ThemeRow, SortKey> = {
  price: (r) => r.price,
  change: (r) => r.changePct,
  pe: (r) => r.pe,
  pb: (r) => r.pb,
  mcap: (r) => r.marketCap,
  d60: (r) => r.chg60,
  ytd: (r) => r.chgYtd,
}

/** A-share convention: red = up, green = down. Null/0 → neutral. */
function colorClass(n: number | null): string {
  if (n == null || n === 0) return ''
  return n > 0 ? 'positive-text' : 'negative-text'
}

function fmtPct(n: number | null): string {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

/** Divergence is a spread (always ≥0), so no leading sign. */
function fmtSpread(n: number): string {
  return `${n.toFixed(1)}%`
}

function fmtNum(n: number | null, dp = 2): string {
  if (n == null) return '—'
  return n.toFixed(dp)
}

function fmtCap(yuan: number): string {
  if (!yuan) return '—'
  return (yuan / 1e8).toFixed(0)
}

/** External quote link per market (best-effort). KR/JP/TW omitted until a quote source is wired. */
function peerHref(p: PeerRow): string | null {
  if (p.market === 'US') return `https://quote.eastmoney.com/us/${p.code}.html`
  if (p.market === 'HK') return `https://quote.eastmoney.com/hk/${p.code.padStart(5, '0')}.html`
  return null
}

export default function ThemesView({ t, language }: ThemesViewProps) {
  const { themes, loading, error, lastUpdated, refresh } = useThemes()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Themes ranked by today's average change (strongest first).
  const ranked = useMemo(
    () => (themes ? [...themes].sort((a, b) => b.summary.avgChangePct - a.summary.avgChangePct) : []),
    [themes],
  )

  const selected = useMemo<ThemeBlock | null>(() => {
    if (ranked.length === 0) return null
    return ranked.find((x) => x.id === selectedId) ?? ranked[0]
  }, [ranked, selectedId])

  // Constituents, sortable by any numeric column (default: today's change desc).
  const { sorted: rows, sortKey, sortDir, toggle } = useSortableRows<ThemeRow, SortKey>(
    selected?.constituents ?? [],
    ACCESSORS,
    { key: 'change', dir: 'desc' },
  )

  const themeName = (th: ThemeBlock) => (language === 'en' ? th.nameEn : th.name)
  const c = t.themes.cols

  // Sortable column header: click to sort, active column shows a caret.
  const th = (key: SortKey, label: string) => (
    <button
      type="button"
      className={`th-sort ${sortKey === key ? 'active' : ''}`}
      onClick={() => toggle(key)}
      title={sortKey === key && sortDir === 'desc' ? t.themes.sortAsc : t.themes.sortDesc}
    >
      {label}
      {sortKey === key &&
        (sortDir === 'asc' ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />)}
    </button>
  )

  return (
    <section className="view-stack">
      <div className="panel-title themes-toolbar">
        <h2>{t.themes.heatTitle}</h2>
        {lastUpdated && (
          <span className="themes-updated">
            {t.themes.lastUpdated} {lastUpdated.toLocaleTimeString()}
          </span>
        )}
        <button
          className="icon-button"
          onClick={refresh}
          disabled={loading}
          aria-label={t.themes.refresh}
          title={t.themes.refresh}
        >
          <ArrowClockwise size={18} className={loading ? 'spin' : ''} />
        </button>
      </div>
      <p className="themes-desc">{t.themes.heatDesc}</p>

      {error && !themes && <div className="alert-item danger">{t.themes.loadFail}</div>}
      {!themes && loading && <div className="themes-desc">…</div>}

      {/* Heat ranking */}
      <div className="theme-rank">
        {ranked.map((thm) => {
          const active = selected?.id === thm.id
          const s = thm.summary
          return (
            <button
              key={thm.id}
              className={`theme-card ${active ? 'active' : ''}`}
              onClick={() => setSelectedId(thm.id)}
            >
              <span className="theme-name">{themeName(thm)}</span>
              <span className={`theme-avg ${colorClass(s.avgChangePct)}`}>{fmtPct(s.avgChangePct)}</span>
              <span className="theme-sub">
                {t.themes.upDown} {s.upCount}/{s.downCount}
                {s.leader && (
                  <>
                    {' · '}
                    <Crown size={11} weight="fill" style={{ verticalAlign: '-1px' }} /> {s.leader.name}{' '}
                    {fmtPct(s.leader.changePct)}
                  </>
                )}
                {' · '}
                {t.themes.divergence} {fmtSpread(s.divergencePct)}
                {s.limitUpCount > 0 && (
                  <>
                    {' · '}
                    <span className="positive-text">{t.themes.limitUp}</span> {s.limitUpCount}
                    {s.maxBoards > 1 && ` · ${t.themes.maxBoardStat} ${s.maxBoards}${t.themes.boardsSuffix}`}
                  </>
                )}
              </span>
            </button>
          )
        })}
      </div>

      {/* Constituent comparison table */}
      {selected && (
        <div className="panel-title">
          <h2>
            {t.themes.compareTitle} · {themeName(selected)}
          </h2>
        </div>
      )}
      <div className="data-table theme-table">
        <div className="table-row table-head">
          <span>{c.name}</span>
          {th('price', c.price)}
          {th('change', c.change)}
          {th('pe', c.pe)}
          {th('pb', c.pb)}
          {th('mcap', c.mcap)}
          {th('d60', c.d60)}
          {th('ytd', c.ytd)}
          <span>{c.tag}</span>
        </div>
        {rows.length === 0 && <div className="table-row">{t.themes.noData}</div>}
        {rows.map((r) => (
          <div className="table-row" key={r.code}>
            <span>
              {selected?.summary.leader?.code === r.code && (
                <Crown size={12} weight="fill" className="theme-leader-crown" style={{ verticalAlign: '-1px' }} />
              )}
              <a
                href={`https://quote.eastmoney.com/${r.code.startsWith('6') ? 'sh' : 'sz'}${r.code}.html`}
                target="_blank"
                rel="noreferrer"
                className="theme-stock-name"
              >
                {r.name}
              </a>
              <small>{r.code}</small>
            </span>
            <span className="mono">{fmtNum(r.price)}</span>
            <span className={colorClass(r.changePct)}>
              {fmtPct(r.changePct)}
              {r.limitUp && (
                <span className="theme-limit-badge">
                  {t.themes.limitUp}
                  {r.boards > 1 ? ` ${r.boards}${t.themes.boardsSuffix}` : ''}
                </span>
              )}
            </span>
            <span className="mono">{fmtNum(r.pe, 1)}</span>
            <span className="mono">{fmtNum(r.pb, 2)}</span>
            <span className="mono">{fmtCap(r.marketCap)}</span>
            <span className={colorClass(r.chg60)}>{fmtPct(r.chg60)}</span>
            <span className={colorClass(r.chgYtd)}>{fmtPct(r.chgYtd)}</span>
            <span className="theme-tag">{r.label}</span>
          </div>
        ))}
      </div>

      {/* Overseas comparable leaders — config-driven reference with best-effort live quote. */}
      {selected && selected.peers.length > 0 && (
        <>
          <div className="panel-title">
            <h2>
              {t.themes.overseasTitle} · {themeName(selected)}
            </h2>
          </div>
          <div className="data-table peer-table">
            <div className="table-row table-head">
              <span>{c.name}</span>
              <span>{c.price}</span>
              <span>{c.change}</span>
              <span>{c.tag}</span>
            </div>
            {selected.peers.map((p) => {
              const href = peerHref(p)
              const label = language === 'en' ? p.nameEn : p.name
              return (
                <div className="table-row" key={`${p.market}-${p.code}`}>
                  <span>
                    <span className="peer-market-badge">{t.themes.markets[p.market]}</span>
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="theme-stock-name">
                        {label}
                      </a>
                    ) : (
                      <span className="theme-stock-name">{label}</span>
                    )}
                    <small>{p.code}</small>
                  </span>
                  <span className="mono">{p.found ? fmtNum(p.price) : '—'}</span>
                  <span className={colorClass(p.found ? p.changePct : null)}>
                    {p.found ? fmtPct(p.changePct) : '—'}
                  </span>
                  <span className="theme-tag">{p.label ?? ''}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
