import type {
  AgentContext,
  AgentResponse,
  AgentMiddleware,
  ToolCallInterception,
  PipelineEvent,
} from './pipeline.types'

// ── Agent Pipeline ────────────────────────────────────────

type PipelineEventHandler = (event: PipelineEvent) => void

/**
 * Middleware pipeline for agent execution.
 * Executes middleware in order, supports tool call interception.
 */
export class AgentPipeline {
  private middlewares: AgentMiddleware[] = []
  private eventHandlers: PipelineEventHandler[] = []

  /** Register a middleware */
  use(middleware: AgentMiddleware): this {
    this.middlewares.push(middleware)
    this.middlewares.sort((a, b) => a.order - b.order)
    return this
  }

  /** Remove a middleware by name */
  remove(name: string): this {
    this.middlewares = this.middlewares.filter((m) => m.name !== name)
    return this
  }

  /** Register an event handler */
  onEvent(handler: PipelineEventHandler): this {
    this.eventHandlers.push(handler)
    return this
  }

  /** Emit a pipeline event */
  private emit(event: PipelineEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event)
      } catch {
        // Don't let event handler errors break the pipeline
      }
    }
  }

  /**
   * Execute the pipeline.
   * Runs `before` hooks in order, then calls `executeAgent`,
   * then runs `after` hooks in reverse order.
   */
  async execute(
    context: AgentContext,
    executeAgent: (ctx: AgentContext) => Promise<AgentResponse>,
  ): Promise<AgentResponse> {
    context.startTime = Date.now()
    this.emit({ type: 'pipeline:start', context })

    // ── Before hooks ──────────────────────────────────────
    for (const mw of this.middlewares) {
      if (!mw.before) continue
      try {
        this.emit({ type: 'middleware:before', name: mw.name })
        context = await mw.before(context)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.emit({ type: 'middleware:error', name: mw.name, error: error.message })

        // Try onError handler
        const fallback = await this.tryOnError(mw, error, context)
        if (fallback) {
          fallback.duration = Date.now() - (context.startTime ?? Date.now())
          this.emit({ type: 'pipeline:end', response: fallback })
          return fallback
        }

        // Re-throw if no fallback
        throw error
      }
    }

    // ── Execute agent ─────────────────────────────────────
    let response: AgentResponse
    try {
      response = await executeAgent(context)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.emit({ type: 'pipeline:error', error: error.message })

      // Try onError handlers
      for (const mw of this.middlewares) {
        const fallback = await this.tryOnError(mw, error, context)
        if (fallback) {
          fallback.duration = Date.now() - (context.startTime ?? Date.now())
          this.emit({ type: 'pipeline:end', response: fallback })
          return fallback
        }
      }

      throw error
    }

    // ── After hooks (reverse order) ───────────────────────
    const reversed = [...this.middlewares].reverse()
    for (const mw of reversed) {
      if (!mw.after) continue
      try {
        this.emit({ type: 'middleware:after', name: mw.name })
        response = await mw.after(context, response)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.emit({ type: 'middleware:error', name: mw.name, error: error.message })
        // After hooks don't break the pipeline, just log
      }
    }

    response.duration = Date.now() - (context.startTime ?? Date.now())
    this.emit({ type: 'pipeline:end', response })
    return response
  }

  /**
   * Create a tool call interceptor that runs all middleware `onToolCall` hooks.
   * Use this to wrap the `executeTool` function.
   */
  createToolInterceptor(
    context: AgentContext,
    originalExecuteTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  ): (name: string, args: Record<string, unknown>) => Promise<unknown> {
    return async (name: string, args: Record<string, unknown>) => {
      let currentArgs = args

      for (const mw of this.middlewares) {
        if (!mw.onToolCall) continue

        try {
          this.emit({ type: 'middleware:tool_call', name: mw.name, toolName: name })
          const interception: ToolCallInterception = await mw.onToolCall(name, currentArgs, context)

          if (!interception.proceed) {
            // Middleware says don't proceed — return cached result
            return interception.cachedResult
          }

          if (interception.modifiedArgs) {
            currentArgs = interception.modifiedArgs
          }
        } catch (err) {
          // Log but continue
          console.warn(`[Pipeline] Middleware "${mw.name}" onToolCall error:`, err)
        }
      }

      return originalExecuteTool(name, currentArgs)
    }
  }

  /** Try a middleware's onError handler */
  private async tryOnError(
    mw: AgentMiddleware,
    error: Error,
    context: AgentContext,
  ): Promise<AgentResponse | null> {
    if (!mw.onError) return null
    try {
      return await mw.onError(error, context)
    } catch {
      return null
    }
  }

  /** Get registered middleware names (for debugging) */
  getMiddlewareNames(): string[] {
    return this.middlewares.map((m) => `${m.name}(${m.order})`)
  }
}
