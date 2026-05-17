import React from 'react'

interface SegmentedControlProps {
  label: string
  value: string
  options: string[]
  labels: Record<string, string>
  onChange: (value: string) => void
  icon?: React.ReactNode
}

export default function SegmentedControl({ label, value, options, labels, onChange, icon }: SegmentedControlProps) {
  return (
    <div className="segmented-shell">
      <span className="segmented-label">
        {icon}
        {label}
      </span>
      <div className={`segmented segmented-${options.length}`} aria-label={label}>
        {options.map((item) => (
          <button
            key={item}
            type="button"
            className={value === item ? 'active' : ''}
            onClick={() => onChange(item)}
          >
            {labels[item]}
          </button>
        ))}
      </div>
    </div>
  )
}
