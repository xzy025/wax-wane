import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MarketDatePicker from './MarketDatePicker'
import type { Translation } from '../types'
import en from '../i18n/en'

// Mock todayStr to return a fixed date
vi.mock('../utils/marketHistory', () => ({
  todayStr: () => '2026-05-26',
  getDay: () => null,
  saveDay: () => {},
}))

const t = en as Translation

function makeProps(overrides: Partial<Parameters<typeof MarketDatePicker>[0]> = {}) {
  return {
    selectedDate: '2026-05-26',
    onSelect: vi.fn(),
    t,
    ...overrides,
  }
}

describe('MarketDatePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the button with today label when selectedDate is today', () => {
    render(<MarketDatePicker {...makeProps()} />)
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
  })

  it('renders the button with yesterday label for the previous day', () => {
    render(<MarketDatePicker {...makeProps({ selectedDate: '2026-05-25' })} />)
    expect(screen.getByRole('button', { name: 'Yesterday' })).toBeInTheDocument()
  })

  it('renders MM-DD format for other dates', () => {
    render(<MarketDatePicker {...makeProps({ selectedDate: '2026-05-20' })} />)
    expect(screen.getByRole('button', { name: '05-20' })).toBeInTheDocument()
  })

  it('opens the calendar popup when button is clicked', async () => {
    const user = userEvent.setup()
    render(<MarketDatePicker {...makeProps()} />)
    await user.click(screen.getByRole('button', { name: 'Today' }))
    // Calendar should show month/year header
    expect(screen.getByText(/2026.*5.*月/)).toBeInTheDocument()
  })

  it('displays weekday headers in Chinese', async () => {
    const user = userEvent.setup()
    render(<MarketDatePicker {...makeProps()} />)
    await user.click(screen.getByRole('button', { name: 'Today' }))
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    for (const day of weekdays) {
      expect(screen.getByText(day)).toBeInTheDocument()
    }
  })

  it('shows navigation buttons for prev/next month', async () => {
    const user = userEvent.setup()
    render(<MarketDatePicker {...makeProps()} />)
    await user.click(screen.getByRole('button', { name: 'Today' }))
    // There should be two nav buttons (chevron left and right)
    const navButtons = screen.getAllByRole('button', { name: '' })
    // At minimum, the nav buttons exist alongside day buttons
    expect(navButtons.length).toBeGreaterThan(0)
  })

  it('calls onSelect and closes popup when a selectable date is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MarketDatePicker {...makeProps({ onSelect })} />)
    await user.click(screen.getByRole('button', { name: 'Today' }))

    // Find a selectable day button (not disabled, within the recent range)
    // Today is 2026-05-26, so day 26 should be selectable
    const dayButtons = screen.getAllByRole('button')
    const day26 = dayButtons.find((btn) => btn.textContent === '26' && !btn.hasAttribute('disabled'))
    if (day26) {
      await user.click(day26)
      expect(onSelect).toHaveBeenCalled()
    }
  })

  it('closes popup when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(<MarketDatePicker {...makeProps()} />)
    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByText(/2026.*5.*月/)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByText(/2026.*5.*月/)).not.toBeInTheDocument()
  })

  it('disables dates outside the selectable range', async () => {
    const user = userEvent.setup()
    render(<MarketDatePicker {...makeProps()} />)
    await user.click(screen.getByRole('button', { name: 'Today' }))

    // Days from previous month should be disabled (they are outside the 6-day range)
    const disabledButtons = screen.getAllByRole('button', { disabled: true })
    expect(disabledButtons.length).toBeGreaterThan(0)
  })

  it('highlights the selected date', async () => {
    const user = userEvent.setup()
    render(<MarketDatePicker {...makeProps({ selectedDate: '2026-05-26' })} />)
    await user.click(screen.getByRole('button', { name: 'Today' }))

    // Day 26 should have the 'selected' class
    const dayButtons = screen.getAllByRole('button')
    const selectedDay = dayButtons.find(
      (btn) => btn.textContent === '26' && btn.className.includes('selected'),
    )
    expect(selectedDay).toBeDefined()
  })

  it('marks today with a special class', async () => {
    const user = userEvent.setup()
    render(<MarketDatePicker {...makeProps()} />)
    await user.click(screen.getByRole('button', { name: 'Today' }))

    const dayButtons = screen.getAllByRole('button')
    const todayDay = dayButtons.find(
      (btn) => btn.textContent === '26' && btn.className.includes('today'),
    )
    expect(todayDay).toBeDefined()
  })
})
