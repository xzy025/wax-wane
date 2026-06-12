import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatMessage } from './ChatMessage'
import type { ConversationMessage } from '../types'

function makeMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: '你好',
    timestamp: 1718000000000,
    ...overrides,
  }
}

describe('ChatMessage', () => {
  it('renders a user message with the user style', () => {
    const { container } = render(
      <ChatMessage message={makeMessage({ role: 'user', content: '帮我复盘' })} />,
    )
    expect(container.querySelector('.ai-msg-user')).toBeInTheDocument()
    expect(screen.getByText('帮我复盘')).toBeInTheDocument()
  })

  it('renders an assistant message as plain text by default', () => {
    const { container } = render(<ChatMessage message={makeMessage({ content: '**raw**' })} />)
    expect(container.querySelector('.ai-msg-assistant')).toBeInTheDocument()
    // not markdown-rendered: literal asterisks remain
    expect(screen.getByText('**raw**')).toBeInTheDocument()
    expect(container.querySelector('strong')).not.toBeInTheDocument()
  })

  it('renders assistant markdown when isMarkdown is set', () => {
    const { container } = render(
      <ChatMessage message={makeMessage({ content: '**加粗**', isMarkdown: true })} />,
    )
    expect(container.querySelector('.ai-markdown')).toBeInTheDocument()
    expect(container.querySelector('strong')).toHaveTextContent('加粗')
  })

  it('never renders user content as markdown', () => {
    const { container } = render(
      <ChatMessage message={makeMessage({ role: 'user', content: '**加粗**', isMarkdown: true })} />,
    )
    expect(container.querySelector('strong')).not.toBeInTheDocument()
  })

  it('renders a card per tool call', () => {
    render(
      <ChatMessage
        message={makeMessage({
          content: '查询完成',
          toolCalls: [
            { toolName: 'queryTradeHistory', toolId: 'tc-1', status: 'done' },
            { toolName: 'calculateMetrics', toolId: 'tc-2', status: 'done' },
          ],
        })}
      />,
    )
    expect(screen.getByText('查询交易记录')).toBeInTheDocument()
    expect(screen.getByText('计算指标')).toBeInTheDocument()
  })

  it('skips the empty content div when an assistant message only has tool calls', () => {
    const { container } = render(
      <ChatMessage
        message={makeMessage({
          content: '',
          toolCalls: [{ toolName: 'queryTradeHistory', toolId: 'tc-1', status: 'running' }],
        })}
      />,
    )
    expect(container.querySelector('.ai-msg-content')).not.toBeInTheDocument()
    expect(screen.getByText('查询交易记录')).toBeInTheDocument()
  })

  it('renders pasted images', () => {
    render(
      <ChatMessage
        message={makeMessage({
          role: 'user',
          content: '看这张图',
          images: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
        })}
      />,
    )
    const imgs = screen.getAllByRole('img')
    expect(imgs).toHaveLength(2)
    expect(imgs[0]).toHaveAttribute('src', 'data:image/png;base64,AAA')
  })
})
