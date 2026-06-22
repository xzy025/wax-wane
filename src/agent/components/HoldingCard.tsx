import { useState, useCallback } from 'react'
import { CaretDown, CaretUp, CircleNotch, PencilSimple, Trash, MagnifyingGlassPlus } from 'phosphor-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { HoldingSignal } from '../holdingsReview'
import type { AppState } from '../../store'
import type { Translation } from '../../types'
import { StockAnalysisOrchestrator } from '../multi-agent/orchestrators/stock-analysis.orchestrator'
import { fmtNum, fmtSigned, fmtPrice, fmtPct, pnlClass } from '../holdingsFormat'

interface Props {
  signal: HoldingSignal
  appState: AppState
  language: 'zh' | 'en'
  t: Translation
  onEdit: (signal: HoldingSignal) => void
  onRemove: (signal: HoldingSignal) => void
}

export function HoldingCard({ signal, appState, language, t, onEdit, onRemove }: Props) {
  const h = t.holdings
  const { holding, technical, action } = signal
  const [expanded, setExpanded] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)

  const runDeepDive = useCallback(async () => {
    setLoadingReport(true)
    try {
      const orchestrator = new StockAnalysisOrchestrator()
      const userMessage = `分析${holding.name} ${holding.code}`
      let final = ''
      for await (const ev of orchestrator.execute(appState, userMessage, language)) {
        if (ev.type === 'complete' && typeof ev.data === 'string') final = ev.data
      }
      setReport(final || (language === 'zh' ? '未能生成分析报告' : 'No report generated'))
    } catch (err) {
      setReport(`⚠ ${err instanceof Error ? err.message : 'error'}`)
    } finally {
      setLoadingReport(false)
    }
  }, [appState, holding.code, holding.name, language])

  const toggleExpand = useCallback(() => {
    const next = !expanded
    setExpanded(next)
    if (next && report === null && !loadingReport) void runDeepDive()
  }, [expanded, report, loadingReport, runDeepDive])

  return (
    <div className="hr-card">
      <div className="hr-card-top">
        <div className="hr-card-id">
          <span className="hr-card-name">{holding.name}</span>
          <span className="hr-card-code">{holding.code}</span>
          {holding.source === 'manual' && <span className="hr-tag-manual">{h.manual}</span>}
        </div>
        <span className={`hr-badge hr-badge--${action.action}`}>{h.actions[action.action]}</span>
      </div>

      {signal.error ? (
        <div className="hr-card-error">{signal.error || h.quoteError}</div>
      ) : (
        <>
          <div className="hr-card-metrics">
            <div className="hr-metric">
              <span className="hr-metric-label">{h.price}</span>
              <span className="hr-metric-value hr-mono">
                {fmtPrice(signal.price)}
                <small className={pnlClass(signal.changePct)}> {fmtPct(signal.changePct)}</small>
              </span>
            </div>
            <div className="hr-metric">
              <span className="hr-metric-label">{h.cost}</span>
              <span className="hr-metric-value hr-mono">{fmtPrice(holding.avgCost)}</span>
            </div>
            <div className="hr-metric">
              <span className="hr-metric-label">
                {holding.quantity}
                {language === 'zh' ? ' 股' : ' sh'}
              </span>
              <span className="hr-metric-value hr-mono">{fmtNum(signal.marketValue)}</span>
            </div>
            <div className="hr-metric">
              <span className="hr-metric-label">{h.unrealized}</span>
              <span className={`hr-metric-value hr-mono ${pnlClass(signal.unrealizedPnl)}`}>
                {fmtSigned(signal.unrealizedPnl)}
                <small> {fmtPct(signal.unrealizedPct)}</small>
              </span>
            </div>
          </div>

          <div className="hr-card-levels">
            {action.stopLoss != null && (
              <span className="hr-level">
                {h.stopLoss} <strong className="negative-text">{fmtPrice(action.stopLoss)}</strong>
              </span>
            )}
            {action.target != null && (
              <span className="hr-level">
                {h.target} <strong className="positive-text">{fmtPrice(action.target)}</strong>
              </span>
            )}
            {technical && (
              <>
                <span className="hr-level">
                  {h.volumeRatio} <strong>{technical.volumeRatio.toFixed(2)}</strong>
                </span>
                <span className={`hr-signal hr-signal--${technical.signal}`}>
                  {h.signalLabels[technical.signal]}
                </span>
              </>
            )}
          </div>

          <div className="hr-card-reason">{action.reason}</div>
        </>
      )}

      <div className="hr-card-foot">
        <button type="button" className="hr-deepdive-btn" onClick={toggleExpand}>
          <MagnifyingGlassPlus size={14} />
          {expanded ? h.collapse : h.deepDive}
          {expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
        </button>
        <div className="hr-card-foot-actions">
          <button type="button" className="hr-icon-btn" onClick={() => onEdit(signal)} aria-label={h.edit}>
            <PencilSimple size={14} />
          </button>
          <button type="button" className="hr-icon-btn" onClick={() => onRemove(signal)} aria-label={h.remove}>
            <Trash size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="hr-card-deep">
          {loadingReport ? (
            <div className="hr-deep-loading">
              <CircleNotch size={16} className="ai-spin" /> {h.analyzing}
            </div>
          ) : (
            <div className="ai-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{report ?? ''}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
