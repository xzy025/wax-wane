import type { AppState } from '../store'

// --- Agent Messages (for LLM conversation) ---

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

// --- Tool Definitions (OpenAI function calling format) ---

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, {
      type: string
      description: string
      enum?: string[]
    }>
    required: string[]
  }
}

export interface ToolModule {
  schema: ToolDefinition
  execute: (args: Record<string, unknown>, state: AppState) => unknown
}

// --- Agent Events (yielded by agent loop to UI) ---

export type AgentEvent =
  | { type: 'tool_start'; toolName: string; toolId: string }
  | { type: 'tool_result'; toolName: string; toolId: string; result: unknown }
  | { type: 'token'; content: string }
  | { type: 'assistant_message'; content: string }
  | { type: 'error'; message: string }

// --- Agent Store State ---

export interface AgentConversation {
  id: string
  messages: ConversationMessage[]
  createdAt: string
}

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  toolCalls?: ToolCallInfo[]
}

export interface ToolCallInfo {
  toolName: string
  toolId: string
  result?: unknown
  status: 'running' | 'done'
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

export interface SSEChunk {
  choices?: Array<{
    delta?: {
      content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string
  }>
}
