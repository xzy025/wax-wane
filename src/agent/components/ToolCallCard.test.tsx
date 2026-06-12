import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolCallCard } from './ToolCallCard'
import type { ToolCallInfo } from '../types'

function makeToolCall(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
  return {
    toolName: 'queryTradeHistory',
    toolId: 'tc-1',
    status: 'done',
    result: { count: 3 },
    ...overrides,
  }
}

describe('ToolCallCard', () => {
  it('shows the mapped Chinese label for known tools', () => {
    render(<ToolCallCard toolCall={makeToolCall()} />)
    expect(screen.getByText('查询交易记录')).toBeInTheDocument()
  })

  it('falls back to the raw tool name for unknown tools', () => {
    render(<ToolCallCard toolCall={makeToolCall({ toolName: 'someNewTool' })} />)
    expect(screen.getByText('someNewTool')).toBeInTheDocument()
  })

  it('is collapsed by default and hides the result', () => {
    const { container } = render(<ToolCallCard toolCall={makeToolCall()} />)
    expect(container.querySelector('.ai-tool-card-result')).not.toBeInTheDocument()
  })

  it('expands on click to show the JSON result, and collapses again', async () => {
    const user = userEvent.setup()
    const { container } = render(<ToolCallCard toolCall={makeToolCall()} />)
    await user.click(screen.getByRole('button'))
    const result = container.querySelector('.ai-tool-card-result')
    expect(result).toBeInTheDocument()
    expect(result).toHaveTextContent('"count": 3')
    await user.click(screen.getByRole('button'))
    expect(container.querySelector('.ai-tool-card-result')).not.toBeInTheDocument()
  })

  it('shows nothing on expand when there is no result yet', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ToolCallCard toolCall={makeToolCall({ result: undefined, status: 'running' })} />,
    )
    await user.click(screen.getByRole('button'))
    expect(container.querySelector('.ai-tool-card-result')).not.toBeInTheDocument()
  })

  it('shows a spinner while running and a wrench when done', () => {
    const { container, rerender } = render(
      <ToolCallCard toolCall={makeToolCall({ status: 'running' })} />,
    )
    expect(container.querySelector('.ai-spin')).toBeInTheDocument()
    rerender(<ToolCallCard toolCall={makeToolCall({ status: 'done' })} />)
    expect(container.querySelector('.ai-spin')).not.toBeInTheDocument()
  })
})
