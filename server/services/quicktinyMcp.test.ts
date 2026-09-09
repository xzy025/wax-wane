import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithProxy } from '../lib/llm'
import {
  discoverQuickTinyMcpTools,
  callConfiguredQuickTinyLadderTool,
  findQuickTinyLadderTools,
  getQuickTinyMcpHealth,
  getQuickTinyMcpConfigStatus,
  probeQuickTinyMcp,
  resetQuickTinyMcpForTests,
} from './quicktinyMcp'

vi.mock('../lib/llm', () => ({
  fetchWithProxy: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
  resetQuickTinyMcpForTests()
})

beforeEach(() => {
  // Tests must not inherit the developer's real QuickTiny credentials or
  // statically configured tool name.
  vi.stubEnv('QUICKTINY_API_KEY', '')
  vi.stubEnv('QUICKTINY_MCP_URL', '')
  vi.stubEnv('QUICKTINY_LADDER_TOOL_NAME', '')
  vi.stubEnv('QUICKTINY_LADDER_TOOL_ARGS_JSON', '')
})

function response(body: string, contentType = 'application/json') {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType }),
    text: vi.fn().mockResolvedValue(body),
  }
}

describe('QuickTiny MCP discovery', () => {
  it('fails closed without an API key and does not make a network request', async () => {
    vi.stubEnv('QUICKTINY_API_KEY', '')

    expect(getQuickTinyMcpConfigStatus()).toMatchObject({
      configured: false,
      hasApiKey: false,
      endpoint: 'https://stock.quicktiny.cn/api/mcp',
    })
    await expect(discoverQuickTinyMcpTools()).rejects.toThrow(/API key is not configured/)
    expect(fetchWithProxy).not.toHaveBeenCalled()
    expect(getQuickTinyMcpHealth()).toMatchObject({ state: 'unavailable', configured: false })
  })

  it('discovers the live tool schema and identifies ladder candidates', async () => {
    vi.stubEnv('QUICKTINY_API_KEY', 'test-secret')
    vi.stubEnv('QUICKTINY_MCP_URL', 'https://example.test/mcp/')
    vi.mocked(fetchWithProxy).mockResolvedValue(
      response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [
            { name: 'get_limit_up_ladder', description: '读取涨停梯队' },
            { name: 'get_market_calendar', description: '交易日历' },
          ],
        },
      })) as unknown as Awaited<ReturnType<typeof fetchWithProxy>>,
    )

    const tools = await discoverQuickTinyMcpTools()
    expect(tools.map((tool) => tool.name)).toEqual(['get_limit_up_ladder', 'get_market_calendar'])
    expect(findQuickTinyLadderTools(tools).map((tool) => tool.name)).toEqual(['get_limit_up_ladder'])
    expect(getQuickTinyMcpHealth()).toMatchObject({
      endpoint: 'https://example.test/mcp',
      configured: true,
      state: 'healthy',
      toolsCount: 2,
      ladderToolNames: ['get_limit_up_ladder'],
    })

    const [url, options] = vi.mocked(fetchWithProxy).mock.calls[0]
    expect(url).toBe('https://example.test/mcp')
    expect(options).toMatchObject({ method: 'POST' })
    expect(options.headers).toMatchObject({ Authorization: 'Bearer test-secret' })
    expect(JSON.parse(options.body as string)).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })
  })

  it('fails closed on a non-JSON response', async () => {
    vi.stubEnv('QUICKTINY_API_KEY', 'test-secret')
    vi.mocked(fetchWithProxy).mockResolvedValue(
      response(
        'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n',
        'text/event-stream',
      ) as unknown as Awaited<ReturnType<typeof fetchWithProxy>>,
    )

    await expect(probeQuickTinyMcp()).rejects.toThrow(/invalid JSON-RPC response/)
    expect(getQuickTinyMcpHealth()).toMatchObject({ state: 'unavailable' })
  })

  it('records JSON-RPC errors without exposing the API key', async () => {
    vi.stubEnv('QUICKTINY_API_KEY', 'test-secret')
    vi.mocked(fetchWithProxy).mockResolvedValue(
      response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32001, message: 'unauthorized test-secret' },
      })) as unknown as Awaited<ReturnType<typeof fetchWithProxy>>,
    )

    await expect(probeQuickTinyMcp()).rejects.toThrow(/unauthorized \[redacted\]/)
    expect(getQuickTinyMcpHealth()).toMatchObject({ state: 'unavailable' })
    expect(getQuickTinyMcpHealth().lastError).not.toContain('test-secret')
  })

  it('refuses to guess a ladder tool name even when tools/list has a candidate', async () => {
    vi.stubEnv('QUICKTINY_API_KEY', 'test-secret')
    vi.mocked(fetchWithProxy).mockResolvedValue(
      response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { tools: [{ name: 'get_limit_up_ladder' }] },
      })) as unknown as Awaited<ReturnType<typeof fetchWithProxy>>,
    )

    await expect(callConfiguredQuickTinyLadderTool()).rejects.toThrow(/TOOL_NAME is not configured/)
    expect(fetchWithProxy).not.toHaveBeenCalled()
  })

  it('validates configured tool and required arguments before tools/call', async () => {
    vi.stubEnv('QUICKTINY_API_KEY', 'test-secret')
    vi.stubEnv('QUICKTINY_LADDER_TOOL_NAME', 'get_limit_up_ladder')
    vi.stubEnv('QUICKTINY_LADDER_TOOL_ARGS_JSON', '{}')
    vi.mocked(fetchWithProxy).mockResolvedValue(
      response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [{
            name: 'get_limit_up_ladder',
            inputSchema: { type: 'object', required: ['tradeDate'] },
          }],
        },
      })) as unknown as Awaited<ReturnType<typeof fetchWithProxy>>,
    )

    await expect(callConfiguredQuickTinyLadderTool()).rejects.toThrow(/missing: tradeDate/)
    expect(fetchWithProxy).toHaveBeenCalledTimes(1)
  })

  it('calls the configured live-schema tool and preserves opaque MCP result for the adapter', async () => {
    vi.stubEnv('QUICKTINY_API_KEY', 'test-secret')
    vi.stubEnv('QUICKTINY_LADDER_TOOL_NAME', 'get_limit_up_ladder')
    vi.stubEnv('QUICKTINY_LADDER_TOOL_ARGS_JSON', '{"tradeDate":"2026-09-02"}')
    vi.mocked(fetchWithProxy)
      .mockResolvedValueOnce(
        response(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            tools: [{
              name: 'get_limit_up_ladder',
              inputSchema: { type: 'object', required: ['tradeDate'] },
            }],
          },
        })) as unknown as Awaited<ReturnType<typeof fetchWithProxy>>,
      )
      .mockResolvedValueOnce(
        response(JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { structuredContent: { tradeDate: '2026-09-02', rows: [] } },
        })) as unknown as Awaited<ReturnType<typeof fetchWithProxy>>,
      )

    await expect(callConfiguredQuickTinyLadderTool()).resolves.toEqual({
      structuredContent: { tradeDate: '2026-09-02', rows: [] },
    })
    const [, options] = vi.mocked(fetchWithProxy).mock.calls[1]
    expect(JSON.parse(options.body as string)).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_limit_up_ladder', arguments: { tradeDate: '2026-09-02' } },
    })
  })
})
