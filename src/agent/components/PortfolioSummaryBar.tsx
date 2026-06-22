import { Warning, ClipboardText } from 'phosphor-react'
import type { PortfolioSummary } from '../holdingsReview'
import type { Translation } from '../../types'
import { fmtNum, fmtSigned, fmtPct, pnlClass } from '../holdingsFormat'

interface Props {
  summary: PortfolioSummary
  t: Translation
}

export function PortfolioSummaryBar({ summary, t }: Props) {
  const h = t.holdings
  const a = h.actions

  return (
    <div className="hr-summary">
      <div className="hr-summary-stats">
        <div className="hr-stat">
          <span className="hr-stat-label">{h.summary.holdingsCount}</span>
          <span className="hr-stat-value">
            {summary.count} {h.shares === 'sh' ? '' : '只'}
          </span>
        </div>
        <div className="hr-stat">
          <span className="hr-stat-label">{h.marketValue}</span>
          <span className="hr-stat-value hr-mono">{fmtNum(summary.totalMarketValue)}</span>
        </div>
        <div className="hr-stat">
          <span className="hr-stat-label">{h.unrealized}</span>
          <span className={`hr-stat-value hr-mono ${pnlClass(summary.totalUnrealizedPnl)}`}>
            {fmtSigned(summary.totalUnrealizedPnl)} ({fmtPct(summary.totalUnrealizedPct)})
          </span>
        </div>
        <div className="hr-stat">
          <span className="hr-stat-label">{h.summary.today}</span>
          <span className={`hr-stat-value hr-mono ${pnlClass(summary.todayChangePct)}`}>
            {fmtPct(summary.todayChangePct)}
          </span>
        </div>
        {summary.worst && (
          <div className="hr-stat">
            <span className="hr-stat-label">{h.summary.worst}</span>
            <span className={`hr-stat-value ${pnlClass(summary.worst.unrealizedPct)}`}>
              {summary.worst.name} {fmtPct(summary.worst.unrealizedPct)}
            </span>
          </div>
        )}
      </div>

      <div className={`hr-summary-risk ${summary.risks.length > 0 ? 'is-alert' : ''}`}>
        <Warning size={14} weight="fill" />
        <span className="hr-summary-risk-label">{h.summary.risk}:</span>
        <span>
          {summary.risks.length > 0
            ? summary.risks.map((r) => `${r.name} ${a[r.action]}`).join(' · ')
            : h.summary.noRisk}
        </span>
      </div>

      <div className="hr-summary-plan">
        <ClipboardText size={14} weight="fill" />
        <span className="hr-summary-risk-label">{h.summary.plan}:</span>
        {summary.plan.length > 0 ? (
          <ol className="hr-plan-list">
            {summary.plan.map((p) => (
              <li key={p.code}>
                <span className={`hr-plan-action hr-badge--${p.action}`}>{a[p.action]}</span>
                <strong>{p.name}</strong>
                <span className="hr-plan-reason">{p.reason}</span>
              </li>
            ))}
          </ol>
        ) : (
          <span>{h.summary.noPlan}</span>
        )}
      </div>
    </div>
  )
}
