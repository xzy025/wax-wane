import type { AgentMiddleware, AgentContext, AgentResponse, PipelineEvent } from '../pipeline.types'

/** Log level */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Logger interface */
interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/** Default console logger */
const defaultLogger: Logger = {
  debug: (msg, ...args) => console.debug(`[Agent] ${msg}`, ...args),
  info: (msg, ...args) => console.log(`[Agent] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[Agent] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[Agent] ${msg}`, ...args),
}

/**
 * Logging middleware.
 * Logs agent execution for debugging and monitoring.
 */
export function createLoggingMiddleware(
  logLevel: LogLevel = 'info',
  logger: Logger = defaultLogger,
): AgentMiddleware {
  const levelOrder: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  }

  const shouldLog = (level: LogLevel) => levelOrder[level] >= levelOrder[logLevel]

  return {
    name: 'logging',
    order: 99,

    async before(context: AgentContext): Promise<AgentContext> {
      if (shouldLog('info')) {
        const msgPreview = context.userMessage.substring(0, 50)
        logger.info(
          `Request: userId=${context.userId} | ` +
          `session=${context.sessionId} | ` +
          `message="${msgPreview}${context.userMessage.length > 50 ? '...' : ''}"`,
        )
      }

      if (shouldLog('debug')) {
        logger.debug(
          `Context: messages=${context.messages.length} | ` +
          `language=${context.language} | ` +
          `llm=${context.llmConfigId ?? 'default'}`,
        )
      }

      return context
    },

    async after(context: AgentContext, response: AgentResponse): Promise<AgentResponse> {
      if (shouldLog('info')) {
        logger.info(
          `Response: duration=${response.duration ?? '?'}ms | ` +
          `tokens=${response.usage?.totalTokens ?? '?'} | ` +
          `content=${response.content.substring(0, 100)}...`,
        )
      }

      if (response.toolCalls && shouldLog('debug')) {
        logger.debug(
          `Tools called: ${response.toolCalls.map((tc) => tc.name).join(', ')}`,
        )
      }

      return response
    },

    async onToolCall(toolName, args) {
      if (shouldLog('debug')) {
        const argsPreview = JSON.stringify(args).substring(0, 100)
        logger.debug(`Tool call: ${toolName} | args=${argsPreview}`)
      }
      return { proceed: true }
    },

    async onError(error, context) {
      if (shouldLog('error')) {
        logger.error(
          `Error: ${error.message} | ` +
          `userId=${context.userId} | ` +
          `session=${context.sessionId}`,
        )
      }
      return null
    },
  }
}

/** Default logging middleware instance */
export const loggingMiddleware = createLoggingMiddleware('info')

/**
 * Pipeline event logger.
 * Attach to pipeline.onEvent() for detailed observability.
 */
export function createPipelineEventLogger(logger: Logger = defaultLogger): (event: PipelineEvent) => void {
  return (event: PipelineEvent) => {
    switch (event.type) {
      case 'pipeline:start':
        logger.debug(`Pipeline started: userId=${event.context.userId}`)
        break
      case 'middleware:before':
        logger.debug(`  → ${event.name}.before()`)
        break
      case 'middleware:after':
        logger.debug(`  ← ${event.name}.after()`)
        break
      case 'middleware:tool_call':
        logger.debug(`  ⚙ ${event.name}.onToolCall(${event.toolName})`)
        break
      case 'middleware:error':
        logger.warn(`  ✗ ${event.name}: ${event.error}`)
        break
      case 'pipeline:end':
        logger.debug(`Pipeline completed in ${event.response.duration ?? '?'}ms`)
        break
      case 'pipeline:error':
        logger.error(`Pipeline failed: ${event.error}`)
        break
    }
  }
}
