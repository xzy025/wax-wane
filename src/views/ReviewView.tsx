import { useEffect, useState } from 'react'
import { Tags } from 'lucide-react'
import { useAppState, useAppDispatch } from '../store'
import { formatMoney, translateMap } from '../utils'
import { ChatPanel } from '../agent/components/ChatPanel'
import type { TradeGroup, Translation } from '../types'

interface ReviewViewProps {
  t: Translation
  selectedGroup: TradeGroup
  selectedGroupId: string
  onSelectGroup: (id: string) => void
  language?: 'zh' | 'en'
}

export default function ReviewView({ t, selectedGroup, selectedGroupId, onSelectGroup, language = 'zh' }: ReviewViewProps) {
  const { tradeGroups, reviewNotes } = useAppState()
  const dispatch = useAppDispatch()

  const currentNote = reviewNotes[selectedGroupId]
  const [form, setForm] = useState({
    buyReason: currentNote?.buyReason ?? '',
    sellReason: currentNote?.sellReason ?? '',
    executionReview: currentNote?.executionReview ?? '',
    lesson: currentNote?.lesson ?? '',
  })

  useEffect(() => {
    const note = reviewNotes[selectedGroupId]
    setForm({
      buyReason: note?.buyReason ?? '',
      sellReason: note?.sellReason ?? '',
      executionReview: note?.executionReview ?? '',
      lesson: note?.lesson ?? '',
    })
  }, [selectedGroupId, reviewNotes])

  function handleChange(field: keyof typeof form, value: string) {
    const next = { ...form, [field]: value }
    setForm(next)
    dispatch({
      type: 'UPDATE_REVIEW_NOTE',
      payload: { groupId: selectedGroupId, note: next },
    })
  }
  return (
    <div className="content-grid review-grid">
      <section className="panel group-list-panel">
        <div className="panel-title">
          <div>
            <h2>{t.reviews.groupTitle}</h2>
            <p>{t.reviews.groupDesc}</p>
          </div>
        </div>
        <div className="group-list">
          {tradeGroups.map((group) => (
            <button
              className={selectedGroupId === group.id ? 'group-button active' : 'group-button'}
              key={group.id}
              type="button"
              onClick={() => onSelectGroup(group.id)}
            >
              <span>
                <strong>{translateMap(t.stocks, group.name)}</strong>
                <small>{group.code}</small>
              </span>
              <em className={group.pnl >= 0 ? 'money positive-text' : 'money negative-text'}>
                {formatMoney(group.pnl, { withSign: true })}
              </em>
            </button>
          ))}
        </div>
      </section>

      <section className="panel review-detail">
        <div className="review-heading">
          <div>
            <span className="stock-code">{selectedGroup.code}</span>
            <h2>{translateMap(t.stocks, selectedGroup.name)}</h2>
            <p>
              {selectedGroup.opened} - {selectedGroup.closed ?? t.reviews.open} · {selectedGroup.days}
              {t.reviews.dayUnit}
            </p>
          </div>
          <div className={selectedGroup.pnl >= 0 ? 'pnl-box positive' : 'pnl-box negative'}>
            <strong>{formatMoney(selectedGroup.pnl, { withSign: true })}</strong>
            <span>{selectedGroup.returnRate}%</span>
          </div>
        </div>

        <div className="review-form-grid">
          <label>
            {t.reviews.buyReason}
            <textarea
              placeholder={t.reviews.placeholders.buy}
              value={form.buyReason}
              onChange={(e) => handleChange('buyReason', e.target.value)}
            />
          </label>
          <label>
            {t.reviews.sellReason}
            <textarea
              placeholder={t.reviews.placeholders.sell}
              value={form.sellReason}
              onChange={(e) => handleChange('sellReason', e.target.value)}
            />
          </label>
          <label>
            {t.reviews.executionReview}
            <textarea
              placeholder={t.reviews.placeholders.execution}
              value={form.executionReview}
              onChange={(e) => handleChange('executionReview', e.target.value)}
            />
          </label>
          <label>
            {t.reviews.lesson}
            <textarea
              placeholder={t.reviews.placeholders.lesson}
              value={form.lesson}
              onChange={(e) => handleChange('lesson', e.target.value)}
            />
          </label>
        </div>

        <div className="tag-strip">
          <span>
            <Tags size={16} aria-hidden="true" />
            {translateMap(t.strategies, selectedGroup.strategy)}
          </span>
          {selectedGroup.mistakes.length === 0 ? (
            <span>{t.reviews.noMistake}</span>
          ) : (
            selectedGroup.mistakes.map((tag) => <span key={tag}>{translateMap(t.mistakes, tag)}</span>)
          )}
        </div>

        <div className="ai-agent-section">
          <ChatPanel t={t} language={language} />
        </div>
      </section>
    </div>
  )
}
