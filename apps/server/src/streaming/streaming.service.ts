import { Injectable } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'
import { MessageEvent } from '@nestjs/common'

export interface AgentStreamEvent {
  type: 'token' | 'tool_start' | 'tool_result' | 'error' | 'done'
  content?: string
  toolName?: string
  toolId?: string
  result?: unknown
  message?: string
}

@Injectable()
export class StreamingService {
  /**
   * Create an SSE observable from an async generator.
   */
  createSSEStream(
    generator: AsyncGenerator<AgentStreamEvent>,
  ): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>()

    ;(async () => {
      try {
        for await (const event of generator) {
          subject.next({
            data: JSON.stringify(event),
          } as MessageEvent)

          if (event.type === 'done' || event.type === 'error') {
            subject.complete()
            return
          }
        }
        // If generator ends without explicit done
        subject.next({
          data: JSON.stringify({ type: 'done' }),
        } as MessageEvent)
        subject.complete()
      } catch (err) {
        subject.next({
          data: JSON.stringify({
            type: 'error',
            message: err instanceof Error ? err.message : 'Unknown error',
          }),
        } as MessageEvent)
        subject.complete()
      }
    })()

    return subject.asObservable()
  }

  /**
   * Create an SSE observable from a LangChain event stream.
   */
  createLangChainStream(
    stream: AsyncIterable<unknown>,
    options?: {
      onToken?: (token: string) => void
      onToolCall?: (name: string, args: unknown) => void
    },
  ): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>()

    ;(async () => {
      try {
        for await (const chunk of stream) {
          const c = chunk as Record<string, unknown>

          // Handle AIMessageChunk (text content)
          if (c.content && typeof c.content === 'string') {
            options?.onToken?.(c.content)
            subject.next({
              data: JSON.stringify({ type: 'token', content: c.content }),
            } as MessageEvent)
          }

          // Handle tool calls
          if (c.tool_calls && Array.isArray(c.tool_calls)) {
            for (const tc of c.tool_calls) {
              options?.onToolCall?.(tc.name, tc.args)
              subject.next({
                data: JSON.stringify({
                  type: 'tool_start',
                  toolName: tc.name,
                  toolId: tc.id,
                }),
              } as MessageEvent)
            }
          }
        }

        subject.next({ data: JSON.stringify({ type: 'done' }) } as MessageEvent)
        subject.complete()
      } catch (err) {
        subject.next({
          data: JSON.stringify({
            type: 'error',
            message: err instanceof Error ? err.message : 'Unknown error',
          }),
        } as MessageEvent)
        subject.complete()
      }
    })()

    return subject.asObservable()
  }
}
