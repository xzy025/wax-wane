// Pure helpers for the fundamental-analysis endpoint: prompt assembly from the
// vendored cn-finance methodology + the (sparse) East Money data, and an SSE
// delta-content accumulator. Kept free of DB/network imports so they can be
// unit-tested in isolation.

import type { StockFundamentals } from '../services/ashare'
import type { CompanyProfile, AnnualFinancials, TopHolders } from '../services/f10'

export interface CnFinanceKnowledge {
  companyProfile: string
  financialStatements: string
  valuationModels: string
}

// Field → display metadata. `zeroMeansMissing` marks numeric fields whose 0 value
// indicates "not fetched" rather than a genuine zero (East Money only reliably
// returns pe/pb/roe/marketCap; growth/margin/share-structure fields come back 0).
interface FieldMeta {
  label: string
  unit?: string
  zeroMeansMissing?: boolean
}

const FIELD_META: Partial<Record<keyof StockFundamentals, FieldMeta>> = {
  pe: { label: '市盈率 PE(TTM)', zeroMeansMissing: true },
  pb: { label: '市净率 PB', zeroMeansMissing: true },
  ps: { label: '市销率 PS', zeroMeansMissing: true },
  roe: { label: '净资产收益率 ROE', unit: '%', zeroMeansMissing: true },
  grossMargin: { label: '毛利率', unit: '%', zeroMeansMissing: true },
  netMargin: { label: '净利率', unit: '%', zeroMeansMissing: true },
  revenueGrowth: { label: '营收增长率', unit: '%', zeroMeansMissing: true },
  profitGrowth: { label: '净利润增长率', unit: '%', zeroMeansMissing: true },
  marketCap: { label: '总市值', unit: '元', zeroMeansMissing: true },
  circulatingMarketCap: { label: '流通市值', unit: '元', zeroMeansMissing: true },
  totalShares: { label: '总股本', unit: '股', zeroMeansMissing: true },
  circulatingShares: { label: '流通股本', unit: '股', zeroMeansMissing: true },
  eps: { label: '每股收益 EPS', unit: '元', zeroMeansMissing: true },
  bvps: { label: '每股净资产 BVPS', unit: '元', zeroMeansMissing: true },
  industry: { label: '所属行业' },
  region: { label: '所属地区' },
  turnoverRate: { label: '换手率', unit: '%', zeroMeansMissing: true },
  volumeRatio: { label: '量比', zeroMeansMissing: true },
  amplitude: { label: '振幅', unit: '%', zeroMeansMissing: true },
  debtRatio: { label: '资产负债率', unit: '%', zeroMeansMissing: true },
}

const UNKNOWN_STRINGS = new Set(['', '未知', 'N/A', 'NaN'])

function isProvided(value: unknown, meta: FieldMeta): boolean {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false
    if (value === 0 && meta.zeroMeansMissing) return false
    return true
  }
  if (typeof value === 'string') return !UNKNOWN_STRINGS.has(value.trim())
  return false
}

/** Split fundamentals into a provided-metrics block and a list of missing labels. */
export function partitionFundamentals(f: StockFundamentals): {
  provided: string[]
  missing: string[]
} {
  const provided: string[] = []
  const missing: string[] = []
  for (const [key, meta] of Object.entries(FIELD_META) as [keyof StockFundamentals, FieldMeta][]) {
    const value = f[key]
    if (isProvided(value, meta)) {
      const unit = meta.unit ? ` ${meta.unit}` : ''
      provided.push(`- ${meta.label}: ${value}${unit}`)
    } else {
      missing.push(meta.label)
    }
  }
  return { provided, missing }
}

function yi(v: number): string {
  return (v / 1e8).toFixed(1)
}

function pct(v: number): string {
  return v.toFixed(2)
}

/** F10 company profile → prompt data block. Empty fields are simply omitted. */
export function renderProfileBlock(profile: CompanyProfile | null | undefined): string {
  if (!profile) return ''
  const lines: [string, string][] = [
    ['公司全称', profile.orgName],
    ['行业（东财三级）', profile.industryEM],
    ['行业（证监会）', profile.industryCSRC],
    ['实际控制人', profile.actualHolder],
    ['董事长', profile.chairman],
    ['员工总数', profile.employees > 0 ? `${profile.employees} 人` : ''],
    ['注册地', profile.regAddress],
    ['所属省份', profile.province],
    ['上市日期', profile.listingDate],
    ['成立日期', profile.foundDate],
    ['主营业务', profile.mainBusiness],
  ]
  const rendered = lines.filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`)
  return rendered.length > 0 ? rendered.join('\n') : ''
}

/** Multi-year annual key financials → markdown table (newest first). */
export function renderHistoryBlock(history: AnnualFinancials[] | null | undefined): string {
  if (!history || history.length === 0) return ''
  const header =
    '| 年份 | 营收(亿) | 营收同比% | 归母净利(亿) | 净利同比% | 扣非净利(亿) | 扣非同比% | ROE加权% | 毛利率% | 净利率% | 资产负债率% | EPS(元) | 研发支出(亿) |'
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|'
  const rows = history.map(
    (r) =>
      `| ${r.year} | ${yi(r.revenue)} | ${pct(r.revenueYoy)} | ${yi(r.netProfit)} | ${pct(r.netProfitYoy)} | ${yi(r.deductedProfit)} | ${pct(r.deductedProfitYoy)} | ${pct(r.roeWeighted)} | ${pct(r.grossMargin)} | ${pct(r.netMargin)} | ${pct(r.debtRatio)} | ${r.eps} | ${yi(r.rdExpense)} |`,
  )
  return [header, sep, ...rows].join('\n')
}

/** Top-10 shareholders → prompt data block. */
export function renderHoldersBlock(holders: TopHolders | null | undefined): string {
  if (!holders || holders.holders.length === 0) return ''
  const lines = holders.holders.map((h) => `${h.rank}. ${h.name}: ${h.ratio}%`)
  lines.push(`已披露股东合计持股: ${holders.totalRatio}%`)
  return lines.join('\n')
}

const COMPLIANCE_BOUNDARY = `## 合规边界（必须遵守）
- 不包含具体标的买卖推荐、买卖时点建议或仓位配置建议。
- 所有结论附带「本分析仅供学习复盘，不构成投资建议」免责声明。
- 对于下方「数据」中未提供或标记为缺失的字段，一律输出「数据待接入」，严禁编造、估算或臆测具体数值。
- 可基于已提供的真实指标做定性判断，但需注明依据。`

/** Assemble the system + user prompt for the one-page fundamental snapshot. */
export function buildFundamentalPrompt(args: {
  fundamentals: StockFundamentals
  knowledge: CnFinanceKnowledge
  profile?: CompanyProfile | null
  history?: AnnualFinancials[]
  holders?: TopHolders | null
}): { system: string; user: string } {
  const { fundamentals, knowledge, profile, history, holders } = args
  const { provided, missing } = partitionFundamentals(fundamentals)

  const system = [
    '你是一名严谨的 A 股基本面分析师。请严格依据下面的方法论生成「一页纸速览」报告。',
    '',
    '# 方法论一：A股公司一页纸速览',
    knowledge.companyProfile,
    '',
    '# 方法论二：财务报表分析',
    knowledge.financialStatements,
    '',
    '# 方法论三：估值模型',
    knowledge.valuationModels,
    '',
    COMPLIANCE_BOUNDARY,
  ].join('\n')

  const providedBlock = provided.length > 0 ? provided.join('\n') : '（无有效指标）'
  const missingBlock = missing.length > 0 ? missing.join('、') : '（无）'

  const profileBlock = renderProfileBlock(profile)
  const historyBlock = renderHistoryBlock(history)
  const holdersBlock = renderHoldersBlock(holders)
  const extraSections: string[] = []
  if (profileBlock) {
    extraSections.push('## 公司资料（数据源：东方财富 F10）', profileBlock, '')
  }
  if (historyBlock) {
    extraSections.push('## 近年年报核心财务（数据源：东方财富 F10）', historyBlock, '')
  }
  if (holdersBlock) {
    extraSections.push(`## 前十大股东（截至 ${holders!.endDate}）`, holdersBlock, '')
  }

  const user = [
    `请为以下 A 股公司生成「一页纸速览」报告，使用 Markdown 输出，遵循「方法论一」的输出格式。`,
    '',
    `## 标的`,
    `- 股票名称: ${fundamentals.name || '未知'}`,
    `- 股票代码: ${fundamentals.code}`,
    '',
    `## 已获取的实时快照指标（数据源：东方财富/新浪，仅供参考）`,
    providedBlock,
    '',
    ...extraSections,
    `## 未获取的字段（必须在报告中标注为「数据待接入」，不得编造）`,
    missingBlock,
    '',
    `要求：`,
    `1. 严格按方法论一的「输出格式」分节输出（公司概况 / 股权结构 / 核心财务 / 估值水平 / 公司治理 / 行业地位 / 风险信号）。`,
    `2. 上方各数据节（快照指标/公司资料/年报财务/十大股东）已提供的内容据实填写；仅「未获取的字段」及数据节未覆盖的内容（如股权质押、减持回购、机构持仓明细）填「数据待接入」。`,
    `3. 已提供的指标可结合方法论给出定性的水位/趋势判断（注明依据）；多年财务可做趋势与杜邦视角分析。`,
    `4. 报告末尾加一行：「数据完整度：快照已获取 ${provided.length} 项 / 待接入 ${missing.length} 项。本分析仅供学习复盘，不构成投资建议。」`,
  ].join('\n')

  return { system, user }
}

/**
 * Stateful accumulator for OpenAI-style SSE chunks. Feed it raw chunk text (even
 * across split line boundaries); it extracts and concatenates every
 * `choices[0].delta.content`. Used to capture the full report while it streams
 * through to the client.
 */
export function makeDeltaAccumulator() {
  let buffer = ''
  let full = ''

  return {
    push(text: string): void {
      buffer += text
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const content = json?.choices?.[0]?.delta?.content
          if (typeof content === 'string') full += content
        } catch {
          // partial/non-JSON line; ignore
        }
      }
    },
    get(): string {
      return full
    },
  }
}
