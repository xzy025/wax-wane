import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TradingPatternSelector } from './TradingPatternSelector'

describe('TradingPatternSelector', () => {
  it('is collapsed by default', () => {
    const { container } = render(
      <TradingPatternSelector selectedPatterns={[]} onToggle={() => {}} />,
    )
    expect(container.querySelector('.tp-selector-body')).not.toBeInTheDocument()
  })

  it('shows a badge with the selected count', () => {
    const { container, rerender } = render(
      <TradingPatternSelector selectedPatterns={['2b-buy', 'wyckoff']} onToggle={() => {}} />,
    )
    expect(container.querySelector('.tp-selector-badge')).toHaveTextContent('2')
    rerender(<TradingPatternSelector selectedPatterns={[]} onToggle={() => {}} />)
    expect(container.querySelector('.tp-selector-badge')).not.toBeInTheDocument()
  })

  it('expands to show pattern groups on header click', async () => {
    const user = userEvent.setup()
    render(<TradingPatternSelector selectedPatterns={[]} onToggle={() => {}} />)
    await user.click(screen.getByText(/交易模式/))
    expect(screen.getByText('云聪交易模式')).toBeInTheDocument()
    expect(screen.getByText('理论框架')).toBeInTheDocument()
    expect(screen.getByText('2B买入模型')).toBeInTheDocument()
  })

  it('calls onToggle with the pattern id when a chip is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<TradingPatternSelector selectedPatterns={[]} onToggle={onToggle} />)
    await user.click(screen.getByText(/交易模式/))
    await user.click(screen.getByText('2B买入模型'))
    expect(onToggle).toHaveBeenCalledWith('2b-buy')
  })

  it('marks selected chips as active', async () => {
    const user = userEvent.setup()
    render(<TradingPatternSelector selectedPatterns={['wyckoff']} onToggle={() => {}} />)
    await user.click(screen.getByText(/交易模式/))
    const activeChip = screen.getByText('Wyckoff量价理论').closest('button')
    expect(activeChip).toHaveClass('tp-chip-active')
    const inactiveChip = screen.getByText('2B买入模型').closest('button')
    expect(inactiveChip).not.toHaveClass('tp-chip-active')
  })

  it('shows the pattern tooltip on hover and hides it on unhover', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <TradingPatternSelector selectedPatterns={[]} onToggle={() => {}} />,
    )
    await user.click(screen.getByText(/交易模式/))
    const chip = screen.getByText('2B买入模型').closest('button')!
    await user.hover(chip)
    expect(container.querySelector('.tp-chip-tooltip')).toBeInTheDocument()
    await user.unhover(chip)
    expect(container.querySelector('.tp-chip-tooltip')).not.toBeInTheDocument()
  })
})
