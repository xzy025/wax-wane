// 每日研报 LLM prompt 拼装 + 结构化输出 shape guard(零 IO 纯函数,全部可测)。
//
// 职责边界:单篇抽取 prompt、当日汇总 prompt、以及 parseJsonFromText 之后的
// 弱校验(guard 失败视同 LLM 失败,调用方转 pending 走限流重试)。
// LLM 调用与落盘在 research.ts。
import type { ReportAnalysis } from './research'

/** 喂给 LLM 的正文上限;研报核心观点集中在前几页,超长部分砍掉防 token 爆炸。 */
export const REPORT_TEXT_MAX = 10_000

export const REPORT_SYSTEM_PROMPT = `你是一位卖方研报结构化抽取助手,面向A股复盘场景。从用户给出的研报文件名与正文中抽取字段,只输出一个 JSON 对象,不要 markdown 围栏、不要任何解释文字。硬性规则:
1. 只依据给定文本,禁止编造;找不到的字段填 null(数组字段填 [])。
2. 字段定义:
   - "stockName": 报告核心标的名称;宏观/策略/行业综述类报告无单一标的时填 null。
   - "stockCode": 标的6位数字代码(如 "600519");文中没有明确代码填 null。
   - "industry": 所属行业/板块,一个短词。
   - "brokerage": 出具研报的券商/机构名(常见于文件名或页眉)。
   - "rating": 投资评级,用报告原词(如 买入/增持/推荐/中性),不要翻译改写。
   - "targetPrice": 目标价,保留原文数字与单位(如 "25-28元");无则 null。
   - "thesis": 核心逻辑,2-4条短句。
   - "catalysts": 催化剂,0-3条短句。
   - "risks": 风险提示,0-3条短句。
   - "oneLiner": 不超过40字的一句话摘要(这篇研报最想说什么)。
3. 所有文字用简体中文,每条短句不超过40字。`

export const DIGEST_SYSTEM_PROMPT = `你是一位A股卖方研究汇总助手。用户给出今日多篇研报的结构化摘要(JSON数组),请横向归纳,只输出一个 JSON 对象,不要 markdown 围栏、不要任何解释文字。硬性规则:
1. 只依据给定数据,禁止编造;不做投资建议,用"关注/留意"而非"买入/看多"。
2. 横向归纳而非逐篇复述:哪些行业被多家覆盖、评级态度分布、观点共识与分歧。
3. 字段定义:
   - "overview": 150-300字 markdown,概括今日机构关注主线与整体态度(可用无序列表)。
   - "hotIndustries": 今日研报聚焦的行业,字符串数组,按覆盖度降序,最多5个。
   - "keyStocks": 值得留意的标的,[{"name","code","reason"}],code 无则 null,reason 不超过30字,最多5个。
   - "consensus": 一句话概括共识与分歧,不超过60字;不明显则 null。`

/** 正文截断(尾部补标记,让 LLM 和前端都知道不完整)。 */
export function truncateForLLM(text: string, max: number = REPORT_TEXT_MAX): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n[正文已截断]`
}

/** 单篇抽取 user prompt。文件名常含券商/标的/日期信号,一并喂给 LLM。 */
export function buildReportPrompt(fileName: string, text: string): string {
  return `文件名:${fileName}\n\n研报正文:\n${truncateForLLM(text)}`
}

/** LLM 返回的单篇字段(ReportAnalysis 去掉服务端补的元数据)。 */
export type LlmReportFields = Pick<
  ReportAnalysis,
  | 'stockName'
  | 'stockCode'
  | 'industry'
  | 'brokerage'
  | 'rating'
  | 'targetPrice'
  | 'thesis'
  | 'catalysts'
  | 'risks'
  | 'oneLiner'
>

export interface ResearchDigestFields {
  overview: string
  hotIndustries: string[]
  keyStocks: { name: string; code: string | null; reason: string }[]
  consensus: string | null
}

const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** 单篇结构化结果弱校验:oneLiner 非空 + 三个数组字段 + 可空字符串字段。 */
export function isReportAnalysis(v: unknown): v is LlmReportFields {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.oneLiner === 'string' &&
    r.oneLiner.trim().length > 0 &&
    isStrArray(r.thesis) &&
    isStrArray(r.catalysts) &&
    isStrArray(r.risks) &&
    isStrOrNull(r.stockName ?? null) &&
    isStrOrNull(r.stockCode ?? null) &&
    isStrOrNull(r.industry ?? null) &&
    isStrOrNull(r.brokerage ?? null) &&
    isStrOrNull(r.rating ?? null) &&
    isStrOrNull(r.targetPrice ?? null)
  )
}

/** 汇总结构化结果弱校验。 */
export function isResearchDigestFields(v: unknown): v is ResearchDigestFields {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (typeof r.overview !== 'string' || r.overview.trim().length === 0) return false
  if (!isStrArray(r.hotIndustries)) return false
  if (!isStrOrNull(r.consensus ?? null)) return false
  if (!Array.isArray(r.keyStocks)) return false
  return r.keyStocks.every((s) => {
    if (typeof s !== 'object' || s === null) return false
    const e = s as Record<string, unknown>
    return typeof e.name === 'string' && isStrOrNull(e.code ?? null) && typeof e.reason === 'string'
  })
}

/** 汇总 user prompt:只带压缩字段(不含全文),防 token 爆炸。 */
export function buildDigestPrompt(analyses: ReportAnalysis[]): string {
  const compact = analyses.map((a) => ({
    fileName: a.fileName,
    stockName: a.stockName,
    stockCode: a.stockCode,
    industry: a.industry,
    brokerage: a.brokerage,
    rating: a.rating,
    targetPrice: a.targetPrice,
    oneLiner: a.oneLiner,
    thesis: a.thesis.slice(0, 2),
  }))
  return `今日共 ${analyses.length} 篇研报,结构化摘要如下:\n${JSON.stringify(compact, null, 1)}\n\n请按格式输出今日研报汇总。`
}
