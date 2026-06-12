import { useState, useCallback } from 'react'
import { Funnel, MagnifyingGlass, Warning, PencilSimple, Check, X } from 'phosphor-react'
import { useAppState, useAppDispatch } from '../store'
import { buildTradeGroups } from '../engine/tradeGroup'
import { validateTrades, getPositionQuantities } from '../engine/position'
import { translateMap, getDateRange, isInDateRange } from '../utils'
import type { Translation, ParsedTrade } from '../types'

interface LedgerViewProps {
  t: Translation
  range?: string
}

type SideFilter = 'all' | 'buy' | 'sell'

export default function LedgerView({ t, range }: LedgerViewProps) {
  const { trades } = useAppState()
  const dispatch = useAppDispatch()
  const [searchQuery, setSearchQuery] = useState('')
  const [sideFilter, setSideFilter] = useState<SideFilter>('all')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<ParsedTrade | null>(null)

  const filteredTrades = trades
    .filter((trade, i) => {
      if (!range) return true
      const { start, end } = getDateRange(range)
      return isInDateRange(trade.tradeDate, start, end)
    })
    .filter((trade) => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.trim().toLowerCase()
      return trade.stockCode.includes(q) || trade.stockName.toLowerCase().includes(q)
    })
    .filter((trade) => {
      if (sideFilter === 'all') return true
      return trade.side === sideFilter
    })

  const getOriginalIndex = useCallback(
    (trade: ParsedTrade) => {
      return trades.indexOf(trade)
    },
    [trades],
  )

  function handleStartEdit(trade: ParsedTrade) {
    const idx = trades.indexOf(trade)
    setEditingIndex(idx)
    setEditForm({ ...trade })
  }

  function handleCancelEdit() {
    setEditingIndex(null)
    setEditForm(null)
  }

  function handleSaveEdit() {
    if (editingIndex === null || !editForm) return
    dispatch({ type: 'UPDATE_TRADE', payload: { index: editingIndex, trade: editForm } })
    // Rebuild trade groups and revalidate
    const updatedTrades = [...trades]
    updatedTrades[editingIndex] = editForm
    const positions = getPositionQuantities(updatedTrades.slice(0, editingIndex))
    const validated = validateTrades(updatedTrades, positions)
    dispatch({ type: 'SET_TRADE_GROUPS', payload: buildTradeGroups(validated) })
    setEditingIndex(null)
    setEditForm(null)
  }

  const sideOptions: { value: SideFilter; label: string }[] = [
    { value: 'all', label: t.ledger.filterAll },
    { value: 'buy', label: t.ledger.side.Buy },
    { value: 'sell', label: t.ledger.side.Sell },
  ]

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h2>{t.ledger.title}</h2>
          <p>{t.ledger.desc}</p>
        </div>
        <div className="table-tools">
          <div className="search-box">
            <MagnifyingGlass size={16} aria-hidden="true" />
            <input
              type="text"
              placeholder={t.ledger.search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <Funnel size={16} aria-hidden="true" />
            {sideOptions.map((opt) => (
              <button
                key={opt.value}
                className={sideFilter === opt.value ? 'filter-chip active' : 'filter-chip'}
                type="button"
                onClick={() => setSideFilter(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="data-table">
        <div className="table-row table-head">
          {t.ledger.headers.map((header) => (
            <span key={header}>{header}</span>
          ))}
          <span></span>
        </div>
        {filteredTrades.length > 0 ? (
          filteredTrades.map((trade, index) => {
            const isEditing = editingIndex === trades.indexOf(trade)
            return isEditing && editForm ? (
              <div className="table-row row-editing" key={`edit-${index}`}>
                <span>
                  <input
                    type="date"
                    className="edit-input"
                    value={editForm.tradeDate}
                    onChange={(e) => setEditForm({ ...editForm, tradeDate: e.target.value })}
                  />
                </span>
                <span>
                  <input
                    type="text"
                    className="edit-input"
                    value={editForm.stockCode}
                    style={{ width: 70 }}
                    onChange={(e) => setEditForm({ ...editForm, stockCode: e.target.value })}
                  />
                </span>
                <span>
                  <input
                    type="text"
                    className="edit-input"
                    value={editForm.stockName}
                    style={{ width: 80 }}
                    onChange={(e) => setEditForm({ ...editForm, stockName: e.target.value })}
                  />
                </span>
                <span>
                  <select
                    className="edit-input"
                    value={editForm.side}
                    onChange={(e) =>
                      setEditForm({ ...editForm, side: e.target.value as 'buy' | 'sell' })
                    }
                  >
                    <option value="buy">{t.ledger.side.Buy}</option>
                    <option value="sell">{t.ledger.side.Sell}</option>
                  </select>
                </span>
                <span>
                  <input
                    type="number"
                    className="edit-input"
                    value={editForm.quantity}
                    style={{ width: 70 }}
                    onChange={(e) => setEditForm({ ...editForm, quantity: Number(e.target.value) })}
                  />
                </span>
                <span>
                  <input
                    type="number"
                    className="edit-input"
                    value={editForm.price}
                    style={{ width: 80 }}
                    step="0.01"
                    onChange={(e) => setEditForm({ ...editForm, price: Number(e.target.value) })}
                  />
                </span>
                <span>
                  {editForm.grossAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                </span>
                <span>
                  <input
                    type="number"
                    className="edit-input"
                    value={editForm.commission}
                    style={{ width: 70 }}
                    step="0.01"
                    onChange={(e) =>
                      setEditForm({ ...editForm, commission: Number(e.target.value) })
                    }
                  />
                </span>
                <span className="edit-actions">
                  <button
                    className="icon-button"
                    type="button"
                    title={t.ledger.save}
                    onClick={handleSaveEdit}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    title={t.ledger.cancel}
                    onClick={handleCancelEdit}
                  >
                    <X size={16} />
                  </button>
                </span>
              </div>
            ) : (
              <div
                className={`table-row${trade.validationStatus === 'error' ? ' row-error' : ''}`}
                key={`${trade.tradeDate}-${trade.stockCode}-${index}`}
              >
                <span>{trade.tradeDate}</span>
                <span>
                  {trade.stockCode}
                  {trade.validationStatus === 'error' && (
                    <span className="validation-badge" title={trade.validationMessage}>
                      <Warning size={14} />
                    </span>
                  )}
                </span>
                <span>{trade.stockName}</span>
                <span className={`side side-${trade.side}`}>
                  {t.ledger.side[trade.side === 'buy' ? 'Buy' : 'Sell']}
                </span>
                <span>{trade.quantity.toLocaleString()}</span>
                <span>{trade.price.toFixed(2)}</span>
                <span>
                  {trade.grossAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                </span>
                <span>{trade.commission.toFixed(2)}</span>
                <span>
                  <button
                    className="icon-button"
                    type="button"
                    title={t.ledger.edit}
                    onClick={() => handleStartEdit(trade)}
                  >
                    <PencilSimple size={14} />
                  </button>
                </span>
              </div>
            )
          })
        ) : (
          <div
            className="table-row"
            style={{ textAlign: 'center', gridColumn: '1 / -1', color: 'var(--muted)' }}
          >
            {trades.length === 0 ? t.ledger.emptyNoData : t.ledger.emptyNoMatch}
          </div>
        )}
      </div>
    </section>
  )
}
