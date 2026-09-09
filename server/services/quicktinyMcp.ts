import { fetchWithProxy } from '../lib/llm'

export const QUICKTINY_MCP_DEFAULT_URL = 'https://stock.quicktiny.cn/api/mcp'
const DEFAULT_TIMEOUT_MS = 12_000

export interface QuickTinyMcpTool {
  name: string
  description?: string
  inputSchema?: unknown
  [key: string]: unknown
}

export type QuickTinyMcpToolCallResult = Record<string, unknown>

export interface QuickTinyMcpConfigStatus {
  endpoint: string
  hasApiKey: boolean
  configured: boolean
}

export type QuickTinyMcpHealthState = 'unknown' | 'healthy' | 'degraded' | 'unavailable'

export interface QuickTinyMcpHealth {
  endpoint: string
  configured: boolean
  state: QuickTinyMcpHealthState
  lastProbeAt: string | null
  lastError: string | null
  toolsCount: number | null
  ladderToolNames: string[]
}

interface JsonRpcResponse {
  jsonrpc?: string
  id?: string | number | null
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

let requestId = 0
let health: QuickTinyMcpHealth = createInitialHealth()

function endpoint(): string {
  return (process.env.QUICKTINY_MCP_URL || QUICKTINY_MCP_DEFAULT_URL).trim().replace(/\/+$/, '')
}

function apiKey(): string {
  return (process.env.QUICKTINY_API_KEY || '').trim()
}

function timeoutMs(): number {
  const parsed = Number(process.env.QUICKTINY_MCP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

function createInitialHealth(): QuickTinyMcpHealth {
  return {
    endpoint: endpoint(),
    configured: Boolean(apiKey()),
    state: 'unknown',
    lastProbeAt: null,
    lastError: null,
    toolsCount: null,
    ladderToolNames: [],
  }
}

function redact(message: string): string {
  const key = apiKey()
  return key ? message.replaceAll(key, '[redacted]') : message
}

function updateHealth(patch: Partial<QuickTinyMcpHealth>): void {
  health = {
    ...health,
    endpoint: endpoint(),
    configured: Boolean(apiKey()),
    ...patch,
  }
}

function parseJsonRpcResponse(body: string): JsonRpcResponse {
  const text = body.replace(/^\uFEFF/, '').trim()
  if (!text) throw new Error('[QuickTiny MCP] empty response')

  try {
    return JSON.parse(text) as JsonRpcResponse
  } catch (error) {
    throw new Error('[QuickTiny MCP] invalid JSON-RPC response', { cause: error })
  }
}

function assertJsonRpcResponse(response: JsonRpcResponse, expectedId: number): void {
  if (response.jsonrpc !== '2.0' || response.id !== expectedId) {
    throw new Error('[QuickTiny MCP] invalid JSON-RPC envelope')
  }
  if (response.error) {
    const message = response.error.message || `code ${response.error.code ?? 'unknown'}`
    throw new Error(`[QuickTiny MCP] ${redact(message)}`)
  }
}

async function callMcp(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const key = apiKey()
  if (!key) throw new Error('[QuickTiny MCP] API key is not configured')

  const id = ++requestId
  const response = await fetchWithProxy(endpoint(), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(timeoutMs()),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`[QuickTiny MCP] HTTP ${response.status}`)

  const parsed = parseJsonRpcResponse(body)
  assertJsonRpcResponse(parsed, id)
  return parsed.result
}

function isTool(value: unknown): value is QuickTinyMcpTool {
  return Boolean(value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string')
}

function configuredLadderToolName(): string {
  return (process.env.QUICKTINY_LADDER_TOOL_NAME || '').trim()
}

function configuredLadderToolArguments(): Record<string, unknown> {
  const raw = (process.env.QUICKTINY_LADDER_TOOL_ARGS_JSON || '{}').trim()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be a JSON object')
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(`QUICKTINY_LADDER_TOOL_ARGS_JSON 无效：${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

function requiredArguments(tool: QuickTinyMcpTool): string[] {
  const schema = tool.inputSchema
  if (!schema || typeof schema !== 'object') return []
  const required = (schema as { required?: unknown }).required
  return Array.isArray(required) ? required.filter((value): value is string => typeof value === 'string') : []
}

interface JsonSchemaProperty {
  type?: unknown
  enum?: unknown
  minimum?: unknown
  maximum?: unknown
}

function toolProperties(tool: QuickTinyMcpTool): Record<string, JsonSchemaProperty> {
  const schema = tool.inputSchema
  if (!schema || typeof schema !== 'object') return {}
  const properties = (schema as { properties?: unknown }).properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {}
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)),
  ) as Record<string, JsonSchemaProperty>
}

function matchesSchemaType(value: unknown, type: unknown): boolean {
  if (type === 'string') return typeof value === 'string'
  if (type === 'number' || type === 'integer') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'object') return Boolean(value && typeof value === 'object' && !Array.isArray(value))
  if (type === 'array') return Array.isArray(value)
  return true
}

/** Validate a tools/call argument object against the schema returned by tools/list. */
function validateToolArguments(tool: QuickTinyMcpTool, args: Record<string, unknown>): void {
  const schema = tool.inputSchema
  if (!schema || typeof schema !== 'object') return
  const rawSchema = schema as { additionalProperties?: unknown }
  const properties = toolProperties(tool)
  if (rawSchema.additionalProperties === false) {
    const unknown = Object.keys(args).filter((key) => !Object.prototype.hasOwnProperty.call(properties, key))
    if (unknown.length > 0) throw new Error(`[QuickTiny MCP] ${tool.name} 不接受参数：${unknown.join(',')}`)
  }
  const missing = requiredArguments(tool).filter((key) => !Object.prototype.hasOwnProperty.call(args, key))
  if (missing.length > 0) throw new Error(`[QuickTiny MCP] ${tool.name} missing: ${missing.join(',')}`)
  for (const [key, value] of Object.entries(args)) {
    const property = properties[key]
    if (!property) continue
    if (!matchesSchemaType(value, property.type)) {
      throw new Error(`[QuickTiny MCP] ${tool.name}.${key} 类型不符合实时 schema`)
    }
    if (Array.isArray(property.enum) && !property.enum.some((candidate) => candidate === value)) {
      throw new Error(`[QuickTiny MCP] ${tool.name}.${key} 不在实时 schema 允许值内`)
    }
    if (typeof value === 'number' && typeof property.minimum === 'number' && value < property.minimum) {
      throw new Error(`[QuickTiny MCP] ${tool.name}.${key} 小于实时 schema minimum`)
    }
    if (typeof value === 'number' && typeof property.maximum === 'number' && value > property.maximum) {
      throw new Error(`[QuickTiny MCP] ${tool.name}.${key} 大于实时 schema maximum`)
    }
  }
}

export function getQuickTinyMcpConfigStatus(): QuickTinyMcpConfigStatus {
  const key = apiKey()
  return {
    endpoint: endpoint(),
    hasApiKey: Boolean(key),
    configured: Boolean(key),
  }
}

export function findQuickTinyLadderTools(tools: QuickTinyMcpTool[]): QuickTinyMcpTool[] {
  const ladderPattern = /limit.?up|ladder|连板|涨停|首板|梯队/i
  return tools.filter((tool) => ladderPattern.test(`${tool.name} ${tool.description || ''}`))
}

export async function discoverQuickTinyMcpTools(): Promise<QuickTinyMcpTool[]> {
  try {
    const result = await callMcp('tools/list')
    const rawTools = result && typeof result === 'object' ? (result as { tools?: unknown }).tools : undefined
    if (!Array.isArray(rawTools) || !rawTools.every(isTool)) {
      throw new Error('[QuickTiny MCP] tools/list returned an invalid tool list')
    }

    const tools = rawTools
    const ladderTools = findQuickTinyLadderTools(tools)
    updateHealth({
      state: ladderTools.length > 0 ? 'healthy' : 'degraded',
      lastProbeAt: new Date().toISOString(),
      lastError: ladderTools.length > 0 ? null : 'tools/list 未发现可识别的梯队工具',
      toolsCount: tools.length,
      ladderToolNames: ladderTools.map((tool) => tool.name),
    })
    return tools
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error))
    updateHealth({
      state: 'unavailable',
      lastProbeAt: new Date().toISOString(),
      lastError: message,
      toolsCount: null,
      ladderToolNames: [],
    })
    throw new Error(message, { cause: error })
  }
}

/** Call a named, read-only QuickTiny tool after validating it against live tools/list. */
export async function callQuickTinyMcpTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<QuickTinyMcpToolCallResult> {
  if (!toolName.trim()) throw new Error('[QuickTiny MCP] tool name is empty')
  const tools = await discoverQuickTinyMcpTools()
  const tool = tools.find((candidate) => candidate.name === toolName)
  if (!tool) throw new Error(`[QuickTiny MCP] tool not advertised by live tools/list: ${toolName}`)
  validateToolArguments(tool, args)

  try {
    const result = await callMcp('tools/call', { name: tool.name, arguments: args })
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('[QuickTiny MCP] tools/call returned an invalid result')
    }
    if ((result as { isError?: unknown }).isError === true) {
      throw new Error('[QuickTiny MCP] tools/call returned isError=true')
    }
    return result as QuickTinyMcpToolCallResult
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error))
    updateHealth({
      state: 'unavailable',
      lastProbeAt: new Date().toISOString(),
      lastError: message,
    })
    throw new Error(message, { cause: error })
  }
}

/**
 * Backward-compatible configured call. The optional override is used by the
 * real adapter because the date is a runtime argument, not a static env value.
 */
export async function callConfiguredQuickTinyLadderTool(
  argumentsOverride?: Record<string, unknown>,
): Promise<QuickTinyMcpToolCallResult> {
  const toolName = configuredLadderToolName()
  if (!toolName) throw new Error('[QuickTiny MCP] QUICKTINY_LADDER_TOOL_NAME is not configured')
  return callQuickTinyMcpTool(toolName, argumentsOverride ?? configuredLadderToolArguments())
}

export async function probeQuickTinyMcp(): Promise<QuickTinyMcpHealth> {
  if (!apiKey()) {
    updateHealth({
      state: 'unavailable',
      lastProbeAt: new Date().toISOString(),
      lastError: 'QuickTiny MCP API key is not configured',
      toolsCount: null,
      ladderToolNames: [],
    })
    return getQuickTinyMcpHealth()
  }

  await discoverQuickTinyMcpTools()
  return getQuickTinyMcpHealth()
}

export function getQuickTinyMcpHealth(): QuickTinyMcpHealth {
  return {
    ...health,
    endpoint: endpoint(),
    configured: Boolean(apiKey()),
    ladderToolNames: [...health.ladderToolNames],
  }
}

export function resetQuickTinyMcpForTests(): void {
  requestId = 0
  health = createInitialHealth()
}
