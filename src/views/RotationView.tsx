import { useEffect, useMemo, useState } from 'react'
import { ArrowClockwise, MagnifyingGlass, X } from 'phosphor-react'
import {
  useRotation,
  useBoardStocks,
  type RotationBoard,
  type RotationCategory,
  type Quadrant,
  type BoardStock,
} from '../hooks/useRotation'
import { useMarketStructure, type MarketStructureBoard } from '../hooks/useMarketStructure'
import DailyReviewCard from '../components/DailyReviewCard'
import RotationTempoGrid from '../components/RotationTempoGrid'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'
import type { Translation } from '../types'

interface RotationViewProps {
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

const LONG_WINS = [5, 10, 20, 60, 120]
const SHORT_WINS = [3, 5, 10]
// 象限渲染顺序与长/短方向(用于动态生成「N日涨 + 近M日跌 → 含义」描述)。
const QUADS: { key: Quadrant; longUp: boolean; shortUp: boolean }[] = [
  { key: 'hs', longUp: true, shortUp: true },
  { key: 'ls', longUp: false, shortUp: true },
  { key: 'hw', longUp: true, shortUp: false },
  { key: 'lw', longUp: false, shortUp: false },
]

function SegGroup<T extends string | number>({
  label,
  value,
  options,
  fmt,
  onPick,
}: {
  label: string
  value: T
  options: readonly T[]
  fmt: (v: T) => string
  onPick: (v: T) => void
}) {
  return (
    <div className="dt-segs">
      <span className="rot-seg-label">{label}</span>
      <div className="seg-group" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o)}
            type="button"
            role="radio"
            aria-checked={value === o}
            className={`seg-btn ${value === o ? 'active' : ''}`}
            onClick={() => onPick(o)}
          >
            {fmt(o)}
          </button>
        ))}
      </div>
    </div>
  )
}

function BoardCard({ b, t, active, onPick }: { b: RotationBoard; t: Translation; active: boolean; onPick: () => void }) {
  const rc = t.rotation.card
  return (
    <div
      className={`rot-card${active ? ' rot-card--active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPick()
        }
      }}
      title={t.rotation.drill.hint}
    >
      <div className="rot-card-top">
        <span className="rot-card-name">{b.name}</span>
        <span className={`rot-card-short ${colorClass(b.shortChg)}`}>{fmtPct(b.shortChg)}</span>
      </div>
      <div className="rot-card-meta">
        <span>
          {rc.long}
          <span className={colorClass(b.longChg)}>{fmtPct(b.longChg)}</span>
        </span>
        <span>
          {rc.today}
          <span className={colorClass(b.todayChg)}>{fmtPct(b.todayChg)}</span>
        </span>
      </div>
    </div>
  )
}

function StockCard({ c, t }: { c: BoardStock; t: Translation }) {
  const k = t.screener.card
  return (
    <div className="sc-card">
      <div className="sc-card-top">
        <span className="sc-card-name">{c.name}</span>
        <span className="sc-card-code">{c.code}</span>
        <span className="sc-score">{c.score}</span>
      </div>
      <div className="rot-sk-row">
        <span>
          {k.price} <b className={colorClass(c.changePct)}>{c.price.toFixed(2)}</b>
        </span>
        <span>
          {k.pivot} <b>{c.pivot.toFixed(2)}</b>
        </span>
      </div>
      <div className="rot-sk-row">
        <span>
          {k.stop} <b className="negative-text">{c.stopLoss.toFixed(2)}</b>
        </span>
        <span>
          {k.target} <b className="positive-text">{c.target.toFixed(2)}</b>
        </span>
      </div>
      <div className="rot-sk-row">
        <span>
          {k.hi52} <b>{c.dist52Pct.toFixed(1)}%</b>
        </span>
        <span>
          {k.dist} <b>{c.distToPivotPct.toFixed(1)}%</b>
        </span>
      </div>
      <div className="rot-sk-pattern">{c.signals.pattern}</div>
    </div>
  )
}

function BoardMiniRow({ b }: { b: MarketStructureBoard }) {
  return (
    <div className="rot-mover-row">
      <span className="rot-mover-name">{b.name}</span>
      <span className={`mono ${colorClass(b.shortChg)}`}>{fmtPct(b.shortChg)}</span>
    </div>
  )
}

/** 每日市场结构快照:涨跌停宽度 + 板块集中度(2×2象限计数)+ Top抱团/反转板块——
 *  固化"K型分化/抱团"分析,复用已有 rotation 象限 + kaipanla 情绪数据,盘后随「每日扫描」落盘。 */
function StructureCard({ t }: { t: Translation }) {
  const st = t.rotation.structure
  const { data, loading, error } = useMarketStructure()
  if (loading && !data) return null
  if (error && !data) return <div className="alert-item danger">{st.loadFail}</div>
  if (!data) return null
  // 情绪源(涨跌停/宽度)全 0 = 上游故障的退化档,不是「极端冰点」——零值面板会误导仓位判断,整段隐藏。
  const breadthOk = data.limitUp + data.limitDown + data.advanceCount + data.declineCount > 0
  return (
    <div className="rot-structure">
      <div className="rot-structure-head">
        <span className="rot-structure-title">{st.title}</span>
        {data.fromCache && <span className="rot-review-badge">{t.rotation.review.cached}</span>}
        <span className="themes-updated">
          {st.generatedAt} {new Date(data.generatedAt).toLocaleString()}
        </span>
      </div>
      {breadthOk && (
        <div className="rot-structure-stats">
          <span>{st.limitUp} <b className="positive-text">{data.limitUp}</b></span>
          <span>{st.limitDown} <b className="negative-text">{data.limitDown}</b></span>
          <span>{st.advance} <b className="positive-text">{data.advanceCount}</b></span>
          <span>{st.decline} <b className="negative-text">{data.declineCount}</b></span>
          <span>{st.breakRate} <b>{data.breakRate}%</b></span>
        </div>
      )}
      <div className="rot-structure-cols">
        <div className="rot-structure-col">
          <div className="rot-drill-grouptag">{st.topHs} ({data.hsCount})</div>
          <div className="rot-movers-list">
            {data.topHs.map((b) => (
              <BoardMiniRow key={b.code} b={b} />
            ))}
          </div>
        </div>
        <div className="rot-structure-col">
          <div className="rot-drill-grouptag">{st.topLs} ({data.lsCount})</div>
          <div className="rot-movers-list">
            {data.topLs.map((b) => (
              <BoardMiniRow key={b.code} b={b} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function RotationView({ t }: RotationViewProps) {
  const rt = t.rotation
  const [category, setCategory] = useState<RotationCategory>('industry')
  const [longWin, setLongWin] = useState(60)
  const [shortWin, setShortWin] = useState(5)
  const { data, loading, error, lastUpdated, refresh } = useRotation(category, longWin, shortWin)
  const [query, setQuery] = useState('')
  const [matchBoards, setMatchBoards] = useState<string[] | null>(null)
  const [searchInfo, setSearchInfo] = useState('')
  const [sel, setSel] = useState<{ code: string; name: string } | null>(null)
  const drill = useBoardStocks(sel?.code ?? null)

  // 搜个股 → 防抖取其所属板块名(用于过滤象限里的板块)。
  // cancelled 守卫:clearTimeout 只拦未发出的请求,已在飞的旧响应回来若照常 setMatchBoards,
  // 清空搜索框后象限会被已删除的搜索词幽灵过滤;res.ok 检查:500 的 {error} 体不能读成「该股无板块」。
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setMatchBoards(null)
      setSearchInfo('')
      return
    }
    let cancelled = false
    const h = setTimeout(async () => {
      try {
        const res = await fetchWithTimeout(`/api/rotation/stock-boards?q=${encodeURIComponent(q)}`, 15_000)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { code?: string; name?: string; boards?: string[] }
        if (cancelled) return
        setMatchBoards(json.boards ?? [])
        setSearchInfo(json.name ? `${json.name}${json.code ? ` (${json.code})` : ''}` : '')
      } catch {
        if (cancelled) return
        setMatchBoards(null)
        setSearchInfo('')
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(h)
    }
  }, [query])

  const norm = (s: string) => s.replace(/概念$/, '')
  const boards = useMemo(() => {
    if (!data) return []
    if (!matchBoards) return data.boards
    if (matchBoards.length === 0) return [] // 搜了但该股无所属板块命中
    return data.boards.filter((b) =>
      matchBoards.some((m) => norm(m) === norm(b.name) || b.name.includes(norm(m)) || norm(m).includes(b.name)),
    )
  }, [data, matchBoards])

  const lastStr = lastUpdated ? lastUpdated.toLocaleTimeString() : ''

  return (
    <div className="panel">
      <div className="panel-title themes-toolbar">
        <div className="rot-search">
          <MagnifyingGlass size={15} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={rt.searchPlaceholder}
            aria-label={rt.searchPlaceholder}
          />
        </div>
        <div className="rot-toolbar-right">
          <SegGroup
            label={rt.category.label}
            value={category}
            options={['industry', 'concept'] as const}
            fmt={(c) => (c === 'industry' ? rt.category.industry : rt.category.concept)}
            onPick={setCategory}
          />
          <SegGroup label={rt.longLabel} value={longWin} options={LONG_WINS} fmt={(n) => `${n}${rt.dayN}`} onPick={setLongWin} />
          <SegGroup label={rt.shortLabel} value={shortWin} options={SHORT_WINS} fmt={(n) => `${n}${rt.dayN}`} onPick={setShortWin} />
          <button className="icon-button" onClick={refresh} disabled={loading} aria-label={rt.refresh} title={rt.refresh}>
            <ArrowClockwise size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <DailyReviewCard t={t} />

      <StructureCard t={t} />

      <RotationTempoGrid t={t} />

      {error && !data && <div className="alert-item danger">{rt.loadFail}</div>}
      {!data && loading && <div className="themes-desc">{rt.scanning}</div>}

      {data && (
        <>
          <div className="rot-summary">
            <span className="rot-summary-main">
              {data.category === 'industry' ? rt.category.industry : rt.category.concept} · {data.summary.total}
              {rt.boardsUnit}
              {searchInfo && <span className="rot-search-info"> · {searchInfo}</span>}
            </span>
            <span className="rot-summary-counts">
              <span className="rot-pill rot-pill--hs">{rt.quads.hs.tag} {data.summary.hs}</span>
              <span className="rot-pill rot-pill--ls">{rt.quads.ls.tag} {data.summary.ls}</span>
              <span className="rot-pill rot-pill--hw">{rt.quads.hw.tag} {data.summary.hw}</span>
              <span className="rot-pill rot-pill--lw">{rt.quads.lw.tag} {data.summary.lw}</span>
            </span>
            <span className={`rot-breadth ${data.summary.shortUpPct >= 50 ? 'positive-text' : 'negative-text'}`}>
              {rt.recent}
              {shortWin}
              {rt.dayN}
              {rt.shortUpShare} {data.summary.shortUpPct}%
            </span>
          </div>

          <div className="rot-board">
            {QUADS.map((q) => {
              const items = boards.filter((b) => b.quadrant === q.key)
              const meta = rt.quads[q.key]
              const desc = `${longWin}${rt.dayN}${q.longUp ? rt.up : rt.down} + ${rt.recent}${shortWin}${rt.dayN}${q.shortUp ? rt.up : rt.down} → ${meta.meaning}`
              return (
                <div key={q.key} className={`rot-quad rot-quad--${q.key}`}>
                  <div className="rot-quad-head">
                    <span className="rot-quad-tag">{meta.tag}</span>
                    <span className="rot-quad-desc">
                      {desc} ({items.length})
                    </span>
                  </div>
                  <div className="rot-quad-body">
                    {items.length === 0 ? (
                      <div className="sc-empty">{rt.empty}</div>
                    ) : (
                      items.map((b) => (
                        <BoardCard
                          key={b.code}
                          b={b}
                          t={t}
                          active={sel?.code === b.code}
                          onPick={() => setSel({ code: b.code, name: b.name })}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {sel && (
            <div className="rot-drill">
              <div className="rot-drill-head">
                <span className="rot-drill-title">
                  {sel.name} · {rt.drill.title}
                </span>
                <button className="icon-button" onClick={() => setSel(null)} aria-label={rt.drill.close} title={rt.drill.close}>
                  <X size={15} />
                </button>
              </div>
              {drill.loading && <div className="themes-desc">{rt.drill.loading}</div>}
              {drill.error && <div className="alert-item danger">{rt.drill.loadFail}</div>}
              {drill.data &&
                (drill.data.breakout.length === 0 && drill.data.trigger.length === 0 && drill.data.topMovers.length === 0 ? (
                  <div className="sc-empty">{rt.drill.empty}</div>
                ) : (
                  <>
                    {drill.data.topMovers.length > 0 && (
                      <div className="rot-drill-group">
                        <div className="rot-drill-grouptag">
                          {rt.drill.topMovers} ({drill.data.topMovers.length})
                        </div>
                        <div className="rot-movers-list">
                          {drill.data.topMovers.map((m) => (
                            <div key={m.code} className="rot-mover-row">
                              <span className="rot-mover-name">{m.name}</span>
                              <span className="rot-mover-code mono">{m.code}</span>
                              <span className={`mono ${colorClass(m.changePct)}`}>{fmtPct(m.changePct)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {drill.data.breakout.length > 0 && (
                      <div className="rot-drill-group">
                        <div className="rot-drill-grouptag">
                          {rt.drill.breakout} ({drill.data.breakout.length})
                        </div>
                        <div className="sc-grid">
                          {drill.data.breakout.map((c) => (
                            <StockCard key={c.code} c={c} t={t} />
                          ))}
                        </div>
                      </div>
                    )}
                    {drill.data.trigger.length > 0 && (
                      <div className="rot-drill-group">
                        <div className="rot-drill-grouptag">
                          {rt.drill.trigger} ({drill.data.trigger.length})
                        </div>
                        <div className="sc-grid">
                          {drill.data.trigger.map((c) => (
                            <StockCard key={c.code} c={c} t={t} />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ))}
            </div>
          )}

          <div className="themes-updated rot-foot">
            {rt.legend} {lastStr && `· ${rt.lastUpdated} ${lastStr}`}
          </div>
        </>
      )}
    </div>
  )
}

export default RotationView
