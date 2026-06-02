import { Test, TestingModule } from '@nestjs/testing'
import { AgentService } from './agent.service'
import { LLMService } from '../llm/llm.service'
import { ToolsService } from '../tools/tools.service'

describe('AgentService', () => {
  let service: AgentService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        {
          provide: LLMService,
          useValue: {
            createLLM: jest.fn().mockReturnValue({
              stream: jest.fn().mockReturnValue(
                (async function* () {
                  yield { content: 'Hello', tool_calls: [] }
                  yield { content: ' world', tool_calls: [] }
                })(),
              ),
              bindTools: jest.fn().mockReturnThis(),
            }),
            getPreset: jest.fn().mockReturnValue({ id: 'default', provider: 'mimo' }),
          },
        },
        {
          provide: ToolsService,
          useValue: {
            createTool: jest.fn().mockReturnValue({
              name: 'test-tool',
              invoke: jest.fn().mockResolvedValue('result'),
            }),
            createTools: jest.fn().mockReturnValue([]),
          },
        },
      ],
    }).compile()

    service = module.get<AgentService>(AgentService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('converts messages correctly', () => {
    // Access private method for testing
    const convertMessages = (service as Record<string, unknown>).convertMessages as (
      msgs: Array<Record<string, unknown>>,
    ) => unknown[]

    const messages = convertMessages([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ])

    expect(messages).toHaveLength(3)
  })
})
