import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SegmentedControl from './SegmentedControl'

const labels: Record<string, string> = {
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
}

describe('SegmentedControl', () => {
  it('renders the label text', () => {
    render(
      <SegmentedControl
        label="Date range"
        value="month"
        options={['week', 'month', 'quarter']}
        labels={labels}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('Date range')).toBeInTheDocument()
  })

  it('renders all option buttons', () => {
    render(
      <SegmentedControl
        label="Date range"
        value="month"
        options={['week', 'month', 'quarter']}
        labels={labels}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('Week')).toBeInTheDocument()
    expect(screen.getByText('Month')).toBeInTheDocument()
    expect(screen.getByText('Quarter')).toBeInTheDocument()
  })

  it('marks the active option with the active class', () => {
    render(
      <SegmentedControl
        label="Date range"
        value="month"
        options={['week', 'month', 'quarter']}
        labels={labels}
        onChange={() => {}}
      />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).not.toHaveClass('active')
    expect(buttons[1]).toHaveClass('active')
    expect(buttons[2]).not.toHaveClass('active')
  })

  it('calls onChange when an option is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SegmentedControl
        label="Date range"
        value="month"
        options={['week', 'month', 'quarter']}
        labels={labels}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByText('Week'))
    expect(onChange).toHaveBeenCalledWith('week')
  })

  it('calls onChange with the correct value for each option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SegmentedControl
        label="Date range"
        value="week"
        options={['week', 'month', 'quarter']}
        labels={labels}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByText('Quarter'))
    expect(onChange).toHaveBeenCalledWith('quarter')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('sets aria-label on the segmented group', () => {
    render(
      <SegmentedControl
        label="Date range"
        value="month"
        options={['week', 'month', 'quarter']}
        labels={labels}
        onChange={() => {}}
      />,
    )
    expect(screen.getByLabelText('Date range')).toBeInTheDocument()
  })

  it('renders an icon when provided', () => {
    render(
      <SegmentedControl
        label="Date range"
        value="month"
        options={['week', 'month']}
        labels={labels}
        onChange={() => {}}
        icon={<span data-testid="icon">X</span>}
      />,
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('applies the correct segmented-N class based on option count', () => {
    const { container } = render(
      <SegmentedControl
        label="Date range"
        value="month"
        options={['week', 'month', 'quarter']}
        labels={labels}
        onChange={() => {}}
      />,
    )
    const segmented = container.querySelector('.segmented')
    expect(segmented).toHaveClass('segmented-3')
  })
})
