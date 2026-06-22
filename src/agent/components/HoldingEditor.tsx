import { useState, useCallback } from 'react'
import { X, CircleNotch } from 'phosphor-react'
import type { ManualHolding } from '../../engine/holdings'
import type { Translation } from '../../types'
import { getStockQuote } from '../tools/getStockQuote'

interface Props {
  initial?: ManualHolding | null
  onSave: (holding: ManualHolding) => void
  onCancel: () => void
  t: Translation
}

export function HoldingEditor({ initial, onSave, onCancel, t }: Props) {
  const e = t.holdings.editor
  const [code, setCode] = useState(initial?.code ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : '')
  const [avgCost, setAvgCost] = useState(initial ? String(initial.avgCost) : '')
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState('')

  // Auto-resolve the name from the live quote once a 6-digit code is entered.
  const resolveName = useCallback(async (c: string) => {
    if (!/^\d{6}$/.test(c)) return
    setResolving(true)
    try {
      const q = (await getStockQuote.execute({ stockCode: c })) as { name?: string } | null
      if (q?.name) setName(q.name)
    } catch {
      /* ignore — name stays manual */
    } finally {
      setResolving(false)
    }
  }, [])

  function handleSave() {
    const qty = Number(quantity)
    const cost = Number(avgCost)
    if (!/^\d{6}$/.test(code) || !(qty > 0) || !(cost > 0)) {
      setError(e.invalid)
      return
    }
    onSave({ code, name: name || code, quantity: qty, avgCost: cost })
  }

  return (
    <div className="hr-editor-overlay" onClick={onCancel}>
      <div className="hr-editor" onClick={(ev) => ev.stopPropagation()}>
        <div className="hr-editor-head">
          <span>{initial ? e.editTitle : e.title}</span>
          <button type="button" className="hr-icon-btn" onClick={onCancel} aria-label={e.cancel}>
            <X size={16} />
          </button>
        </div>

        <label className="hr-field">
          <span>{e.code}</span>
          <input
            type="text"
            value={code}
            disabled={!!initial}
            placeholder={e.codePlaceholder}
            onChange={(ev) => setCode(ev.target.value.trim())}
            onBlur={() => resolveName(code)}
          />
        </label>

        <label className="hr-field">
          <span>{e.name}</span>
          <div className="hr-field-inline">
            <input
              type="text"
              value={name}
              placeholder={e.namePlaceholder}
              onChange={(ev) => setName(ev.target.value)}
            />
            {resolving && <CircleNotch size={14} className="ai-spin" />}
          </div>
        </label>

        <label className="hr-field">
          <span>{e.quantity}</span>
          <input
            type="number"
            inputMode="numeric"
            value={quantity}
            onChange={(ev) => setQuantity(ev.target.value)}
          />
        </label>

        <label className="hr-field">
          <span>{e.avgCost}</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={avgCost}
            onChange={(ev) => setAvgCost(ev.target.value)}
          />
        </label>

        {error && <div className="hr-editor-error">{error}</div>}

        <div className="hr-editor-actions">
          <button type="button" className="hr-btn-ghost" onClick={onCancel}>
            {e.cancel}
          </button>
          <button type="button" className="hr-btn-primary" onClick={handleSave}>
            {e.save}
          </button>
        </div>
      </div>
    </div>
  )
}
