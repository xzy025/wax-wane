import { useEffect, useState } from 'react'
import { CaretDown, CaretUp, CircleNotch, Sparkle } from 'phosphor-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { fetchTaArchive, fetchTaArchiveDates, type HoldingsTAResult } from '../holdingsTA'
import type { Translation } from '../../types'
import { fmtPrice, fmtPct, pnlClass } from '../holdingsFormat'

interface Props {
  ta: HoldingsTAResult | null
  t: Translation
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

/** 盘后持仓叙事卡(汇总条之下):折叠=定调一句话,展开=完整 markdown;右上角日期下拉
 *  可回看历史存档(历史态=只读呈现该日叙事+每票紧凑表,不改下方持仓卡——持仓构成今昔不同)。
 *  无叙事且无历史存档时整卡隐藏(数据区在各持仓卡里,不缺信息)。 */
export function HoldingsNarrativeCard({ ta, t }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [dates, setDates] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [hist, setHist] = useState<HoldingsTAResult | null>(null)
  const [histLoading, setHistLoading] = useState(false)

  useEffect(() => {
    let alive = true
    void fetchTaArchiveDates().then((d) => {
      if (alive) setDates(d)
    })
    return () => {
      alive = false
    }
  }, [])

  const h = t.holdings.ta
  if (!ta?.narrative && dates.length === 0) return null

  const isHistorical = selected !== '' && hist !== null
  const showing = isHistorical ? hist : ta
  const narrative = showing?.narrative ?? null
  const bodyOpen = expanded || isHistorical

  const onSelect = (v: string) => {
    setSelected(v)
    setHist(null)
    if (!v) return
    setHistLoading(true)
    void fetchTaArchive(v).then((r) => {
      setHist(r)
      setHistLoading(false)
    })
  }

  return (
    <div className="hr-narrative">
      <div className="hr-narrative-head">
        <button type="button" className="hr-narrative-toggle" onClick={() => setExpanded((v) => !v)}>
          <Sparkle size={14} weight="fill" className="hr-narrative-icon" />
          <span className="hr-narrative-title">{h.narrativeTitle}</span>
          {showing && (
            <>
              <span className="hr-narrative-date hr-mono">{showing.date}</span>
              <span className={`hr-ta-chip hr-narrative-tag--${showing.settled ? 'settled' : 'live'}`}>
                {showing.settled ? h.settled : h.live}
              </span>
              <span className="hr-narrative-bench hr-mono">
                {h.bench.hs300} {pct(showing.benchmarks.hs300)} · {h.bench.chinext} {pct(showing.benchmarks.chinext)} ·{' '}
                {h.bench.star50} {pct(showing.benchmarks.star50)}
              </span>
            </>
          )}
          {!isHistorical && (expanded ? <CaretUp size={13} /> : <CaretDown size={13} />)}
        </button>
        {dates.length > 0 && (
          <select
            className="hr-narrative-select"
            value={selected}
            onChange={(ev) => onSelect(ev.target.value)}
            aria-label={h.history}
          >
            <option value="">{h.latest}</option>
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
      </div>

      {histLoading && (
        <div className="hr-narrative-tone">
          <CircleNotch size={13} className="ai-spin" />
        </div>
      )}

      {!histLoading && !bodyOpen && narrative?.tone && <div className="hr-narrative-tone">{narrative.tone}</div>}

      {!histLoading && bodyOpen && narrative && (
        <div className="ai-markdown hr-narrative-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative.markdown}</ReactMarkdown>
        </div>
      )}

      {!histLoading && isHistorical && showing && showing.items.length > 0 && (
        <div className="hr-hist-scroll">
          <table className="hr-hist-table">
            <thead>
              <tr>
                <th />
                <th>{t.holdings.price}</th>
                <th>{h.score}</th>
                <th>{h.trendTemplate}</th>
                <th>{h.dist52}</th>
                <th>{h.relStrength}</th>
              </tr>
            </thead>
            <tbody>
              {showing.items
                .filter((i) => !i.error)
                .map((i) => (
                  <tr key={i.code}>
                    <td>
                      {i.name} <span className="hr-card-code">{i.code}</span>
                    </td>
                    <td className="hr-mono">
                      {fmtPrice(i.close)} <small className={pnlClass(i.changePct)}>{fmtPct(i.changePct)}</small>
                    </td>
                    <td className="hr-mono">
                      {Math.round(i.combo.score01 * 100)} <small>{i.combo.wyckoffPhase}</small>
                    </td>
                    <td>{i.trendTemplateOk === null ? '—' : i.trendTemplateOk ? '✓' : '✗'}</td>
                    <td className="hr-mono">{i.dist52Pct <= 0 ? '✓' : `-${i.dist52Pct.toFixed(1)}%`}</td>
                    <td className="hr-mono">
                      {typeof i.relStrength === 'number' ? `${i.relStrength >= 0 ? '+' : ''}${i.relStrength.toFixed(1)}pp` : '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
