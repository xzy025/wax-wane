import { useState, useRef, useCallback, useEffect } from 'react'
import { X, CircleNotch, ArrowClockwise, Sparkle } from 'phosphor-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './fundamental.css'

interface FundamentalReportPanelProps {
  stockCode: string
  stockName: string
  onClose: () => void
}

/** Read the LLM preset the user last picked in the AI chat (shared selection). */
function loadLLMId(): string {
  try {
    const saved = localStorage.getItem('llm-config')
    if (saved) return JSON.parse(saved).id
  } catch {
    /* ignore */
  }
  return 'xiaomi-mimo'
}

/**
 * Streams a one-page fundamental snapshot from POST /api/analysis/fundamental and
 * renders it as Markdown. Single request, no tool loop — modeled on ChatPanel's
 * streaming with an AbortController. The server forwards OpenAI-style delta chunks
 * (incl. an upstream `[DONE]`) and then appends a trailing archive-status JSON,
 * so we keep reading until the HTTP stream closes rather than stopping on [DONE].
 */
export function FundamentalReportPanel({
  stockCode,
  stockName,
  onClose,
}: FundamentalReportPanelProps) {
  const [content, setContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [archiveStatus, setArchiveStatus] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const generate = useCallback(async () => {
    abortRef.current?.abort()
    setContent('')
    setError(null)
    setArchiveStatus(null)
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/analysis/fundamental', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockCode, stockName, llmConfig: { id: loadLLMId() } }),
        signal: controller.signal,
      })

      if (!res.ok) {
        setError(`请求失败 (${res.status}): ${await res.text()}`)
        return
      }
      if (!res.body) {
        setError('响应体为空')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let full = ''

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
            setError(json.error)
            continue
          }
          if (typeof json.archiveWarning === 'string') {
            setArchiveStatus(`已保存（${json.archiveWarning}）`)
            continue
          }
          if (json.archived) {
            setArchiveStatus('报告已存档（Markdown 文件 + 向量库）')
            continue
          }

          const delta = (json as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]
            ?.delta?.content
          if (typeof delta === 'string') {
            full += delta
            setContent(full)
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message)
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [stockCode, stockName])

  useEffect(() => {
    generate()
    return () => abortRef.current?.abort()
  }, [generate])

  return (
    <div className="fr-overlay" onClick={onClose}>
      <div className="fr-panel" onClick={(e) => e.stopPropagation()}>
        <div className="fr-header">
          <div className="fr-title">
            <Sparkle size={16} />
            <span>
              基本面分析 · {stockName} ({stockCode})
            </span>
          </div>
          <div className="fr-actions">
            <button type="button" onClick={generate} disabled={isStreaming} title="重新生成">
              <ArrowClockwise size={16} />
            </button>
            <button type="button" onClick={onClose} title="关闭">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="fr-body">
          {error && <div className="fr-error">⚠ {error}</div>}

          {!content && isStreaming && (
            <div className="fr-loading">
              <CircleNotch size={20} className="fr-spin" /> 正在生成基本面报告…
            </div>
          )}

          {content && (
            <div className="fr-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}

          {isStreaming && content && (
            <div className="fr-streaming-indicator">
              <CircleNotch size={14} className="fr-spin" /> 生成中…
            </div>
          )}

          {archiveStatus && <div className="fr-archive">✓ {archiveStatus}</div>}
        </div>
      </div>
    </div>
  )
}
