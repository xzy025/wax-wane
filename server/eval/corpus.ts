// Golden eval set for retrieval — a small, fixed trade-review corpus plus
// labelled queries (query → ids that *should* be retrieved). This is the
// offline benchmark the runner scores lexical / dense / hybrid against.
//
// It also ships a lightweight concept embedder. The app's production embedder is
// either a real embeddings API or the char-ngram fallback (rag/embedding.ts) —
// both lexical-ish offline. To demonstrate *why* hybrid beats either retriever
// alone, we need a dense signal that captures meaning the surface tokens miss
// (e.g. "新能源汽车" ↔ "比亚迪"). conceptEmbed maps text into a small concept
// space via a synonym lexicon. In production you'd inject the real model; the
// metrics/comparison methodology is identical either way.

import type { EvalDoc, EmbedFn } from './retrievers'

export interface EvalQuery {
  id: string
  query: string
  /** Ids that are relevant (ground truth). */
  relevantIds: string[]
  /** Which retriever this case is designed to stress (for readout only). */
  note?: string
}

export const EVAL_DOCS: EvalDoc[] = [
  { id: 'd1', text: '交易组 贵州茅台 600519 白酒 策略追高买入 高位被套 大幅亏损' },
  { id: 'd2', text: '复盘笔记 茅台 教训 不要追高 情绪上头 FOMO 接盘' },
  { id: 'd3', text: '交易组 宁德时代 300750 动力电池龙头 严格止损 遵守纪律 小幅回撤离场' },
  { id: 'd4', text: '交易组 五粮液 000858 白酒 高位接盘 套牢' },
  { id: 'd5', text: '交易组 比亚迪 网格交易 分批获利 波段操作' },
  { id: 'd6', text: '交易组 隆基绿能 光伏 左侧抄底 补仓' },
  { id: 'd7', text: '交易组 某科技股 Wyckoff 派发期 出货 顶部结构' },
  { id: 'd8', text: '复盘 道氏理论 趋势二次确认 顺势加仓' },
  { id: 'd9', text: '交易组 中芯国际 688981 半导体 放量突破 买入' },
  { id: 'd10', text: '交易组 北方华创 半导体 回踩加仓 突破新高' },
  { id: 'd11', text: '复盘 R倍数 风险管理 严守止损 控制回撤' },
  { id: 'd12', text: '市场情绪周期 高潮一致 退潮分歧 离场观望' },
]

export const EVAL_QUERIES: EvalQuery[] = [
  { id: 'q1', query: '白酒板块追高失败的交易', relevantIds: ['d1', 'd2', 'd4'], note: 'both' },
  { id: 'q2', query: 'Wyckoff 派发期出货', relevantIds: ['d7'], note: 'both' },
  { id: 'q3', query: '半导体放量突破加仓', relevantIds: ['d9', 'd10'], note: 'both' },
  { id: 'q4', query: '止损纪律与回撤控制', relevantIds: ['d3', 'd11'], note: 'both' },
  // Semantic-only: no surface tokens shared with d5 → lexical misses, dense saves it.
  { id: 'q5', query: '新能源汽车的成功案例', relevantIds: ['d5'], note: 'dense-only' },
  // Lexical-only: a rare exact stock code → BM25 nails it, dense has no concept.
  { id: 'q6', query: '300750 的复盘记录', relevantIds: ['d3'], note: 'lexical-only' },
]

// ── Concept embedder ───────────────────────────────────────

const CONCEPTS: Array<[concept: string, triggers: string[]]> = [
  ['白酒', ['白酒', '茅台', '五粮液', '泸州', '酱酒']],
  ['新能源车', ['比亚迪', '电动车', '新能源', '汽车', '蔚来', '理想']],
  ['半导体', ['半导体', '芯片', '中芯', '北方华创', '晶圆']],
  ['光伏', ['光伏', '隆基', '硅料', '组件']],
  ['追高', ['追高', '高位', '接盘', 'fomo']],
  ['止损纪律', ['止损', '纪律', '回撤', '风控', '离场']],
  ['突破', ['突破', '新高', '放量']],
  ['抄底', ['抄底', '左侧', '补仓']],
  ['情绪周期', ['情绪', '高潮', '退潮', '分歧']],
  ['理论', ['wyckoff', '威科夫', '派发', '吸筹', '道氏', '趋势']],
  ['盈利', ['获利', '止盈', '波段', '盈利']],
]

/** Map text into the concept space by counting trigger-term occurrences. */
export const conceptEmbed: EmbedFn = (text: string): number[] => {
  const t = text.toLowerCase()
  return CONCEPTS.map(([, triggers]) => triggers.reduce((sum, term) => (t.includes(term) ? sum + 1 : sum), 0))
}
