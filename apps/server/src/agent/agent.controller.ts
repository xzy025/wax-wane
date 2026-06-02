import { Controller, Post, Body, Sse, Get } from '@nestjs/common'
import { Observable } from 'rxjs'
import { MessageEvent } from '@nestjs/common'
import { AgentService } from './agent.service'
import { StreamingService } from '../streaming/streaming.service'

interface ChatDto {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string
    tool_call_id?: string
    tool_calls?: Array<{
      id: string
      type: string
      function: { name: string; arguments: string }
    }>
    images?: string[]
  }>
  tools?: Array<{
    name: string
    description: string
    parameters: unknown
  }>
  llmConfig?: {
    id?: string
  }
}

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly streamingService: StreamingService,
  ) {}

  @Post('chat')
  @Sse('chat')
  chat(@Body() dto: ChatDto): Observable<MessageEvent> {
    // Extract the last user message
    const lastUserMsg = [...dto.messages].reverse().find((m) => m.role === 'user')
    const userMessage = lastUserMsg?.content ?? ''

    // Create async generator from agent service
    const generator = this.agentService.streamChat(
      dto.messages,
      dto.tools ?? [],
      dto.llmConfig?.id,
    )

    return this.streamingService.createSSEStream(generator)
  }

  @Get('health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    }
  }
}
