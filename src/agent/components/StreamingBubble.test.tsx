import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StreamingBubble } from './StreamingBubble'

describe('StreamingBubble', () => {
  it('renders plain text content', () => {
    const { container } = render(
      <StreamingBubble content="正在分析..." isStreaming={false} />,
    )
    expect(container.querySelector('.ai-msg-content')).toHaveTextContent('正在分析...')
    expect(container.querySelector('.ai-markdown')).not.toBeInTheDocument()
  })

  it('shows the cursor while streaming', () => {
    const { container } = render(<StreamingBubble content="部分输出" isStreaming={true} />)
    expect(container.querySelector('.ai-cursor')).toBeInTheDocument()
  })

  it('hides the cursor when streaming is done', () => {
    const { container } = render(<StreamingBubble content="完整输出" isStreaming={false} />)
    expect(container.querySelector('.ai-cursor')).not.toBeInTheDocument()
  })

  it('renders markdown when isMarkdown is set', () => {
    const { container } = render(
      <StreamingBubble content="**加粗** 文本" isStreaming={true} isMarkdown />,
    )
    expect(container.querySelector('.ai-markdown')).toBeInTheDocument()
    expect(container.querySelector('strong')).toHaveTextContent('加粗')
    expect(container.querySelector('.ai-cursor')).toBeInTheDocument()
  })
})
