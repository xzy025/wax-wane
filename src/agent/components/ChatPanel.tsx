import { useState, useRef, useEffect, useCallback } from 'react'
import { PaperPlaneRight, Trash, Sparkle, CircleNotch, Square, ClipboardText, Gear, Check, CheckSquare, ChartLineUp } from 'phosphor-react'
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
import { TradingPatternSelector } from './TradingPatternSelector'
import type { ConversationMessage, AgentMessage } from '../types'
import type { Translation } from '../../types'

interface ChatPanelProps {
  t: Translation
  language: 'zh' | 'en'
}

interface LLMConfig {
  id: string
  name: string
}

const LLM_PRESETS: LLMConfig[] = [
  { id: 'xiaomi-mimo', name: '小米 MiMo' },
  { id: 'claude', name: 'Claude' },
  { id: 'codex', name: 'Codex (OpenAI)' },
  { id: 'gemini', name: 'Gemini' },
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

function loadFundamentalMode(): boolean {
  try {
    return localStorage.getItem('fundamental-mode') === '1'
  } catch {
    return false
  }
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
  const [showLLMSettings, setShowLLMSettings] = useState(false)
  const [fundamentalMode, setFundamentalMode] = useState<boolean>(loadFundamentalMode)
  const [streamingMarkdown, setStreamingMarkdown] = useState(false)
  const [pastedImages, setPastedImages] = useState<string[]>([])
  const [selectedPatterns, setSelectedPatterns] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('selected-trading-patterns')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamingContentRef = useRef('')

  // Resume streaming display when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (streamingContentRef.current) {
          setStreamingContent(streamingContentRef.current)
        }
        // Force scroll to bottom when returning to tab
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }, 100)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

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

  const handlePatternToggle = useCallback((patternId: string) => {
    setSelectedPatterns((prev) => {
      const next = prev.includes(patternId)
        ? prev.filter((id) => id !== patternId)
        : [...prev, patternId]
      localStorage.setItem('selected-trading-patterns', JSON.stringify(next))
      return next
    })
  }, [])

  const handleLLMChange = useCallback((preset: LLMConfig) => {
    setLlmConfig(preset)
    saveLLMConfig(preset)
    setShowLLMSettings(false)
  }, [])

  const handleFundamentalToggle = useCallback(() => {
    setFundamentalMode((prev) => {
      const next = !prev
      try {
        localStorage.setItem('fundamental-mode', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

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

  // Fundamental-analysis mode: bypass the agent loop and stream a one-page
  // report from /api/analysis/fundamental into a single markdown assistant
  // message. Intentionally does NOT touch historyRef so the (large) report
  // doesn't pollute the agent's LLM context.
  const sendFundamental = useCallback(
    async (query: string) => {
      const q = query.trim()
      if (!q || agentState.isProcessing) return

      const userMsg: ConversationMessage = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content: q,
        timestamp: Date.now(),
      }
      agentDispatch({ type: 'ADD_USER_MESSAGE', payload: userMsg })
      agentDispatch({ type: 'SET_PROCESSING', payload: true })
      setInput('')

      const assistantMsgId = `msg-${Date.now() + 1}`
      const assistantMsg: ConversationMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isMarkdown: true,
      }
      agentDispatch({ type: 'ADD_ASSISTANT_MESSAGE', payload: assistantMsg })

      setIsStreaming(true)
      setStreamingMarkdown(true)
      setStreamingContent('')
      streamingContentRef.current = ''

      const controller = new AbortController()
      abortRef.current = controller

      let full = ''
      const setFull = (s: string) => {
        full = s
        streamingContentRef.current = s
        setStreamingContent(s)
      }

      try {
        const res = await fetch('/api/analysis/fundamental', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, llmConfig: { id: llmConfig.id } }),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`请求失败 (${res.status}): ${await res.text()}`)
        if (!res.body) throw new Error('响应体为空')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        // Keep reading past [DONE]; the server appends archive-status frames.
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.slice(5).trim()
            if (!data || data === '[DONE]') continue
            let json: Record<string, unknown>
            try {
              json = JSON.parse(data)
            } catch {
              continue
            }
            if (typeof json.error === 'string') {
              setFull(full || `⚠ ${json.error}`)
              continue
            }
            if (json.archived || typeof json.archiveWarning === 'string') continue
            const delta = (json as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]
              ?.delta?.content
            if (typeof delta === 'string') setFull(full + delta)
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          full = full || `⚠ ${(err as Error).message}`
        }
      } finally {
        agentDispatch({ type: 'STREAM_TOKEN', payload: { messageId: assistantMsgId, token: full } })
        abortRef.current = null
        streamingContentRef.current = ''
        setIsStreaming(false)
        setStreamingMarkdown(false)
        setStreamingContent('')
        agentDispatch({ type: 'SET_PROCESSING', payload: false })
      }
    },
    [agentState.isProcessing, agentDispatch, llmConfig],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      if (fundamentalMode) {
        await sendFundamental(text)
        return
      }
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
        const imagesToSend = pastedImages.length > 0 ? pastedImages : undefined
        console.log('[ChatPanel] Sending message with images:', imagesToSend?.length ?? 0)
        if (imagesToSend) {
          console.log('[ChatPanel] Image format:', imagesToSend[0].substring(0, 50) + '...')
        }
        const generator = runAgent(text.trim(), appState, llmHistory, language, controller.signal, {
          id: llmConfig.id,
        }, imagesToSend, selectedPatterns.length > 0 ? selectedPatterns : undefined)
        let fullContent = ''
        streamingContentRef.current = ''

        for await (const event of generator) {
          switch (event.type) {
            case 'token':
              fullContent += event.content
              streamingContentRef.current = fullContent
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
        streamingContentRef.current = ''
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
      pastedImages,
      llmConfig,
      selectedPatterns,
      fundamentalMode,
      sendFundamental,
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
          <Sparkle size={16} />
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
            <ClipboardText size={14} />
            <span>复盘</span>
          </button>
          {messages.length > 0 && (
            <button
              className="ai-chat-clear"
              type="button"
              onClick={handleClear}
              title={t.ai?.clearChat ?? 'Clear'}
            >
              <Trash size={14} />
            </button>
          )}
        </div>
      </div>

      {showLLMSettings && (
        <div className="ai-llm-settings">
          <div className="ai-llm-settings-title">选择 LLM</div>
          <div className="ai-llm-options">
            {LLM_PRESETS.map((preset) => {
              const isActive = llmConfig.id === preset.id

              return (
                <div key={preset.id} className={`ai-llm-option ${isActive ? 'active' : ''}`}>
                  <button
                    className="ai-llm-option-select"
                    type="button"
                    onClick={() => handleLLMChange(preset)}
                  >
                    <span className="ai-llm-option-name">{preset.name}</span>
                    {isActive && <Check size={14} />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="ai-mode-row">
        <button
          type="button"
          className={`tp-chip ${fundamentalMode ? 'tp-chip-active' : ''}`}
          onClick={handleFundamentalToggle}
          title="勾选后，输入股票代码或名称并发送，即生成基本面分析报告"
        >
          {fundamentalMode ? <CheckSquare size={15} weight="fill" /> : <Square size={15} />}
          <ChartLineUp size={14} aria-hidden="true" />
          基本面分析
        </button>
      </div>

      <TradingPatternSelector
        selectedPatterns={selectedPatterns}
        onToggle={handlePatternToggle}
      />

      <div className="ai-chat-messages">
        {messages.length === 0 && !isStreaming && (
          <div className="ai-chat-welcome">
            <Sparkle size={24} />
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
          <StreamingBubble content={streamingContent} isStreaming={true} isMarkdown={streamingMarkdown} />
        )}

        {isStreaming && !streamingContent && (
          <div className="ai-msg ai-msg-assistant">
            <div className="ai-msg-avatar">
              <CircleNotch size={16} className="ai-spin" />
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
          placeholder={
            fundamentalMode
              ? '输入股票代码或名称，如 300750 / 宁德时代'
              : pastedImages.length > 0
                ? '添加说明或直接发送...'
                : (t.ai?.inputPlaceholder ?? 'Ask a question... (Ctrl+V to paste image)')
          }
          disabled={agentState.isProcessing}
        />
        {isStreaming ? (
          <button type="button" onClick={handleStop} title="Stop">
            <Square size={18} />
          </button>
        ) : (
          <button type="submit" disabled={agentState.isProcessing || (!input.trim() && pastedImages.length === 0)}>
            {agentState.isProcessing ? <CircleNotch size={18} className="ai-spin" /> : <PaperPlaneRight size={18} />}
          </button>
        )}
      </form>
    </div>
  )
}
