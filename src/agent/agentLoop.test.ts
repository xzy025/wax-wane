// runAgent(live agent loop)单测——此前唯一在跑的主循环反而零测试(死代码 deep-agents 却有),
// 2026-07-06 review 补上。mock 全部 IO 依赖(streamChat/executeTool),只验循环编排语义。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentMessage, AgentEvent, ToolCall } from './types'

vi.mock('./llmClient', () => ({ streamChat: vi.fn() }))
vi.mock('./tools', () => ({ toolDefinitions: [], executeTool: vi.fn() }))
vi.mock('./prompts', () => ({ buildSystemPrompt: () => 'SYSTEM' }))
vi.mock('./contextCompression', () => ({
  compressMessages: (msgs: AgentMessage[]) => ({ summary: undefined, recentMessages: msgs }),
  compressToolResult: (_name: string, result: string) => `compressed:${result}`,
}))

import { runAgent } from './agentLoop'
import { streamChat } from './llmClient'
import { executeTool } from './tools'

const mockStreamChat = vi.mocked(streamChat)
const mockExecuteTool = vi.mocked(executeTool)

type Chunk = { type: 'token'; data: string } | { type: 'tool_calls'; data: ToolCall[] }

/** 造一个 streamChat 单次响应:先吐 tokens,再(可选)吐 tool_calls。 */
function llmTurn(tokens: string[], toolCalls?: ToolCall[]) {
  return async function* (): AsyncGenerator<Chunk> {
    for (const t of tokens) yield { type: 'token', data: t }
    if (toolCalls) yield { type: 'tool_calls', data: toolCalls }
  }
}

const tc = (id: string, name = 'getQuote', args = '{"code":"600519"}'): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: args },
})

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

const appState = {} as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runAgent — live agent loop', () => {
  it('无工具调用:透传 token 并以 assistant_message 收尾,只打一次 LLM', async () => {
    mockStreamChat.mockReturnValueOnce(llmTurn(['你好', ',世界'])())
    const events = await collect(runAgent('hi', appState, [], 'zh'))
    expect(events).toEqual([
      { type: 'token', content: '你好' },
      { type: 'token', content: ',世界' },
      { type: 'assistant_message', content: '你好,世界' },
    ])
    expect(mockStreamChat).toHaveBeenCalledTimes(1)
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('一轮工具调用:tool_start/tool_result 事件、tool 消息带 tool_call_id、压缩后入上下文', async () => {
    mockStreamChat
      .mockReturnValueOnce(llmTurn(['查一下'], [tc('call_1')])())
      .mockReturnValueOnce(llmTurn(['答案'])())
    mockExecuteTool.mockResolvedValueOnce('RAW_RESULT')

    const events = await collect(runAgent('贵州茅台多少钱', appState, [], 'zh'))

    expect(events).toContainEqual({ type: 'tool_start', toolName: 'getQuote', toolId: 'call_1' })
    expect(events).toContainEqual({ type: 'tool_result', toolName: 'getQuote', toolId: 'call_1', result: 'RAW_RESULT' })
    expect(events[events.length - 1]).toEqual({ type: 'assistant_message', content: '答案' })
    expect(mockExecuteTool).toHaveBeenCalledWith('getQuote', { code: '600519' }, appState)

    // 第二次 LLM 调用的上下文里必须有 assistant(tool_calls) + tool(tool_call_id,压缩结果)两条
    const secondCallMsgs = mockStreamChat.mock.calls[1][0] as AgentMessage[]
    const toolMsg = secondCallMsgs.find((m) => m.role === 'tool')
    expect(toolMsg).toMatchObject({ tool_call_id: 'call_1', content: 'compressed:RAW_RESULT' })
    expect(secondCallMsgs.some((m) => m.role === 'assistant' && m.tool_calls?.length === 1)).toBe(true)
  })

  it('工具参数是坏 JSON:降级为空参数继续执行,不崩', async () => {
    mockStreamChat
      .mockReturnValueOnce(llmTurn([], [tc('call_bad', 'getQuote', '{oops')])())
      .mockReturnValueOnce(llmTurn(['ok'])())
    mockExecuteTool.mockResolvedValueOnce('r')
    await collect(runAgent('x', appState, [], 'zh'))
    expect(mockExecuteTool).toHaveBeenCalledWith('getQuote', {}, appState)
  })

  it('连续 10 轮都要工具:触发无工具的最终收尾调用', async () => {
    for (let i = 0; i < 10; i++) {
      mockStreamChat.mockReturnValueOnce(llmTurn([`第${i}轮`], [tc(`call_${i}`)])())
    }
    mockStreamChat.mockReturnValueOnce(llmTurn(['最终分析'])())
    mockExecuteTool.mockResolvedValue('r')

    const events = await collect(runAgent('deep dive', appState, [], 'zh'))

    expect(mockStreamChat).toHaveBeenCalledTimes(11)
    // 最终调用:不带工具定义 + 追加"请给最终分析"的用户消息
    const finalCall = mockStreamChat.mock.calls[10]
    expect(finalCall[1]).toEqual([])
    const finalMsgs = finalCall[0] as AgentMessage[]
    expect(finalMsgs[finalMsgs.length - 1].role).toBe('user')
    expect(events[events.length - 1]).toEqual({ type: 'assistant_message', content: '最终分析' })
  })

  it('LLM 流抛错:产出 error 事件并终止', async () => {
    mockStreamChat.mockImplementationOnce(async function* () {
      yield { type: 'token', data: '半' }
      throw new Error('boom')
    })
    const events = await collect(runAgent('x', appState, [], 'zh'))
    expect(events[events.length - 1]).toEqual({ type: 'error', message: 'boom' })
  })

  it('中断(AbortError):静默返回,无 error 事件', async () => {
    mockStreamChat.mockImplementationOnce(async function* () {
      yield { type: 'token', data: '半' }
      throw new DOMException('aborted', 'AbortError')
    })
    const events = await collect(runAgent('x', appState, [], 'zh'))
    expect(events).toEqual([{ type: 'token', content: '半' }])
  })
})
