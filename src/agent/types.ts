import type { AppState } from '../store'

// --- Agent Messages (for LLM conversation) ---

/** A message from the system, user, or assistant in the LLM conversation. */
export type AgentMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage

export interface SystemMessage {
  readonly role: 'system'
  readonly content: string
}

export interface UserMessage {
  readonly role: 'user'
  readonly content: string
}

export interface AssistantMessage {
  readonly role: 'assistant'
  readonly content: string
  readonly tool_calls?: readonly ToolCall[]
}

export interface ToolMessage {
  readonly role: 'tool'
  readonly content: string
  readonly tool_call_id: string
}

export interface ToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly arguments: string
  }
}

// --- Tool Definitions (OpenAI function calling format) ---

export interface ToolPropertyDefinition {
  readonly type: string
  readonly description: string
  readonly enum?: readonly string[]
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: {
    readonly type: 'object'
    readonly properties: Record<string, ToolPropertyDefinition>
    readonly required: readonly string[]
  }
}

export interface ToolModule {
  readonly schema: ToolDefinition
  readonly execute: (args: Record<string, unknown>, state: AppState) => unknown
}

// --- Agent Events (yielded by agent loop to UI) ---

export type AgentEvent =
  | { readonly type: 'tool_start'; readonly toolName: string; readonly toolId: string }
  | { readonly type: 'tool_result'; readonly toolName: string; readonly toolId: string; readonly result: unknown }
  | { readonly type: 'token'; readonly content: string }
  | { readonly type: 'assistant_message'; readonly content: string }
  | { readonly type: 'error'; readonly message: string }

// --- Agent Store State ---

export interface AgentConversation {
  readonly id: string
  readonly messages: readonly ConversationMessage[]
  readonly createdAt: string
}

export interface ConversationMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly timestamp: number
  readonly toolCalls?: readonly ToolCallInfo[]
}

export interface ToolCallInfo {
  readonly toolName: string
  readonly toolId: string
  readonly result?: unknown
  readonly status: 'running' | 'done'
}

export interface AgentMemory {
  facts: string[]
  lastUpdated: string
}

export interface AgentState {
  conversations: AgentConversation[]
  activeConversationId: string | null
  isProcessing: boolean
  memory: AgentMemory
  isOpen: boolean
}

export type AgentAction =
  | { type: 'TOGGLE_PANEL' }
  | { type: 'START_CONVERSATION' }
  | { type: 'ADD_USER_MESSAGE'; payload: ConversationMessage }
  | { type: 'ADD_ASSISTANT_MESSAGE'; payload: ConversationMessage }
  | { type: 'UPDATE_TOOL_CALL'; payload: { messageId: string; toolCall: ToolCallInfo } }
  | { type: 'SET_PROCESSING'; payload: boolean }
  | { type: 'CLEAR_CONVERSATION' }
  | { type: 'STREAM_TOKEN'; payload: { messageId: string; token: string } }

// --- SSE Stream Types ---

export interface SSEToolCallDelta {
  readonly index: number
  readonly id?: string
  readonly type?: 'function'
  readonly function?: {
    readonly name?: string
    readonly arguments?: string
  }
}

export interface SSEDelta {
  readonly content?: string
  readonly tool_calls?: readonly SSEToolCallDelta[]
}

export interface SSEChoice {
  readonly delta?: SSEDelta
  readonly finish_reason?: string
}

export interface SSEChunk {
  readonly choices?: readonly SSEChoice[]
}
