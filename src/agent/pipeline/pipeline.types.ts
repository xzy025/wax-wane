import type { AppState } from '../../store'
import type { AgentMessage, AgentEvent } from '../types'

// ── Agent Context ─────────────────────────────────────────

/** Context passed through the middleware pipeline */
export interface AgentContext {
  /** User ID */
  userId: string
  /** Session ID */
  sessionId: string
  /** Current app state */
  appState: AppState
  /** Messages being processed */
  messages: AgentMessage[]
  /** Language */
  language: 'zh' | 'en'
  /** User's original message */
  userMessage: string
  /** LLM config ID */
  llmConfigId?: string
  /** Abort signal */
  signal?: AbortSignal
  /** Arbitrary metadata for middleware communication */
  metadata: Record<string, unknown>
  /** Start time (set by pipeline) */
  startTime?: number
}

// ── Agent Response ────────────────────────────────────────

/** Response from agent execution */
export interface AgentResponse {
  /** Final text output */
  content: string
  /** Tool calls made */
  toolCalls?: Array<{
    name: string
    args: Record<string, unknown>
    result: unknown
  }>
  /** Usage statistics */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  /** Duration in ms */
  duration?: number
}

// ── Middleware Interface ───────────────────────────────────

/** Tool call interception result */
export interface ToolCallInterception {
  /** Whether to proceed with the actual tool call */
  proceed: boolean
  /** Modified arguments (if any) */
  modifiedArgs?: Record<string, unknown>
  /** Cached result to return instead of calling the tool */
  cachedResult?: unknown
}

/** Middleware for the agent pipeline */
export interface AgentMiddleware {
  /** Unique name for logging/debugging */
  name: string
  /** Execution order (lower runs first) */
  order: number

  /**
   * Called before the LLM is invoked.
   * Can modify context (e.g., compress messages, inject memory).
   */
  before?(context: AgentContext): Promise<AgentContext>

  /**
   * Called after the LLM responds.
   * Can modify the response (e.g., post-process, log).
   */
  after?(context: AgentContext, response: AgentResponse): Promise<AgentResponse>

  /**
   * Called before a tool is executed.
   * Can intercept to return cached results or modify args.
   */
  onToolCall?(
    toolName: string,
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolCallInterception>

  /**
   * Called when an error occurs.
   * Can return a fallback response or re-throw.
   */
  onError?(error: Error, context: AgentContext): Promise<AgentResponse | null>
}

// ── Pipeline Events ───────────────────────────────────────

/** Events emitted by the pipeline for observability */
export type PipelineEvent =
  | { type: 'pipeline:start'; context: AgentContext }
  | { type: 'middleware:before'; name: string }
  | { type: 'middleware:after'; name: string }
  | { type: 'middleware:tool_call'; name: string; toolName: string }
  | { type: 'middleware:error'; name: string; error: string }
  | { type: 'pipeline:end'; response: AgentResponse }
  | { type: 'pipeline:error'; error: string }
