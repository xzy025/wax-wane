import { useMemo, useState } from 'react'
import { ArrowClockwise, Crown } from 'phosphor-react'
import { useThemes, type ThemeBlock, type ThemeRow } from '../hooks/useThemes'
import type { Translation } from '../types'

interface ThemesViewProps {
  t: Translation
  language: 'zh' | 'en'
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

function fmtNum(n: number | null, dp = 2): string {
  if (n == null) return '—'
  return n.toFixed(dp)
}

function fmtCap(yuan: number): string {
  if (!yuan) return '—'
  return (yuan / 1e8).toFixed(0)
}

export default function ThemesView({ t, language }: ThemesViewProps) {
  const { themes, loading, error, refresh } = useThemes()
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

  // Constituents sorted by today's change (strength order).
  const rows = useMemo<ThemeRow[]>(
    () => (selected ? [...selected.constituents].sort((a, b) => b.changePct - a.changePct) : []),
    [selected],
  )

  const themeName = (th: ThemeBlock) => (language === 'en' ? th.nameEn : th.name)
  const c = t.themes.cols

  return (
    <section className="view-stack">
      <div className="panel-title themes-toolbar">
        <h2>{t.themes.heatTitle}</h2>
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
        {ranked.map((th) => {
          const active = selected?.id === th.id
          return (
            <button
              key={th.id}
              className={`theme-card ${active ? 'active' : ''}`}
              onClick={() => setSelectedId(th.id)}
            >
              <span className="theme-name">{themeName(th)}</span>
              <span className={`theme-avg ${colorClass(th.summary.avgChangePct)}`}>
                {fmtPct(th.summary.avgChangePct)}
              </span>
              <span className="theme-sub">
                {t.themes.upDown} {th.summary.upCount}/{th.summary.downCount}
                {th.summary.leader && (
                  <>
                    {' · '}
                    <Crown size={11} weight="fill" style={{ verticalAlign: '-1px' }} />{' '}
                    {th.summary.leader.name} {fmtPct(th.summary.leader.changePct)}
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
          <span>{c.price}</span>
          <span>{c.change}</span>
          <span>{c.pe}</span>
          <span>{c.pb}</span>
          <span>{c.mcap}</span>
          <span>{c.d60}</span>
          <span>{c.ytd}</span>
          <span>{c.tag}</span>
        </div>
        {rows.length === 0 && <div className="table-row">{t.themes.noData}</div>}
        {rows.map((r) => (
          <div className="table-row" key={r.code}>
            <span>
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
            <span className={colorClass(r.changePct)}>{fmtPct(r.changePct)}</span>
            <span className="mono">{fmtNum(r.pe, 1)}</span>
            <span className="mono">{fmtNum(r.pb, 2)}</span>
            <span className="mono">{fmtCap(r.marketCap)}</span>
            <span className={colorClass(r.chg60)}>{fmtPct(r.chg60)}</span>
            <span className={colorClass(r.chgYtd)}>{fmtPct(r.chgYtd)}</span>
            <span className="theme-tag">{r.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
