import { Robot } from 'phosphor-react'

interface StreamingBubbleProps {
  content: string
  isStreaming: boolean
}

export function StreamingBubble({ content, isStreaming }: StreamingBubbleProps) {
  return (
    <div className="ai-msg ai-msg-assistant">
      <div className="ai-msg-avatar">
        <Robot size={16} />
      </div>
      <div className="ai-msg-body">
        <div className="ai-msg-content">
          {content}
          {isStreaming && <span className="ai-cursor" />}
        </div>
      </div>
    </div>
  )
}
