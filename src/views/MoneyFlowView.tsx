import { useState, type ReactNode } from 'react'
import { ArrowUp, ArrowDown } from 'phosphor-react'
import { useMoneyFlow, useTradingDates, type LhbStock, type Seat } from '../hooks/useMoneyFlow'
import MarketDatePicker, { getLastTradingDay } from '../components/MarketDatePicker'
import type { Translation } from '../types'

interface MoneyFlowViewProps {
  t: Translation
  language: 'zh' | 'en'
}

type FlowFilter = 'all' | 'inflow' | 'outflow'
type Period = 1 | 3 | 5

/** A-share convention: red = up/inflow, green = down/outflow. Null/0 → neutral. */
function colorClass(n: number | null): string {
  if (n == null || n === 0) return ''
  return n > 0 ? 'positive-text' : 'negative-text'
}

function fmtPct(n: number | null): string {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

/** 元 → 亿(≥1亿) / 万，带符号。 */
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
  const [period, setPeriod] = useState<Period>(1)
  const [date, setDate] = useState('') // '' → latest trading day
  const { dates, latest } = useTradingDates()
  const { data, loading, error, lastUpdated, refresh } = useMoneyFlow(date || undefined, period)
  const [flow, setFlow] = useState<FlowFilter>('all')
  const [concept, setConcept] = useState<string | null>(null) // null → 全部

  const m = t.moneyflow
  const selectedDate = date || latest || getLastTradingDay()

  const matchConcept = (s: LhbStock) => !concept || s.concepts.includes(concept)
  const buy = (data?.buy ?? []).filter(matchConcept)
  const sell = (data?.sell ?? []).filter(matchConcept)
  const totalCount = (data?.buy.length ?? 0) + (data?.sell.length ?? 0)
  // 概念太多会糊成墙：只保留出现 ≥2 次的共性概念作筛选 chips。
  const conceptChips = (data?.concepts ?? []).filter((c) => c.count >= 2)

  const showBuy = flow !== 'outflow'
  const showSell = flow !== 'inflow'

  return (
    <section className="view-stack">
      <div className="panel-title themes-toolbar">
        <h2>{m.title}</h2>
        <MarketDatePicker
          selectedDate={selectedDate}
          onSelect={setDate}
          onRefresh={refresh}
          t={t}
          availableDates={dates.size ? dates : undefined}
        />
        {lastUpdated && (
          <span className="themes-updated">
            {loading ? '…' : `${m.lastUpdated} ${lastUpdated.toLocaleTimeString()}`}
          </span>
        )}
      </div>

      <p className="muted-line">{m.hint}</p>

      {error && <div className="banner-error">{m.loadFail}</div>}

      <div className="dt-segs">
        <div className="seg-group" role="radiogroup" aria-label={m.periodLabel}>
          {([1, 3, 5] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              className={`seg-btn ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {p === 1 ? m.periods.today : p === 3 ? m.periods.d3 : m.periods.d5}
            </button>
          ))}
        </div>
      </div>

      {/* 汇总 */}
      <div className="dt-summary">
        <Stat label={m.summary.inflowCount} value={`${data?.summary.inflowCount ?? 0}${m.stocksUnit}`} tone="up" />
        <Stat label={m.summary.outflowCount} value={`${data?.summary.outflowCount ?? 0}${m.stocksUnit}`} tone="down" />
        <Stat label={m.summary.totalInflow} value={fmtYi(data?.summary.totalInflow ?? 0)} tone="up" />
        <Stat label={m.summary.totalOutflow} value={fmtYi(data?.summary.totalOutflow ?? 0)} tone="down" />
      </div>

      {/* 筛选：净流入/净流出 + 概念 */}
      <div className="dt-filter">
        <div className="seg-group" role="radiogroup" aria-label={m.filter.all}>
          {(['all', 'inflow', 'outflow'] as FlowFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={flow === f}
              className={`seg-btn ${flow === f ? 'active' : ''}`}
              onClick={() => setFlow(f)}
            >
              {m.filter[f]}
            </button>
          ))}
        </div>
        {conceptChips.length > 0 && (
          <div className="dt-chips">
            <button
              type="button"
              className={`filter-chip ${concept === null ? 'active' : ''}`}
              onClick={() => setConcept(null)}
            >
              {m.conceptAll} ({totalCount})
            </button>
            {conceptChips.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`filter-chip ${concept === c.name ? 'active' : ''}`}
                onClick={() => setConcept(concept === c.name ? null : c.name)}
              >
                {c.name} ({c.count})
              </button>
            ))}
          </div>
        )}
      </div>

      {!data ? (
        <div className="data-table">
          <div className="table-row">{loading ? '…' : m.noData}</div>
        </div>
      ) : totalCount === 0 ? (
        <div className="data-table">
          <div className="table-row">{m.noData}</div>
        </div>
      ) : (
        <div className="dt-board">
          {showBuy && (
            <Column title={m.buyTitle} count={buy.length} dir="up">
              {buy.map((s) => (
                <LhbCard key={s.code} s={s} t={t} showDays={period > 1} />
              ))}
            </Column>
          )}
          {showSell && (
            <Column title={m.sellTitle} count={sell.length} dir="down">
              {sell.map((s) => (
                <LhbCard key={s.code} s={s} t={t} showDays={period > 1} />
              ))}
            </Column>
          )}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'up' | 'down' }) {
  return (
    <div className="dt-stat">
      <span className="dt-stat-label">{label}</span>
      <span className={`dt-stat-value mono ${tone === 'up' ? 'positive-text' : 'negative-text'}`}>{value}</span>
    </div>
  )
}

function Column({
  title,
  count,
  dir,
  children,
}: {
  title: string
  count: number
  dir: 'up' | 'down'
  children: ReactNode
}) {
  return (
    <div className="dt-col">
      <h3 className={`dt-col-head ${dir === 'up' ? 'positive-text' : 'negative-text'}`}>
        {dir === 'up' ? <ArrowUp size={15} weight="bold" /> : <ArrowDown size={15} weight="bold" />}
        {title} <small>({count})</small>
      </h3>
      <div className="dt-col-body">{children}</div>
    </div>
  )
}

function LhbCard({ s, t, showDays }: { s: LhbStock; t: Translation; showDays: boolean }) {
  const m = t.moneyflow
  const up = s.netAmt >= 0
  return (
    <article className={`dt-card ${up ? 'is-buy' : 'is-sell'}`}>
      <div className="dt-card-head">
        <span className="dt-name">
          <a href={emHref(s.code)} target="_blank" rel="noreferrer" className="theme-stock-name">
            {s.name}
          </a>
          <small>{s.code}</small>
          {showDays && (
            <span className="dt-days">
              {m.daysOnBoard} {s.days}
              {m.daysSuffix}
            </span>
          )}
        </span>
        <span className={`dt-net mono ${colorClass(s.netAmt)}`}>
          {up ? '↑' : '↓'} {fmtYi(s.netAmt)}
        </span>
      </div>

      <div className="dt-card-sub">
        <span className={`mono ${colorClass(s.changePct)}`}>{fmtPct(s.changePct)}</span>
        <span className="dt-deal">
          {m.dealAmt} <b className="mono">{fmtYi(s.dealAmt)}</b>
        </span>
      </div>

      {s.reason && (
        <p className="dt-reason" title={s.reason}>
          <span className="dt-reason-label">{m.reasonLabel}</span>
          {s.reason}
        </p>
      )}

      <SeatRow label={m.buySeats} seats={s.buySeats} tone="up" />
      <SeatRow label={m.sellSeats} seats={s.sellSeats} tone="down" />

      <div className="dt-card-foot">
        {s.concepts.length > 0 && (
          <div className="dt-tags">
            {s.concepts.map((c) => (
              <span className="dt-tag" key={c}>
                {c}
              </span>
            ))}
          </div>
        )}
        <a href={emHref(s.code)} target="_blank" rel="noreferrer" className="dt-quote-link">
          {m.quote}
        </a>
      </div>
    </article>
  )
}

function SeatRow({ label, seats, tone }: { label: string; seats: Seat[]; tone: 'up' | 'down' }) {
  if (seats.length === 0) return null
  return (
    <div className="dt-seats">
      <span className="dt-seats-label">{label}</span>
      <span className="dt-seat-list">
        {seats.map((seat, i) => (
          <span className={`dt-seat ${tone === 'up' ? 'is-buy' : 'is-sell'}`} key={`${seat.name}-${i}`}>
            {seat.name}
            <b className="mono">{fmtYi(seat.amount)}</b>
          </span>
        ))}
      </span>
    </div>
  )
}
