import { useState } from 'react'
import { CaretDown, CaretUp, CheckSquare, Square } from 'phosphor-react'
import { TRADING_PATTERNS, type TradingPattern } from '../tradingPatterns'

interface TradingPatternSelectorProps {
  selectedPatterns: string[]
  onToggle: (patternId: string) => void
}

const CATEGORY_LABELS: Record<string, string> = {
  teacher: '云聪交易模式',
  theory: '理论框架',
}

const CATEGORY_ORDER: Array<'teacher' | 'theory'> = ['teacher', 'theory']

export function TradingPatternSelector({ selectedPatterns, onToggle }: TradingPatternSelectorProps) {
  const [collapsed, setCollapsed] = useState(true)

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    patterns: TRADING_PATTERNS.filter((p) => p.category === cat),
  }))

  const selectedCount = selectedPatterns.length

  return (
    <div className="tp-selector">
      <button
        className="tp-selector-header"
        type="button"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="tp-selector-title">
          📐 交易模式
          {selectedCount > 0 && (
            <span className="tp-selector-badge">{selectedCount}</span>
          )}
        </span>
        {collapsed ? <CaretDown size={14} /> : <CaretUp size={14} />}
      </button>

      {!collapsed && (
        <div className="tp-selector-body">
          {grouped.map(({ category, label, patterns }) => (
            <div key={category} className="tp-group">
              <div className="tp-group-label">{label}</div>
              <div className="tp-group-items">
                {patterns.map((pattern) => {
                  const isSelected = selectedPatterns.includes(pattern.id)
                  return (
                    <PatternChip
                      key={pattern.id}
                      pattern={pattern}
                      isSelected={isSelected}
                      onToggle={() => onToggle(pattern.id)}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PatternChip({
  pattern,
  isSelected,
  onToggle,
}: {
  pattern: TradingPattern
  isSelected: boolean
  onToggle: () => void
}) {
  const [showDetail, setShowDetail] = useState(false)

  return (
    <div className="tp-chip-wrapper">
      <button
        className={`tp-chip ${isSelected ? 'tp-chip-active' : ''}`}
        type="button"
        onClick={onToggle}
        onMouseEnter={() => setShowDetail(true)}
        onMouseLeave={() => setShowDetail(false)}
      >
        {isSelected ? <CheckSquare size={13} /> : <Square size={13} />}
        <span>{pattern.name}</span>
      </button>

      {showDetail && (
        <div className="tp-chip-tooltip">
          <div className="tp-chip-tooltip-desc">{pattern.description}</div>
          <ul className="tp-chip-tooltip-elements">
            {pattern.keyElements.map((el, i) => (
              <li key={i}>{el}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
