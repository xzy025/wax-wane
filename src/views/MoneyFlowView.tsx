import { useState } from 'react'
import { ArrowClockwise, CaretDown, CaretUp } from 'phosphor-react'
import { useMoneyFlow, type LhbRow, type FundFlowRow, type RankEntry } from '../hooks/useMoneyFlow'
import { useSortableRows, type Accessors } from '../hooks/useSortableRows'
import type { Translation } from '../types'

interface MoneyFlowViewProps {
  t: Translation
  language: 'zh' | 'en'
}

type Source = 'lhb' | 'fund'
type Period = 'today' | 'd3' | 'd5'

// Explicit key unions so useSortableRows pins K to the full set (not the
// default-sort literal) — otherwise the `th` helper's key won't type-check.
type LhbKey = 'close' | 'change' | 'turnover' | 'net' | 'buy' | 'sell'
type FundKey = 'price' | 'change' | 'main' | 'mainpct' | 'sup' | 'big'
type RankKey = 'net' | 'days' | 'change'

// Module-level accessor maps → stable references across renders.
const ACC_LHB: Accessors<LhbRow, LhbKey> = {
  close: (r) => r.close,
  change: (r) => r.changePct,
  turnover: (r) => r.turnover,
  net: (r) => r.netAmt,
  buy: (r) => r.buyAmt,
  sell: (r) => r.sellAmt,
}
const ACC_FUND: Accessors<FundFlowRow, FundKey> = {
  price: (r) => r.price,
  change: (r) => r.changePct,
  main: (r) => r.mainNet,
  mainpct: (r) => r.mainNetPct,
  sup: (r) => r.superNet,
  big: (r) => r.bigNet,
}
const ACC_RANK: Accessors<RankEntry, RankKey> = {
  net: (r) => r.totalNet,
  days: (r) => r.days,
  change: (r) => r.latestChangePct,
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

/** 元 → 亿(≥1亿) / 万，带符号（净额可正可负）。 */
function fmtYi(yuan: number): string {
  const sign = yuan < 0 ? '-' : ''
  const abs = Math.abs(yuan)
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`
  return `${sign}${(abs / 1e4).toFixed(0)}万`
}

function emHref(code: string): string {
  return `https://quote.eastmoney.com/${code.startsWith('6') ? 'sh' : 'sz'}${code}.html`
}

export default function MoneyFlowView({ t }: MoneyFlowViewProps) {
  const { data, loading, error, lastUpdated, refresh } = useMoneyFlow()
  const [source, setSource] = useState<Source>('lhb')
  const [period, setPeriod] = useState<Period>('today')

  const m = t.moneyflow
  const isToday = period === 'today'

  return (
    <section className="view-stack">
      <div className="panel-title themes-toolbar">
        <h2>{m.title}</h2>
        {data?.tradeDate && (
          <span className="themes-updated">
            {m.tradeDate} {data.tradeDate}
            {lastUpdated && ` · ${m.lastUpdated} ${lastUpdated.toLocaleTimeString()}`}
          </span>
        )}
        <button
          className="icon-button"
          onClick={refresh}
          disabled={loading}
          aria-label={m.refresh}
          title={m.refresh}
        >
          <ArrowClockwise size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <p className="muted-line">{m.hint}</p>

      <div className="moneyflow-controls">
        <div className="seg-group" role="radiogroup" aria-label={m.sourceLabel}>
          {(['lhb', 'fund'] as Source[]).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={source === s}
              className={`seg-btn ${source === s ? 'active' : ''}`}
              onClick={() => setSource(s)}
            >
              {m.sources[s]}
            </button>
          ))}
        </div>
        <div className="seg-group" role="radiogroup" aria-label={m.periodLabel}>
          {(['today', 'd3', 'd5'] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              className={`seg-btn ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {m.periods[p]}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="banner-error">{m.loadFail}</div>}

      {!data ? (
        <div className="data-table">
          <div className="table-row">{loading ? '…' : m.noData}</div>
        </div>
      ) : isToday && source === 'lhb' ? (
        <LhbTodayTable rows={data.lhb.today} t={t} />
      ) : isToday && source === 'fund' ? (
        <FundTodayTable rows={data.fundFlow.today} t={t} />
      ) : (
        <RankTable
          rows={source === 'lhb' ? (period === 'd3' ? data.lhb.d3 : data.lhb.d5) : period === 'd3' ? data.fundFlow.d3 : data.fundFlow.d5}
          t={t}
          netLabel={source === 'lhb' ? m.cols.totalNet : m.cols.totalMain}
        />
      )}
    </section>
  )
}

/** Reusable sortable header button. */
function SortTh<K extends string>({
  k,
  label,
  sortKey,
  sortDir,
  toggle,
  t,
}: {
  k: K
  label: string
  sortKey: K
  sortDir: 'asc' | 'desc'
  toggle: (k: K) => void
  t: Translation
}) {
  const active = sortKey === k
  return (
    <button
      type="button"
      className={`th-sort ${active ? 'active' : ''}`}
      onClick={() => toggle(k)}
      title={active && sortDir === 'desc' ? t.moneyflow.sortAsc : t.moneyflow.sortDesc}
    >
      {label}
      {active && (sortDir === 'asc' ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />)}
    </button>
  )
}

function StockName({ code, name }: { code: string; name: string }) {
  return (
    <span>
      <a href={emHref(code)} target="_blank" rel="noreferrer" className="theme-stock-name">
        {name}
      </a>
      <small>{code}</small>
    </span>
  )
}

function LhbTodayTable({ rows, t }: { rows: LhbRow[]; t: Translation }) {
  const { sorted, sortKey, sortDir, toggle } = useSortableRows<LhbRow, LhbKey>(rows, ACC_LHB, { key: 'net', dir: 'desc' })
  const c = t.moneyflow.cols
  const th = (k: LhbKey, label: string) => (
    <SortTh k={k} label={label} sortKey={sortKey} sortDir={sortDir} toggle={toggle} t={t} />
  )
  return (
    <div className="data-table moneyflow-lhb-table">
      <div className="table-row table-head">
        <span>{c.name}</span>
        {th('close', c.close)}
        {th('change', c.change)}
        {th('turnover', c.turnover)}
        {th('net', c.net)}
        <span>{c.reason}</span>
      </div>
      {sorted.length === 0 && <div className="table-row">{t.moneyflow.noData}</div>}
      {sorted.map((r) => (
        <div className="table-row" key={r.code}>
          <StockName code={r.code} name={r.name} />
          <span className="mono">{r.close.toFixed(2)}</span>
          <span className={`mono ${colorClass(r.changePct)}`}>{fmtPct(r.changePct)}</span>
          <span className="mono">{r.turnover.toFixed(2)}%</span>
          <span className={`mono ${colorClass(r.netAmt)}`}>{fmtYi(r.netAmt)}</span>
          <span className="moneyflow-reason" title={`${r.reason}${r.seat ? ' | ' + r.seat : ''}`}>
            {r.seat || r.reason}
          </span>
        </div>
      ))}
    </div>
  )
}

function FundTodayTable({ rows, t }: { rows: FundFlowRow[]; t: Translation }) {
  const { sorted, sortKey, sortDir, toggle } = useSortableRows<FundFlowRow, FundKey>(rows, ACC_FUND, { key: 'main', dir: 'desc' })
  const c = t.moneyflow.cols
  const th = (k: FundKey, label: string) => (
    <SortTh k={k} label={label} sortKey={sortKey} sortDir={sortDir} toggle={toggle} t={t} />
  )
  return (
    <div className="data-table moneyflow-fund-table">
      <div className="table-row table-head">
        <span>{c.name}</span>
        {th('price', c.price)}
        {th('change', c.change)}
        {th('main', c.mainNet)}
        {th('mainpct', c.mainNetPct)}
        {th('sup', c.superNet)}
        {th('big', c.bigNet)}
      </div>
      {sorted.length === 0 && <div className="table-row">{t.moneyflow.noData}</div>}
      {sorted.map((r) => (
        <div className="table-row" key={r.code}>
          <StockName code={r.code} name={r.name} />
          <span className="mono">{r.price.toFixed(2)}</span>
          <span className={`mono ${colorClass(r.changePct)}`}>{fmtPct(r.changePct)}</span>
          <span className={`mono ${colorClass(r.mainNet)}`}>{fmtYi(r.mainNet)}</span>
          <span className={`mono ${colorClass(r.mainNetPct)}`}>{r.mainNetPct.toFixed(1)}%</span>
          <span className={`mono ${colorClass(r.superNet)}`}>{fmtYi(r.superNet)}</span>
          <span className={`mono ${colorClass(r.bigNet)}`}>{fmtYi(r.bigNet)}</span>
        </div>
      ))}
    </div>
  )
}

function RankTable({ rows, t, netLabel }: { rows: RankEntry[]; t: Translation; netLabel: string }) {
  const { sorted, sortKey, sortDir, toggle } = useSortableRows<RankEntry, RankKey>(rows, ACC_RANK, { key: 'net', dir: 'desc' })
  const c = t.moneyflow.cols
  const th = (k: RankKey, label: string) => (
    <SortTh k={k} label={label} sortKey={sortKey} sortDir={sortDir} toggle={toggle} t={t} />
  )
  return (
    <div className="data-table moneyflow-rank-table">
      <div className="table-row table-head">
        <span>{c.name}</span>
        {th('net', netLabel)}
        {th('days', c.days)}
        {th('change', c.latestChange)}
      </div>
      {sorted.length === 0 && <div className="table-row">{t.moneyflow.noData}</div>}
      {sorted.map((r) => (
        <div className="table-row" key={r.code}>
          <StockName code={r.code} name={r.name} />
          <span className={`mono ${colorClass(r.totalNet)}`}>{fmtYi(r.totalNet)}</span>
          <span className="mono">
            {r.days}
            {t.moneyflow.daysSuffix}
          </span>
          <span className={`mono ${colorClass(r.latestChangePct)}`}>{fmtPct(r.latestChangePct)}</span>
        </div>
      ))}
    </div>
  )
}
