import { useState } from 'react'
import { PushPin } from 'phosphor-react'
import { useRotationTempo, type TempoRow, type TempoNote } from '../hooks/useRotationTempo'
import { getTempoPins, toggleTempoPin } from '../utils/tempoPins'
import { fmt } from '../i18n'
import type { Translation } from '../types'

const MAX_AUTO_ROWS = 25 // 未钉选的活跃行上限(钉选行不占额度)

/** A股红涨绿跌(同 RotationView 惯例)。 */
function colorClass(n: number): string {
  if (n === 0) return ''
  return n > 0 ? 'positive-text' : 'negative-text'
}
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

/** 板块轮动节奏表:板块×最近5交易日,格=启动/调整第N天+强弱注记(游资复盘表口径,非战法)。 */
export default function RotationTempoGrid({ t }: { t: Translation }) {
  const tp = t.rotation.tempo
  const [pins, setPins] = useState<string[]>(getTempoPins)
  const { data, loading, error } = useRotationTempo(pins)
  if (loading && !data) return null
  if (error && !data) return <div className="alert-item danger">{tp.loadFail}</div>
  if (!data) return null

  const pinnedRows = pins
    .map((p) => data.rows.find((r) => r.code === p))
    .filter((r): r is TempoRow => r !== undefined)
  const autoRows = data.rows
    .filter((r) => r.active && !pins.includes(r.code))
    .sort((a, b) => b.heat - a.heat || (b.cells[b.cells.length - 1]?.chg ?? 0) - (a.cells[a.cells.length - 1]?.chg ?? 0))
    .slice(0, MAX_AUTO_ROWS)
  const rows = [...pinnedRows, ...autoRows]

  const srcLabel = { 'em-industry': tp.srcIndustry, 'em-concept': tp.srcConcept, 'kpl-theme': tp.srcTheme } as const
  const qLabel = { aboveIndex: tp.qAboveIndex, volUp: tp.qVolUp, volDown: tp.qVolDown, resilient: tp.qResilient } as const
  const nLabel = { soloStrong: tp.nSoloStrong, split: tp.nSplit, inflow: tp.nInflow } as const
  const noteText = (n: TempoNote) => `${nLabel[n.kind]}${n.detail ? ` ${n.detail}` : ''}`
  const lastDate = data.dates[data.dates.length - 1]

  return (
    <div className="rtempo">
      <div className="rot-structure-head">
        <span className="rot-structure-title">
          {tp.title} · {data.asof}
          {data.fromArchive && <span className="rot-review-badge">{tp.badgeArchive}</span>}
          {!data.fromArchive && data.sources.em === 'recon' && (
            <span className="rot-review-badge" title={tp.reconTip}>
              {tp.badgeRecon}
            </span>
          )}
        </span>
        <span className="themes-updated">{tp.legend}</span>
      </div>
      {rows.length === 0 ? (
        <div className="rot-review-nonarrative">{tp.empty}</div>
      ) : (
        <div className="rtempo-scroll">
          <div className="rtempo-grid" style={{ gridTemplateColumns: `148px repeat(${data.dates.length}, minmax(108px, 1fr))` }}>
            {/* 表头 */}
            <div className="rtempo-corner" />
            {data.dates.map((d) => (
              <div key={d} className="rtempo-head mono">
                {d.slice(5)}
              </div>
            ))}
            {/* 基准指数行(灰,仅涨跌) */}
            <div className="rtempo-name rtempo-name--bench">{data.benchmark.name}</div>
            {data.dates.map((d) => {
              const c = data.benchmark.cells.find((x) => x.date === d)
              return (
                <div key={d} className="rtempo-cell rtempo-cell--bench">
                  {c ? <b className={`mono ${colorClass(c.chg)}`}>{fmtPct(c.chg)}</b> : <span className="rtempo-miss">—</span>}
                </div>
              )
            })}
            {/* 板块行 */}
            {rows.map((row) => (
              <RowCells
                key={row.code}
                row={row}
                dates={data.dates}
                lastDate={lastDate}
                pinned={pins.includes(row.code)}
                onPin={() => setPins(toggleTempoPin(row.code))}
                srcLabel={srcLabel[row.source]}
                qLabel={qLabel}
                noteText={noteText}
                tp={tp}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RowCells({
  row,
  dates,
  lastDate,
  pinned,
  onPin,
  srcLabel,
  qLabel,
  noteText,
  tp,
}: {
  row: TempoRow
  dates: string[]
  lastDate: string
  pinned: boolean
  onPin: () => void
  srcLabel: string
  qLabel: Record<string, string>
  noteText: (n: TempoNote) => string
  tp: Translation['rotation']['tempo']
}) {
  return (
    <>
      <div className="rtempo-name">
        <button
          type="button"
          className={`rtempo-pin${pinned ? ' rtempo-pin--on' : ''}`}
          title={pinned ? tp.unpin : tp.pin}
          onClick={onPin}
        >
          <PushPin size={13} weight={pinned ? 'fill' : 'regular'} />
        </button>
        <span className="rtempo-name-text" title={row.recon ? tp.reconTip : undefined}>
          {row.name}
        </span>
        <span className="rtempo-src">{srcLabel}</span>
      </div>
      {dates.map((d) => {
        const c = row.cells.find((x) => x.date === d)
        if (!c) {
          return (
            <div key={d} className="rtempo-cell">
              <span className="rtempo-miss">—</span>
            </div>
          )
        }
        const label = c.state === 'launch' ? fmt(tp.cellLaunch, c.dayN) : fmt(tp.cellAdjust, c.dayN)
        const isToday = d === lastDate
        return (
          <div key={d} className={`rtempo-cell rtempo-cell--${c.tier}`}>
            <div className="rtempo-cell-main">
              <span>{label}</span>
              <b className={`mono ${colorClass(c.chg)}`}>{fmtPct(c.chg)}</b>
            </div>
            {(c.qualifiers.length > 0 || (isToday && row.notes.length > 0)) && (
              <div className="rtempo-chips">
                {c.qualifiers.map((q) => (
                  <span key={q} className="rtempo-chip">
                    {qLabel[q]}
                  </span>
                ))}
                {isToday &&
                  row.notes.map((n) => (
                    <span key={n.kind} className="rtempo-chip rtempo-chip--note" title={n.detail}>
                      {noteText(n)}
                    </span>
                  ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
