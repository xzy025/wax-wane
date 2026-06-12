import React, { useRef } from 'react'

interface SegmentedControlProps {
  label: string
  value: string
  options: string[]
  labels: Record<string, string>
  onChange: (value: string) => void
  icon?: React.ReactNode
}

export default function SegmentedControl({
  label,
  value,
  options,
  labels,
  onChange,
  icon,
}: SegmentedControlProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = (index + 1) % options.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = (index - 1 + options.length) % options.length
    }
    if (next >= 0) {
      e.preventDefault()
      onChange(options[next])
      buttonRefs.current[next]?.focus()
    }
  }

  return (
    <div className="segmented-shell">
      <span className="segmented-label">
        {icon}
        {label}
      </span>
      <div
        className={`segmented segmented-${options.length}`}
        role="radiogroup"
        aria-label={label}
      >
        {options.map((item, index) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={value === item}
            tabIndex={value === item ? 0 : -1}
            ref={(el) => {
              buttonRefs.current[index] = el
            }}
            className={value === item ? 'active' : ''}
            onClick={() => onChange(item)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            {labels[item]}
          </button>
        ))}
      </div>
    </div>
  )
}
