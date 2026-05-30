import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Trash2, Sparkles, Loader2, Square, ClipboardCheck, Settings2, Check } from 'lucide-react'
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

interface LLMConfig {
  id: string
  name: string
  apiUrl: string
  model: string
  protocol: 'openai' | 'anthropic'
  apiKey?: string
}

interface LLMProfiles {
  [key: string]: { apiKey: string }
}

const LLM_PRESETS: LLMConfig[] = [
  {
    id: 'xiaomi-mimo',
    name: '小米 MiMo',
    apiUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    model: 'mimo-v2.5-pro',
    protocol: 'anthropic',
  },
  {
    id: 'claude',
    name: 'Claude',
    apiUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    protocol: 'anthropic',
  },
  {
    id: 'codex',
    name: 'Codex (OpenAI)',
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    protocol: 'openai',
  },
]

function loadLLMConfig(): LLMConfig {
  try {
    const saved = localStorage.getItem('llm-config')
    if (saved) return JSON.parse(saved)
  } catch {}
  return LLM_PRESETS[0]
}

function saveLLMConfig(config: LLMConfig) {
  localStorage.setItem('llm-config', JSON.stringify(config))
}

function loadLLMProfiles(): LLMProfiles {
  try {
    const saved = localStorage.getItem('llm-profiles')
    if (saved) return JSON.parse(saved)
  } catch {}
  return {}
}

function saveLLMProfiles(profiles: LLMProfiles) {
  localStorage.setItem('llm-profiles', JSON.stringify(profiles))
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
  const [llmConfig, setLlmConfig] = useState<LLMConfig>(loadLLMConfig)
  const [llmProfiles, setLlmProfiles] = useState<LLMProfiles>(loadLLMProfiles)
  const [showLLMSettings, setShowLLMSettings] = useState(false)
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null)
  const [editingKeyValue, setEditingKeyValue] = useState('')
  const [pastedImages, setPastedImages] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const quickPrompts = language === 'zh' ? QUICK_PROMPTS_ZH : QUICK_PROMPTS_EN

  // Handle image paste
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) continue

        const reader = new FileReader()
        reader.onload = () => {
          const base64 = reader.result as string
          setPastedImages((prev) => [...prev, base64])
        }
        reader.readAsDataURL(blob)
      }
    }
  }, [])

  const removeImage = useCallback((index: number) => {
    setPastedImages((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleLLMChange = useCallback((preset: LLMConfig) => {
    const profile = llmProfiles[preset.id]
    const config = { ...preset, apiKey: profile?.apiKey }
    setLlmConfig(config)
    saveLLMConfig(config)
    setShowLLMSettings(false)
  }, [llmProfiles])

  const handleSaveApiKey = useCallback((presetId: string) => {
    const newProfiles = { ...llmProfiles, [presetId]: { apiKey: editingKeyValue } }
    setLlmProfiles(newProfiles)
    saveLLMProfiles(newProfiles)
    // Update current config if editing the active one
    if (llmConfig.id === presetId) {
      const updated = { ...llmConfig, apiKey: editingKeyValue }
      setLlmConfig(updated)
      saveLLMConfig(updated)
    }
    setEditingKeyId(null)
    setEditingKeyValue('')
  }, [llmProfiles, llmConfig, editingKeyValue])

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
      if ((!text.trim() && pastedImages.length === 0) || agentState.isProcessing) return

      const userMsg: ConversationMessage = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content: text.trim() || '请分析这张图片',
        timestamp: Date.now(),
        images: pastedImages.length > 0 ? pastedImages : undefined,
      }

      agentDispatch({ type: 'ADD_USER_MESSAGE', payload: userMsg })
      agentDispatch({ type: 'SET_PROCESSING', payload: true })
      setInput('')
      setPastedImages([])

      // Build LLM history from conversation
      const convId = agentState.activeConversationId!
      const existingHistory = historyRef.current.get(convId) ?? []
      const userMessage: AgentMessage = {
        role: 'user',
        content: text.trim() || '请分析这张图片',
        images: pastedImages.length > 0 ? pastedImages : undefined,
      }
      const llmHistory: AgentMessage[] = [
        ...existingHistory,
        userMessage,
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
        const profile = llmProfiles[llmConfig.id]
        const generator = runAgent(text.trim(), appState, llmHistory, language, controller.signal, {
          apiUrl: llmConfig.apiUrl,
          model: llmConfig.model,
          apiKey: profile?.apiKey || llmConfig.apiKey || undefined,
        })
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
          <button
            className="ai-chat-llm-badge"
            type="button"
            onClick={() => setShowLLMSettings(!showLLMSettings)}
            title="切换 LLM"
          >
            {llmConfig.name}
          </button>
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

      {showLLMSettings && (
        <div className="ai-llm-settings">
          <div className="ai-llm-settings-title">选择 LLM</div>
          <div className="ai-llm-options">
            {LLM_PRESETS.map((preset) => {
              const profile = llmProfiles[preset.id]
              const hasKey = !!profile?.apiKey
              const isActive = llmConfig.id === preset.id
              const isEditing = editingKeyId === preset.id

              return (
                <div key={preset.id} className={`ai-llm-option ${isActive ? 'active' : ''}`}>
                  <button
                    className="ai-llm-option-select"
                    type="button"
                    onClick={() => handleLLMChange(preset)}
                  >
                    <span className="ai-llm-option-name">{preset.name}</span>
                    <span className="ai-llm-option-model">{preset.model}</span>
                    {isActive && <Check size={14} />}
                  </button>
                  <button
                    className={`ai-llm-key-btn ${hasKey ? 'configured' : ''}`}
                    type="button"
                    onClick={() => {
                      if (isEditing) {
                        handleSaveApiKey(preset.id)
                      } else {
                        setEditingKeyId(preset.id)
                        setEditingKeyValue(profile?.apiKey ?? '')
                      }
                    }}
                    title={hasKey ? 'API Key 已配置' : '配置 API Key'}
                  >
                    {isEditing ? '保存' : hasKey ? '✓ Key' : '+ Key'}
                  </button>
                  {isEditing && (
                    <input
                      type="password"
                      className="ai-llm-api-key"
                      placeholder={`${preset.name} API Key`}
                      value={editingKeyValue}
                      onChange={(e) => setEditingKeyValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey(preset.id)}
                      autoFocus
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

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

      {pastedImages.length > 0 && (
        <div className="ai-chat-images-preview">
          {pastedImages.map((img, index) => (
            <div key={index} className="ai-chat-image-wrapper">
              <img src={img} alt={`Preview ${index + 1}`} className="ai-chat-image-thumb" />
              <button
                type="button"
                className="ai-chat-image-remove"
                onClick={() => removeImage(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <form className="ai-chat-input" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          placeholder={pastedImages.length > 0 ? '添加说明或直接发送...' : (t.ai?.inputPlaceholder ?? 'Ask a question... (Ctrl+V to paste image)')}
          disabled={agentState.isProcessing}
        />
        {isStreaming ? (
          <button type="button" onClick={handleStop} title="Stop">
            <Square size={18} />
          </button>
        ) : (
          <button type="submit" disabled={agentState.isProcessing || (!input.trim() && pastedImages.length === 0)}>
            {agentState.isProcessing ? <Loader2 size={18} className="ai-spin" /> : <Send size={18} />}
          </button>
        )}
      </form>
    </div>
  )
}
