import { useState, useRef, useEffect, useCallback } from 'react'
import { CaretLeft, CaretRight } from 'phosphor-react'
import { todayStr } from '../utils/marketHistory'
import type { Translation } from '../types'

interface MarketDatePickerProps {
  selectedDate: string
  onSelect: (date: string) => void
  t: Translation
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDisplay(date: string, t: Translation): string {
  const today = todayStr()
  if (date === today) return t.datePicker.today
  if (date === daysAgo(1)) return t.datePicker.yesterday
  // Show as MM-DD
  const parts = date.split('-')
  return `${parts[1]}-${parts[2]}`
}

function isTradingDay(dateStr: string): boolean {
  const date = new Date(dateStr + 'T00:00:00')
  const day = date.getDay()
  // 0 = Sunday, 6 = Saturday
  return day !== 0 && day !== 6
}

function isSelectable(date: string): boolean {
  const today = todayStr()
  const minDate = daysAgo(30) // 扩大范围到30天
  return date >= minDate && date <= today && isTradingDay(date)
}

export function getLastTradingDay(): string {
  const today = new Date()
  let d = new Date(today)
  // 如果今天是周末，往前找
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1)
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getMonthDays(
  year: number,
  month: number,
): { day: number; dateStr: string; isCurrentMonth: boolean }[] {
  const firstDay = new Date(year, month, 1).getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days: { day: number; dateStr: string; isCurrentMonth: boolean }[] = []

  // Previous month padding
  const prevMonthDays = new Date(year, month, 0).getDate()
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthDays - i
    const m = month === 0 ? 12 : month
    const y = month === 0 ? year - 1 : year
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({ day: d, dateStr, isCurrentMonth: false })
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({ day: d, dateStr, isCurrentMonth: true })
  }

  // Next month padding
  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    const m = month === 11 ? 1 : month + 2
    const y = month === 11 ? year + 1 : year
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({ day: d, dateStr, isCurrentMonth: false })
  }

  return days
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export default function MarketDatePicker({ selectedDate, onSelect, t }: MarketDatePickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Calendar shows the month of the selected date
  const [calYear, setCalYear] = useState(() => {
    const parts = selectedDate.split('-')
    return parseInt(parts[0])
  })
  const [calMonth, setCalMonth] = useState(() => {
    const parts = selectedDate.split('-')
    return parseInt(parts[1]) - 1
  })

  // Sync calendar when selectedDate changes externally
  useEffect(() => {
    const parts = selectedDate.split('-')
    setCalYear(parseInt(parts[0]))
    setCalMonth(parseInt(parts[1]) - 1)
  }, [selectedDate])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const handleSelect = useCallback(
    (dateStr: string) => {
      if (isSelectable(dateStr)) {
        onSelect(dateStr)
        setOpen(false)
      }
    },
    [onSelect],
  )

  const prevMonth = () => {
    if (calMonth === 0) {
      setCalMonth(11)
      setCalYear(calYear - 1)
    } else {
      setCalMonth(calMonth - 1)
    }
  }

  const nextMonth = () => {
    if (calMonth === 11) {
      setCalMonth(0)
      setCalYear(calYear + 1)
    } else {
      setCalMonth(calMonth + 1)
    }
  }

  const days = getMonthDays(calYear, calMonth)
  const today = todayStr()

  return (
    <div className="date-picker" ref={ref}>
      <button className="date-picker-btn" type="button" onClick={() => setOpen(!open)}>
        {formatDisplay(selectedDate, t)}
      </button>

      {open && (
        <div className="date-picker-popup">
          <div className="date-picker-header">
            <button className="date-picker-nav" type="button" onClick={prevMonth}>
              <CaretLeft size={14} />
            </button>
            <span className="date-picker-title">
              {calYear}年{calMonth + 1}月
            </span>
            <button className="date-picker-nav" type="button" onClick={nextMonth}>
              <CaretRight size={14} />
            </button>
          </div>
          <div className="date-picker-weekdays">
            {WEEKDAYS.map((d) => (
              <span key={d} className="date-picker-weekday">
                {d}
              </span>
            ))}
          </div>
          <div className="date-picker-grid">
            {days.map(({ day, dateStr, isCurrentMonth }) => {
              const selectable = isSelectable(dateStr)
              const isSelected = dateStr === selectedDate
              const isToday = dateStr === today
              return (
                <button
                  key={dateStr}
                  type="button"
                  className={[
                    'date-picker-day',
                    !isCurrentMonth ? 'other-month' : '',
                    !selectable ? 'disabled' : '',
                    isSelected ? 'selected' : '',
                    isToday ? 'today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={!selectable}
                  onClick={() => handleSelect(dateStr)}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
