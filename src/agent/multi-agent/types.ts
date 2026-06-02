import type { AppState } from '../../store'

// ── Agent Context ─────────────────────────────────────────

/** Context passed to each sub-agent */
export interface AgentContext {
  /** Current app state */
  appState: AppState
  /** User's original message */
  userMessage: string
  /** Language */
  language: 'zh' | 'en'
  /** Accumulated results from previous agents */
  results: Record<string, string>
  /** Current step name */
  currentStep: string
}

// ── Agent Result ──────────────────────────────────────────

/** Result from a sub-agent execution */
export interface AgentResult {
  /** Agent ID */
  agentId: string
  /** Agent name */
  agentName: string
  /** Step name */
  stepName: string
  /** Result text */
  content: string
  /** Whether the agent succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Duration in ms */
  duration: number
}

// ── Sub-Agent Interface ───────────────────────────────────

/** A sub-agent that can be orchestrated */
export interface SubAgent {
  /** Unique identifier */
  id: string
  /** Human-readable name */
  name: string
  /** Step name in the pipeline */
  stepName: string
  /** Execute the agent */
  execute(context: AgentContext): Promise<AgentResult>
}
