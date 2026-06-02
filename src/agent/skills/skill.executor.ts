import type { AppState } from '../../store'
import type { AgentEvent } from '../types'
import { executeTool } from '../tools'
import type { Skill, SkillContext, SkillStepResult, SkillExecutionResult } from './skill.types'
import { buildStructuredReviewPrompt } from './structured-review.skill'
import { buildTheoryReviewPrompt } from './theory-review.skill'

// ── Skill Executor ────────────────────────────────────────

/** Build prompt for final synthesis based on skill type */
function buildSynthesisPrompt(skill: Skill, ctx: SkillContext): string {
  switch (skill.id) {
    case 'structured-review':
      return buildStructuredReviewPrompt(ctx)
    case 'theory-review':
      return buildTheoryReviewPrompt(ctx)
    default:
      return `请根据以下步骤结果，生成一份综合报告：\n\n${
        Object.entries(ctx.results)
          .map(([step, result]) => `## ${step}\n${result}`)
          .join('\n\n')
      }`
  }
}

/**
 * Execute a skill step-by-step.
 * Yields AgentEvent for each step (tool_start, tool_result).
 * Returns the synthesis prompt at the end.
 */
export async function* executeSkill(
  skill: Skill,
  appState: AppState,
  userMessage: string,
  language: 'zh' | 'en' = 'zh',
): AsyncGenerator<AgentEvent | { type: 'synthesis_prompt'; prompt: string }> {
  const startTime = Date.now()
  const ctx: SkillContext = {
    appState,
    results: {},
    currentStep: 0,
    totalSteps: skill.steps.length,
    userMessage,
    language,
  }

  const stepResults: SkillStepResult[] = []

  for (let i = 0; i < skill.steps.length; i++) {
    const step = skill.steps[i]
    ctx.currentStep = i

    // Resolve dynamic args
    const args = typeof step.args === 'function' ? step.args(ctx) : (step.args ?? {})

    // Yield tool_start event
    const toolName = step.tool === 'llm' ? 'llm_reasoning' : step.tool
    const toolId = `skill-${skill.id}-${step.id}`

    yield {
      type: 'tool_start',
      toolName: `${skill.name} > ${step.name}`,
      toolId,
    }

    // Execute the tool
    let rawResult: unknown
    let success = true
    let error: string | undefined

    try {
      if (step.tool !== 'llm') {
        rawResult = await executeTool(step.tool, args, appState)
      } else {
        // LLM reasoning step — just pass through
        rawResult = { message: 'LLM reasoning will happen during synthesis' }
      }
    } catch (err) {
      success = false
      error = err instanceof Error ? err.message : 'Unknown error'
      rawResult = { error }

      if (!step.optional) {
        // Required step failed — abort
        yield {
          type: 'error',
          message: `Step "${step.name}" failed: ${error}`,
        }
        return
      }
    }

    // Post-process result
    const summary = step.postProcess && rawResult
      ? step.postProcess(rawResult, ctx)
      : typeof rawResult === 'string'
        ? rawResult
        : JSON.stringify(rawResult)

    // Store result in context
    ctx.results[step.id] = summary

    // Yield tool_result event
    yield {
      type: 'tool_result',
      toolName: `${skill.name} > ${step.name}`,
      toolId,
      result: success ? summary : `Error: ${error}`,
    }

    // Record step result
    stepResults.push({
      stepId: step.id,
      stepName: step.name,
      toolName,
      args,
      rawResult,
      summary,
      success,
      error,
    })
  }

  // Build synthesis prompt
  const synthesisPrompt = buildSynthesisPrompt(skill, ctx)

  yield {
    type: 'synthesis_prompt',
    prompt: synthesisPrompt,
  }

  const duration = Date.now() - startTime

  // Log execution stats
  console.log(
    `[Skill] ${skill.name} completed in ${duration}ms | ` +
    `${stepResults.filter((s) => s.success).length}/${stepResults.length} steps succeeded`,
  )
}

/** Quick check if a skill's required tools are available */
export function validateSkillTools(
  skill: Skill,
  availableTools: string[],
): { valid: boolean; missing: string[] } {
  const missing = skill.requiredTools.filter((t) => !availableTools.includes(t))
  return { valid: missing.length === 0, missing }
}
