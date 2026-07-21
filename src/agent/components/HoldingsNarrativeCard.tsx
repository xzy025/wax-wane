import { useState } from 'react'
import { CaretDown, CaretUp, Sparkle } from 'phosphor-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { HoldingsTAResult } from '../holdingsTA'
import type { Translation } from '../../types'

interface Props {
  ta: HoldingsTAResult | null
  t: Translation
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

/** 盘后持仓叙事卡(PortfolioSummaryBar 之下):折叠=定调一句话,展开=完整 markdown。
 *  叙事 best-effort:无叙事时整卡隐藏(数据区在各持仓卡里,不缺信息)。 */
export function HoldingsNarrativeCard({ ta, t }: Props) {
  const [expanded, setExpanded] = useState(false)
  if (!ta || !ta.narrative) return null
  const h = t.holdings.ta
  const b = ta.benchmarks

  return (
    <div className="hr-narrative">
      <button type="button" className="hr-narrative-head" onClick={() => setExpanded((v) => !v)}>
        <Sparkle size={14} weight="fill" className="hr-narrative-icon" />
        <span className="hr-narrative-title">{h.narrativeTitle}</span>
        <span className="hr-narrative-date hr-mono">{ta.date}</span>
        <span className={`hr-ta-chip hr-narrative-tag--${ta.settled ? 'settled' : 'live'}`}>
          {ta.settled ? h.settled : h.live}
        </span>
        <span className="hr-narrative-bench hr-mono">
          {h.bench.hs300} {pct(b.hs300)} · {h.bench.chinext} {pct(b.chinext)} · {h.bench.star50} {pct(b.star50)}
        </span>
        {expanded ? <CaretUp size={13} /> : <CaretDown size={13} />}
      </button>
      {!expanded && ta.narrative.tone && <div className="hr-narrative-tone">{ta.narrative.tone}</div>}
      {expanded && (
        <div className="ai-markdown hr-narrative-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{ta.narrative.markdown}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}
