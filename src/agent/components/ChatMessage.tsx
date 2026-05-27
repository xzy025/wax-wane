import { Bot, User } from 'lucide-react'
import type { ConversationMessage } from '../types'
import { ToolCallCard } from './ToolCallCard'

interface ChatMessageProps {
  message: ConversationMessage
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`ai-msg ai-msg-${message.role}`}>
      <div className="ai-msg-avatar">{isUser ? <User size={16} /> : <Bot size={16} />}</div>
      <div className="ai-msg-body">
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="ai-msg-tools">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.toolId} toolCall={tc} />
            ))}
          </div>
        )}
        <div className="ai-msg-content">
          {message.content || (!isUser && message.toolCalls?.length ? '' : message.content)}
        </div>
      </div>
    </div>
  )
}
