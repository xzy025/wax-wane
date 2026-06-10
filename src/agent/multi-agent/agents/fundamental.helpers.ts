import { REPORT_STALE_DAYS } from '../../tools/getFundamentalReport'

/**
 * Render the getFundamentalReport tool result as a「深度报告」markdown block
 * appended to the rule-based fundamentals section. Never throws — any
 * error/missing shape degrades to the "generate one" hint.
 */
export function buildDeepReportSection(report: unknown): string {
  const fallback =
    '**深度报告**：暂无存档。可在聊天框勾选「基本面分析」生成深度报告。'

  if (typeof report !== 'object' || !report) return fallback
  const r = report as Record<string, unknown>
  if (r.error || !r.found || typeof r.summary !== 'string') return fallback

  const createdAt = typeof r.createdAt === 'string' ? r.createdAt.slice(0, 10) : '未知日期'
  const ageDays = typeof r.ageDays === 'number' ? `，${r.ageDays} 天前` : ''
  const staleNote =
    r.stale === true ? `（已超过 ${REPORT_STALE_DAYS} 天，可能过时）` : ''

  return [
    `**深度报告**（存档于 ${createdAt}${ageDays}）${staleNote}`,
    `> ${r.summary}`,
    '（完整报告可让我用 getFundamentalReport 展示）',
  ].join('\n')
}
