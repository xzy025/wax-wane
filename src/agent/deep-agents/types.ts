import type { AppState } from '../../store'

// ── DeepAgent Config ──────────────────────────────────────

export interface DeepAgentConfig {
  /** LLM provider ID */
  llmId?: string
  /** System prompt override */
  systemPrompt?: string
  /** Enable built-in planning (write_todos) */
  enablePlanning?: boolean
  /** Enable sub-agent delegation (task) */
  enableSubAgents?: boolean
  /** Enable filesystem context management */
  enableFilesystem?: boolean
  /** Max iterations */
  maxIterations?: number
}

// ── DeepAgent Result ──────────────────────────────────────

export interface DeepAgentResult {
  /** Final output text */
  content: string
  /** Tool calls made */
  toolCalls: Array<{
    name: string
    args: Record<string, unknown>
    result: unknown
  }>
  /** Execution duration in ms */
  duration: number
  /** Whether planning was used */
  usedPlanning: boolean
  /** Task list if planning was used */
  taskList?: Array<{
    task: string
    status: 'pending' | 'in_progress' | 'completed'
  }>
}

// ── Agent Event Types ─────────────────────────────────────

export type DeepAgentEvent =
  | { type: 'token'; content: string }
  | { type: 'tool_start'; toolName: string; toolId: string }
  | { type: 'tool_result'; toolName: string; toolId: string; result: unknown }
  | { type: 'task_update'; tasks: Array<{ task: string; status: string }> }
  | { type: 'sub_agent_start'; agentName: string; task: string }
  | { type: 'sub_agent_result'; agentName: string; result: string }
  | { type: 'error'; message: string }
  | { type: 'done' }
