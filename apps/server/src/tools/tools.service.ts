import { Injectable } from '@nestjs/common'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

// ── Tool Definition Type ──────────────────────────────────

interface ToolPropertyDef {
  type: string
  description: string
  enum?: readonly string[]
}

interface ToolDef {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, ToolPropertyDef>
    required: readonly string[]
  }
}

// ── Tools Service ─────────────────────────────────────────

@Injectable()
export class ToolsService {
  /**
   * Convert a tool definition + executor function to a LangChain DynamicStructuredTool.
   */
  createTool(
    def: ToolDef,
    executor: (args: Record<string, unknown>) => Promise<unknown>,
  ): DynamicStructuredTool {
    // Build zod schema from tool definition
    const schemaObj: Record<string, z.ZodTypeAny> = {}

    for (const [key, prop] of Object.entries(def.parameters.properties)) {
      let field: z.ZodTypeAny

      switch (prop.type) {
        case 'number':
          field = z.number()
          break
        case 'boolean':
          field = z.boolean()
          break
        case 'string':
        default:
          field = z.string()
          break
      }

      if (prop.description) {
        field = field.describe(prop.description)
      }

      if (!def.parameters.required.includes(key)) {
        field = field.optional()
      }

      schemaObj[key] = field
    }

    const schema = z.object(schemaObj)

    return new DynamicStructuredTool({
      name: def.name,
      description: def.description,
      schema,
      func: async (args) => {
        try {
          const result = await executor(args as Record<string, unknown>)
          return typeof result === 'string' ? result : JSON.stringify(result)
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      },
    })
  }

  /**
   * Create multiple tools from an array of definitions.
   */
  createTools(
    defs: Array<{ def: ToolDef; executor: (args: Record<string, unknown>) => Promise<unknown> }>,
  ): DynamicStructuredTool[] {
    return defs.map(({ def, executor }) => this.createTool(def, executor))
  }
}
