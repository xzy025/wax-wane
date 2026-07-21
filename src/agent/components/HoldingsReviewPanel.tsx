import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { ArrowsClockwise, Plus, CircleNotch, Moon, ChartLineUp, Wallet } from 'phosphor-react'
import { useAppState } from '../../store'
import { useManualHoldings } from '../holdingsStore'
import { deriveAutoHoldings, mergeHoldings, type ManualHolding } from '../../engine/holdings'
import { analyzeHolding, buildPortfolioSummary, type HoldingSignal, type PortfolioSummary } from '../holdingsReview'
import { fetchHoldingsTA, refreshHoldingsTACache, type HoldingsTAResult } from '../holdingsTA'
import { getMarketStatus, type MarketPhase } from '../../utils/marketStatus'
import type { Translation } from '../../types'
import { HoldingCard } from './HoldingCard'
import { HoldingEditor } from './HoldingEditor'
import { HoldingsNarrativeCard } from './HoldingsNarrativeCard'
import { PortfolioSummaryBar } from './PortfolioSummaryBar'

interface Props {
  t: Translation
  language: 'zh' | 'en'
}

const PHASE_LABEL: Record<MarketPhase, keyof Translation['holdings']['market']> = {
  afterMarket: 'closed',
  open: 'open',
  weekend: 'weekend',
  preMarket: 'pre',
  beforeOpen: 'before',
}

export function HoldingsReviewPanel({ t, language }: Props) {
  const appState = useAppState()
  const { manualHoldings, addOrUpdate, remove, hide } = useManualHoldings()

  const holdings = useMemo(
    () => mergeHoldings(deriveAutoHoldings(appState.trades), manualHoldings),
    [appState.trades, manualHoldings],
  )

  const [signals, setSignals] = useState<HoldingSignal[]>([])
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [ta, setTa] = useState<HoldingsTAResult | null>(null)
  const [editing, setEditing] = useState<ManualHolding | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const reqId = useRef(0)
  const taReqId = useRef(0)

  const market = useMemo(() => getMarketStatus(), [])

  const runReview = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const sigs = await Promise.all(holdings.map(analyzeHolding))
      if (id !== reqId.current) return // a newer run superseded this one
      setSignals(sigs)
      const sum = buildPortfolioSummary(sigs)
      setSummary(sum)
      try {
        localStorage.setItem(
          `holdings-review-${market.todayStr}`,
          JSON.stringify({ at: market.todayStr, signals: sigs }),
        )
      } catch {
        /* snapshot is best-effort */
      }
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [holdings, market.todayStr])

  // 服务端深度 TA:与 runReview 独立取数(quote 失败不拖 TA,反之亦然),best-effort。
  const runTa = useCallback(
    async (force = false) => {
      const id = ++taReqId.current
      if (force) await refreshHoldingsTACache()
      const result = await fetchHoldingsTA(holdings.map((h) => ({ code: h.code, avgCost: h.avgCost })))
      if (id === taReqId.current) setTa(result)
    },
    [holdings],
  )

  // Auto-run on mount and whenever the holdings set changes. The reqId guard in
  // runReview makes the immediate setLoading(true) safe against cascading runs.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runReview()
    void runTa()
  }, [runReview, runTa])

  const openAdd = useCallback(() => {
    setEditing(null)
    setEditorOpen(true)
  }, [])

  const handleEdit = useCallback((signal: HoldingSignal) => {
    const { holding } = signal
    setEditing({ code: holding.code, name: holding.name, quantity: holding.quantity, avgCost: holding.avgCost })
    setEditorOpen(true)
  }, [])

  const handleRemove = useCallback(
    (signal: HoldingSignal) => {
      if (signal.holding.source === 'manual') remove(signal.holding.code)
      else hide(signal.holding.code, signal.holding.name)
    },
    [remove, hide],
  )

  const handleSave = useCallback(
    (holding: ManualHolding) => {
      addOrUpdate(holding)
      setEditorOpen(false)
      setEditing(null)
    },
    [addOrUpdate],
  )

  const taByCode = useMemo(() => new Map((ta?.items ?? []).map((i) => [i.code, i])), [ta])

  const marketKey = PHASE_LABEL[market.phase]
  const MarketIcon = market.phase === 'open' ? ChartLineUp : Moon

  return (
    <div className="hr-panel">
      <div className="hr-topbar">
        <div className={`hr-market hr-market--${market.phase}`}>
          <MarketIcon size={15} weight="fill" />
          <span>{t.holdings.market[marketKey]}</span>
          <span className="hr-market-date">{market.todayStr}</span>
        </div>
        <div className="hr-topbar-actions">
          <button
            type="button"
            className="hr-btn-ghost"
            onClick={() => {
              void runReview()
              void runTa(true)
            }}
            disabled={loading}
          >
            {loading ? <CircleNotch size={14} className="ai-spin" /> : <ArrowsClockwise size={14} />}
            {t.holdings.refresh}
          </button>
          <button type="button" className="hr-btn-primary" onClick={openAdd}>
            <Plus size={14} />
            {t.holdings.add}
          </button>
        </div>
      </div>

      {holdings.length === 0 ? (
        <div className="hr-empty">
          <Wallet size={28} />
          <p className="hr-empty-title">{t.holdings.empty}</p>
          <p className="hr-empty-hint">{t.holdings.emptyHint}</p>
        </div>
      ) : (
        <>
          {summary && <PortfolioSummaryBar summary={summary} t={t} />}
          <HoldingsNarrativeCard ta={ta} t={t} />

          {loading && signals.length === 0 ? (
            <div className="hr-loading">
              <CircleNotch size={18} className="ai-spin" /> {t.holdings.refreshing}
            </div>
          ) : (
            <div className="hr-card-list">
              {signals.map((signal) => (
                <HoldingCard
                  key={signal.holding.code}
                  signal={signal}
                  ta={taByCode.get(signal.holding.code)}
                  appState={appState}
                  language={language}
                  t={t}
                  onEdit={handleEdit}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}
        </>
      )}

      {editorOpen && (
        <HoldingEditor
          initial={editing}
          onSave={handleSave}
          onCancel={() => {
            setEditorOpen(false)
            setEditing(null)
          }}
          t={t}
        />
      )}
    </div>
  )
}
