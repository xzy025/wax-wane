import { Robot } from 'phosphor-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface StreamingBubbleProps {
  content: string
  isStreaming: boolean
  isMarkdown?: boolean
}

export function StreamingBubble({ content, isStreaming, isMarkdown }: StreamingBubbleProps) {
  return (
    <div className="ai-msg ai-msg-assistant">
      <div className="ai-msg-avatar">
        <Robot size={16} />
      </div>
      <div className="ai-msg-body">
        {isMarkdown ? (
          <div className="ai-msg-content ai-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            {isStreaming && <span className="ai-cursor" />}
          </div>
        ) : (
          <div className="ai-msg-content">
            {content}
            {isStreaming && <span className="ai-cursor" />}
          </div>
        )}
      </div>
    </div>
  )
}
