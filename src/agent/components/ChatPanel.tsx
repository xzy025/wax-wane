import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Trash2, Sparkles, Loader2, Square, ClipboardCheck } from 'lucide-react'
import {
  useAgentState,
  useAgentDispatch,
  useAgentHistory,
  useActiveConversation,
} from '../agentStore'
import { runAgent } from '../agentLoop'
import { useAppState } from '../../store'
import { ChatMessage } from './ChatMessage'
import { StreamingBubble } from './StreamingBubble'
import type { ConversationMessage, AgentMessage } from '../types'
import type { Translation } from '../../types'

interface ChatPanelProps {
  t: Translation
  language: 'zh' | 'en'
}

const QUICK_PROMPTS_ZH = [
  '分析我最差的交易',
  '我的交易有什么模式？',
  '给出改进建议',
  '总结我的纪律评分',
]

const QUICK_PROMPTS_EN = [
  'Analyze my worst trades',
  'What patterns do you see?',
  'Give improvement suggestions',
  'Summarize my discipline score',
]

export function ChatPanel({ t, language }: ChatPanelProps) {
  const agentState = useAgentState()
  const agentDispatch = useAgentDispatch()
  const historyRef = useAgentHistory()
  const appState = useAppState()
  const messages = useActiveConversation()

  const [input, setInput] = useState('')
  const [streamingContent, setStreamingContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const quickPrompts = language === 'zh' ? QUICK_PROMPTS_ZH : QUICK_PROMPTS_EN

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Ensure conversation exists
  useEffect(() => {
    if (!agentState.activeConversationId) {
      agentDispatch({ type: 'START_CONVERSATION' })
    }
  }, [agentState.activeConversationId, agentDispatch])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || agentState.isProcessing) return

      const userMsg: ConversationMessage = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
      }

      agentDispatch({ type: 'ADD_USER_MESSAGE', payload: userMsg })
      agentDispatch({ type: 'SET_PROCESSING', payload: true })
      setInput('')

      // Build LLM history from conversation
      const convId = agentState.activeConversationId!
      const existingHistory = historyRef.current.get(convId) ?? []
      const llmHistory: AgentMessage[] = [
        ...existingHistory,
        { role: 'user', content: text.trim() },
      ]

      // Create assistant message placeholder
      const assistantMsgId = `msg-${Date.now() + 1}`
      const assistantMsg: ConversationMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [],
      }
      agentDispatch({ type: 'ADD_ASSISTANT_MESSAGE', payload: assistantMsg })

      setIsStreaming(true)
      setStreamingContent('')

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const generator = runAgent(text.trim(), appState, llmHistory, language, controller.signal)
        let fullContent = ''

        for await (const event of generator) {
          switch (event.type) {
            case 'token':
              fullContent += event.content
              setStreamingContent(fullContent)
              break

            case 'tool_start':
              agentDispatch({
                type: 'UPDATE_TOOL_CALL',
                payload: {
                  messageId: assistantMsgId,
                  toolCall: { toolName: event.toolName, toolId: event.toolId, status: 'running' },
                },
              })
              break

            case 'tool_result':
              agentDispatch({
                type: 'UPDATE_TOOL_CALL',
                payload: {
                  messageId: assistantMsgId,
                  toolCall: {
                    toolName: event.toolName,
                    toolId: event.toolId,
                    result: event.result,
                    status: 'done',
                  },
                },
              })
              break

            case 'assistant_message':
              fullContent = event.content
              break

            case 'error':
              fullContent = fullContent || `Error: ${event.message}`
              break
          }
        }

        // Finalize: write accumulated content to the store
        agentDispatch({
          type: 'STREAM_TOKEN',
          payload: { messageId: assistantMsgId, token: fullContent },
        })

        // Store in LLM history for future context
        historyRef.current.set(convId, [...llmHistory, { role: 'assistant', content: fullContent }])
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        agentDispatch({
          type: 'STREAM_TOKEN',
          payload: { messageId: assistantMsgId, token: `\n\nError: ${errorMsg}` },
        })
      } finally {
        abortRef.current = null
        setIsStreaming(false)
        setStreamingContent('')
        agentDispatch({ type: 'SET_PROCESSING', payload: false })
      }
    },
    [
      agentState.isProcessing,
      agentState.activeConversationId,
      agentDispatch,
      historyRef,
      appState,
      language,
    ],
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(input)
  }

  function handleQuickPrompt(prompt: string) {
    sendMessage(prompt)
  }

  function handleClear() {
    agentDispatch({ type: 'CLEAR_CONVERSATION' })
    if (agentState.activeConversationId) {
      historyRef.current.delete(agentState.activeConversationId)
    }
  }

  function handleReview() {
    sendMessage('请开始今日复盘')
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-header">
        <div className="ai-chat-header-title">
          <Sparkles size={16} />
          <span>{t.ai?.chatTitle ?? 'AI Assistant'}</span>
        </div>
        <div className="ai-chat-header-actions">
          <button
            className="ai-chat-review"
            type="button"
            onClick={handleReview}
            disabled={agentState.isProcessing}
            title="一键复盘"
          >
            <ClipboardCheck size={14} />
            <span>复盘</span>
          </button>
          {messages.length > 0 && (
            <button
              className="ai-chat-clear"
              type="button"
              onClick={handleClear}
              title={t.ai?.clearChat ?? 'Clear'}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="ai-chat-messages">
        {messages.length === 0 && !isStreaming && (
          <div className="ai-chat-welcome">
            <Sparkles size={24} />
            <p>{t.ai?.chatPlaceholder ?? 'Ask a question about your trades'}</p>
            <div className="ai-quick-prompts">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  className="ai-quick-prompt"
                  type="button"
                  onClick={() => handleQuickPrompt(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {isStreaming && streamingContent && (
          <StreamingBubble content={streamingContent} isStreaming={true} />
        )}

        {isStreaming && !streamingContent && (
          <div className="ai-msg ai-msg-assistant">
            <div className="ai-msg-avatar">
              <Loader2 size={16} className="ai-spin" />
            </div>
            <div className="ai-msg-body">
              <div className="ai-msg-content ai-thinking">{t.ai?.thinking ?? 'Thinking...'}</div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="ai-chat-input" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t.ai?.inputPlaceholder ?? 'Ask a question...'}
          disabled={agentState.isProcessing}
        />
        {isStreaming ? (
          <button type="button" onClick={handleStop} title="Stop">
            <Square size={18} />
          </button>
        ) : (
          <button type="submit" disabled={agentState.isProcessing || !input.trim()}>
            {agentState.isProcessing ? <Loader2 size={18} className="ai-spin" /> : <Send size={18} />}
          </button>
        )}
      </form>
    </div>
  )
}
