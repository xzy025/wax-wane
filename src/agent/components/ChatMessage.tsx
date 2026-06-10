import { Robot, User } from 'phosphor-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ConversationMessage } from '../types'
import { ToolCallCard } from './ToolCallCard'

interface ChatMessageProps {
  message: ConversationMessage
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const hasContent = !!message.content
  const hasToolCalls = !!message.toolCalls?.length
  const hasImages = !!message.images?.length

  return (
    <div className={`ai-msg ai-msg-${message.role}`}>
      <div className="ai-msg-avatar">{isUser ? <User size={16} /> : <Robot size={16} />}</div>
      <div className="ai-msg-body">
        {hasToolCalls && (
          <div className="ai-msg-tools">
            {message.toolCalls!.map((tc) => (
              <ToolCallCard key={tc.toolId} toolCall={tc} />
            ))}
          </div>
        )}
        {hasImages && (
          <div className="ai-msg-images">
            {message.images!.map((img, index) => (
              <img
                key={index}
                src={img}
                alt={`Pasted image ${index + 1}`}
                className="ai-msg-image"
              />
            ))}
          </div>
        )}
        {(hasContent || isUser || !hasToolCalls) &&
          (message.isMarkdown && !isUser ? (
            <div className="ai-msg-content ai-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          ) : (
            <div className="ai-msg-content">{message.content}</div>
          ))}
      </div>
    </div>
  )
}
