import type { AgentResult } from '../types'

/**
 * Shared context for multi-agent pipeline.
 * Accumulates results from each agent step.
 */
export class PipelineContext {
  private results: Map<string, string> = new Map()
  private stepResults: AgentResult[] = []
  private startTime: number

  constructor(
    public readonly userMessage: string,
    public readonly language: 'zh' | 'en' = 'zh',
  ) {
    this.startTime = Date.now()
  }

  /** Add a result from a completed agent step */
  addResult(result: AgentResult): void {
    this.stepResults.push(result)
    if (result.success) {
      this.results.set(result.stepName, result.content)
    }
  }

  /** Get the result of a specific step */
  getStepResult(stepName: string): string | undefined {
    return this.results.get(stepName)
  }

  /** Get all results as a plain object */
  getAllResults(): Record<string, string> {
    return Object.fromEntries(this.results)
  }

  /** Get all step results */
  getStepResults(): AgentResult[] {
    return [...this.stepResults]
  }

  /** Check if a step completed successfully */
  hasStep(stepName: string): boolean {
    return this.results.has(stepName)
  }

  /** Get total duration */
  getDuration(): number {
    return Date.now() - this.startTime
  }

  /** Get a summary of all results */
  getSummary(): string {
    const parts: string[] = []
    for (const [step, content] of this.results) {
      parts.push(`## ${step}\n${content}`)
    }
    return parts.join('\n\n')
  }

  /** Get result count */
  getStepCount(): number {
    return this.stepResults.length
  }

  /** Get successful step count */
  getSuccessCount(): number {
    return this.stepResults.filter(r => r.success).length
  }
}
