import { Injectable } from '@nestjs/common'
import { LLMService } from '../llm/llm.service'
import { ToolsService } from '../tools/tools.service'
import type { AgentStreamEvent } from '../streaming/streaming.service'
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'

@Injectable()
export class AgentService {
  constructor(
    private readonly llmService: LLMService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * Stream chat with the agent.
   * Converts messages to LangChain format and streams responses.
   */
  async *streamChat(
    messages: Array<{
      role: string
      content: string
      tool_call_id?: string
      tool_calls?: Array<{
        id: string
        type: string
        function: { name: string; arguments: string }
      }>
      images?: string[]
    }>,
    tools: Array<{
      name: string
      description: string
      parameters: unknown
    }>,
    llmConfigId?: string,
  ): AsyncGenerator<AgentStreamEvent> {
    try {
      // 1. Create LLM
      const llm = this.llmService.createLLM(llmConfigId, { streaming: true })

      // 2. Convert tools to LangChain format
      const langchainTools = tools.map((t) =>
        this.toolsService.createTool(
          {
            name: t.name,
            description: t.description,
            parameters: t.parameters as {
              type: 'object'
              properties: Record<string, { type: string; description: string }>
              required: readonly string[]
            },
          },
          // Tool executor — for now, return a placeholder
          // In production, this would call the actual tool implementation
          async (args) => {
            return { message: `Tool ${t.name} called with args: ${JSON.stringify(args)}` }
          },
        ),
      )

      // 3. Bind tools to LLM
      const llmWithTools = langchainTools.length > 0 ? llm.bindTools(langchainTools) : llm

      // 4. Convert messages to LangChain format
      const langchainMessages = this.convertMessages(messages)

      // 5. Stream response
      const stream = await llmWithTools.stream(langchainMessages)

      let fullContent = ''
      const toolCalls: Array<{ id: string; name: string; args: string }> = []

      for await (const chunk of stream) {
        // Handle text content
        if (chunk.content && typeof chunk.content === 'string') {
          fullContent += chunk.content
          yield { type: 'token', content: chunk.content }
        }

        // Handle tool calls
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          for (const tc of chunk.tool_calls) {
            yield {
              type: 'tool_start',
              toolName: tc.name,
              toolId: tc.id ?? `tc-${toolCalls.length}`,
            }
            toolCalls.push({
              id: tc.id ?? `tc-${toolCalls.length}`,
              name: tc.name,
              args: JSON.stringify(tc.args),
            })
          }
        }
      }

      // 6. Execute tool calls if any
      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          // Find the tool and execute it
          const tool = langchainTools.find((t) => t.name === tc.name)
          if (tool) {
            try {
              const args = JSON.parse(tc.args)
              const result = await tool.invoke(args)
              yield {
                type: 'tool_result',
                toolName: tc.name,
                toolId: tc.id,
                result,
              }
            } catch (err) {
              yield {
                type: 'tool_result',
                toolName: tc.name,
                toolId: tc.id,
                result: { error: err instanceof Error ? err.message : 'Unknown error' },
              }
            }
          }
        }
      }

      yield { type: 'done' }
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Convert message format to LangChain messages.
   */
  private convertMessages(
    messages: Array<{
      role: string
      content: string
      tool_call_id?: string
      tool_calls?: Array<{
        id: string
        type: string
        function: { name: string; arguments: string }
      }>
    }>,
  ): BaseMessage[] {
    return messages.map((msg) => {
      switch (msg.role) {
        case 'system':
          return new SystemMessage(msg.content)
        case 'user':
          return new HumanMessage(msg.content)
        case 'assistant':
          return new AIMessage({
            content: msg.content,
            tool_calls: msg.tool_calls?.map((tc) => ({
              id: tc.id,
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            })),
          })
        case 'tool':
          return new ToolMessage({
            content: msg.content,
            tool_call_id: msg.tool_call_id ?? '',
          })
        default:
          return new HumanMessage(msg.content)
      }
    })
  }
}
