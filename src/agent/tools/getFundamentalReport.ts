import type { ToolModule } from '../types'

/** Reports older than this are flagged stale (fundamentals change quarterly). */
export const REPORT_STALE_DAYS = 30

/**
 * Age of a report from its createdAt. Accepts both 'YYYY-MM-DD' (file archive)
 * and full ISO datetime (DB row). Unparseable input → null.
 */
export function computeReportAge(
  createdAt: string,
  now: Date = new Date(),
): { ageDays: number; stale: boolean } | null {
  const parsed = new Date(createdAt)
  if (Number.isNaN(parsed.getTime())) return null
  const ageDays = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86_400_000))
  return { ageDays, stale: ageDays > REPORT_STALE_DAYS }
}

export const getFundamentalReport: ToolModule = {
  schema: {
    name: 'getFundamentalReport',
    description:
      '取回某只股票最近一篇已存档的深度基本面分析报告全文（一页纸速览）。当用户想查看、引用或讨论之前生成的基本面报告时使用。只读取存档，不会触发新报告生成。',
    parameters: {
      type: 'object',
      properties: {
        stockCode: {
          type: 'string',
          description: '6 位股票代码，如 "300750"',
        },
        query: {
          type: 'string',
          description: '股票代码或名称，如 "宁德时代"（stockCode 缺省时使用）',
        },
      },
      required: [],
    },
  },

  async execute(args) {
    const { stockCode, query } = args as { stockCode?: string; query?: string }
    const q = (stockCode ?? query ?? '').trim()
    if (!q) return { error: '需要 stockCode 或 query 参数' }

    const res = await fetch(`/api/analysis/fundamental/latest?query=${encodeURIComponent(q)}`)
    if (!res.ok) {
      const err = await res.text()
      return { error: `获取基本面报告失败: ${err}` }
    }

    const data = (await res.json()) as Record<string, unknown>
    if (!data.found) {
      return {
        ...data,
        hint: '未找到该股票的存档基本面报告。可在聊天框勾选「基本面分析」生成深度报告。',
      }
    }

    const age = typeof data.createdAt === 'string' ? computeReportAge(data.createdAt) : null
    return age ? { ...data, ...age } : data
  },
}
