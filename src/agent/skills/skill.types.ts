import type { AppState } from '../../store'

// ── Skill Definition ──────────────────────────────────────

/** A Skill is a pre-defined multi-step workflow that an Agent can execute */
export interface Skill {
  /** Unique identifier */
  id: string
  /** Human-readable name */
  name: string
  /** Description shown to the agent */
  description: string
  /** Trigger conditions for auto-matching */
  trigger: SkillTrigger
  /** Tools required by this skill */
  requiredTools: string[]
  /** Execution steps */
  steps: SkillStep[]
  /** Output format */
  outputFormat: 'report' | 'chat' | 'structured'
  /** Custom system prompt override (optional) */
  systemPrompt?: string
}

/** How a skill gets triggered */
export interface SkillTrigger {
  /** Keywords to match in user message (any match triggers) */
  keywords: string[]
  /** Minimum keyword match count (default: 1) */
  minMatches?: number
}

/** A single step in a skill workflow */
export interface SkillStep {
  /** Step identifier */
  id: string
  /** Human-readable step name */
  name: string
  /** Tool to call (or 'llm' for pure LLM reasoning) */
  tool: string | 'llm'
  /** Static arguments or dynamic resolver */
  args?: Record<string, unknown> | ((ctx: SkillContext) => Record<string, unknown>)
  /** Whether this step is required (can fail without aborting) */
  optional?: boolean
  /** Post-process the result before storing */
  postProcess?: (result: unknown, ctx: SkillContext) => string
}

// ── Skill Execution Context ───────────────────────────────

/** Context passed through skill execution */
export interface SkillContext {
  /** Current app state (trades, groups, etc.) */
  appState: AppState
  /** Accumulated results from previous steps */
  results: Record<string, string>
  /** Current step index */
  currentStep: number
  /** Total steps */
  totalSteps: number
  /** User's original message */
  userMessage: string
  /** Language */
  language: 'zh' | 'en'
}

// ── Skill Execution Result ────────────────────────────────

/** Result of executing a skill step */
export interface SkillStepResult {
  /** Step ID */
  stepId: string
  /** Step name */
  stepName: string
  /** Tool that was called */
  toolName: string
  /** Arguments passed */
  args: Record<string, unknown>
  /** Raw result from tool */
  rawResult: unknown
  /** Processed/summary text */
  summary: string
  /** Whether the step succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
}

/** Result of executing a complete skill */
export interface SkillExecutionResult {
  /** Skill ID */
  skillId: string
  /** Skill name */
  skillName: string
  /** All step results */
  steps: SkillStepResult[]
  /** Final synthesized output */
  output: string
  /** Whether all required steps succeeded */
  success: boolean
  /** Execution duration in ms */
  duration: number
}
