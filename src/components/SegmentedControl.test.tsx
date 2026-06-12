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
    const buttons = screen.getAllByRole('radio')
    expect(buttons[0]).not.toHaveClass('active')
    expect(buttons[1]).toHaveClass('active')
    expect(buttons[2]).not.toHaveClass('active')
  })

  it('exposes a radiogroup with aria-checked on the active option', () => {
    render(
      <SegmentedControl
        label="Date range"
        value="month"
        options={['week', 'month', 'quarter']}
        labels={labels}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('radiogroup', { name: 'Date range' })).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toHaveAttribute('aria-checked', 'false')
    expect(radios[1]).toHaveAttribute('aria-checked', 'true')
    expect(radios[2]).toHaveAttribute('aria-checked', 'false')
  })

  it('uses roving tabindex: only the active option is tabbable', () => {
    render(
      <SegmentedControl
        label="Date range"
        value="month"
        options={['week', 'month', 'quarter']}
        labels={labels}
        onChange={() => {}}
      />,
    )
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toHaveAttribute('tabindex', '-1')
    expect(radios[1]).toHaveAttribute('tabindex', '0')
    expect(radios[2]).toHaveAttribute('tabindex', '-1')
  })

  it('moves selection with arrow keys and wraps around', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SegmentedControl
        label="Date range"
        value="quarter"
        options={['week', 'month', 'quarter']}
        labels={labels}
        onChange={onChange}
      />,
    )
    const radios = screen.getAllByRole('radio')
    radios[2].focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('week')
    // focus moved to the first option, so ArrowLeft wraps back to the last
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('quarter')
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
