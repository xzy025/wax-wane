import type { NewsFlashItem } from './newsFlashNormalize'
import { fetchNewsFlashWindow } from './newsFlash'

export type OvernightCatalystCategory =
  | 'corporate-action'
  | 'product-clinical'
  | 'industry-supply'
  | 'macro-liquidity'
  | 'policy'
  | 'commodity'
  | 'geopolitics'

export type CatalystVerification = 'official' | 'multi-source' | 'important-source' | 'single-source'
export type ValidationState = '强化' | '未验证' | '背离'
export type RelationType = '直接产品/业务' | '核心供应链' | '行业龙头' | '同类技术' | '宏观敏感'

export interface AuctionStockLike {
  code: string
  name: string
  industry?: string
  price?: number
  changePct?: number
  amount?: number
  firstBoard?: boolean
  quoteTime?: string
}

export interface RelatedStock {
  code: string
  name: string
  relationType: RelationType
  relationReason: string
  relationScore: number
  marketScore: number
  confidence: number
  validationState: ValidationState
  riskNote: string
  changePct?: number
  auctionAmount?: number
  firstBoard?: boolean
}

export interface NewsCatalyst {
  id: string
  time: string
  title: string
  summary: string
  source: NewsFlashItem['source']
  url?: string
  category: OvernightCatalystCategory
  verification: CatalystVerification
  importanceScore: number
  direction: 'positive' | 'negative' | 'mixed' | 'neutral'
  impactPath: string
  themes: string[]
  relatedStocks: RelatedStock[]
  warnings: string[]
}

export interface OvernightContext {
  windowStart: string
  windowEnd: string
  asof: string
  sourceCoverage: {
    fetched: string[]
    succeeded: string[]
    itemCount: number
    windowItemCount: number
    coveragePct: number
    warnings: string[]
  }
  newsCatalysts: NewsCatalyst[]
  expectedDirections: string[]
  auctionConfirmedDirections: string[]
  openConfirmedDirections: string[]
  warnings: string[]
}

const STATIC_MAPPINGS: Array<{
  terms: RegExp
  category: OvernightCatalystCategory
  themes: string[]
  direction: NewsCatalyst['direction']
  impactPath: string
  candidates: Array<Omit<RelatedStock, 'marketScore' | 'confidence' | 'validationState'>>
}> = [
  {
    terms: /mRNA|癌症疫苗|肿瘤疫苗|个性化疫苗|默沙东|Moderna|Keytruda/i,
    category: 'product-clinical',
    themes: ['mRNA', '癌症疫苗', '创新药'],
    direction: 'positive',
    impactPath: '临床成功→创新药估值与肿瘤免疫研发预期提升→竞价验证医药主线',
    candidates: [
      { code: '300142', name: '沃森生物', relationType: '直接产品/业务', relationReason: '布局mRNA疫苗及创新疫苗平台，产品技术路线最接近', relationScore: 70, riskNote: '具体项目进度和收入贡献需以公告为准' },
      { code: '600276', name: '恒瑞医药', relationType: '同类技术', relationReason: '肿瘤创新药龙头，具备临床和商业化平台', relationScore: 50, riskNote: '并非该新闻项目的直接参与方' },
      { code: '300122', name: '智飞生物', relationType: '行业龙头', relationReason: '疫苗研发与商业化龙头，受疫苗风险偏好传导', relationScore: 50, riskNote: '新闻产品与公司现有业务并非一一对应' },
      { code: '688177', name: '百奥泰', relationType: '同类技术', relationReason: '创新生物药和肿瘤治疗平台，属于同类技术映射', relationScore: 45, riskNote: '同类技术不等于供应或合作关系' },
    ],
  },
  {
    terms: /SK\s*海力士|SK\s*Hynix|三星|Samsung|HBM|DRAM|NAND|存储芯片|回购/i,
    category: 'corporate-action',
    themes: ['存储', 'HBM', '半导体'],
    direction: 'positive',
    impactPath: '海外存储龙头资本动作→板块估值/风险偏好改善→观察A股存储链竞价响应',
    candidates: [
      { code: '603986', name: '兆易创新', relationType: '核心供应链', relationReason: 'NOR/NAND及存储控制相关产品，受存储周期与龙头资本开支传导', relationScore: 60, riskNote: '与海外龙头并非必然直接供货关系' },
      { code: '688766', name: '普冉股份', relationType: '核心供应链', relationReason: '存储器芯片设计厂商，直接受存储价格与需求预期影响', relationScore: 60, riskNote: '业绩对存储周期和产品结构较敏感' },
      { code: '688110', name: '东芯股份', relationType: '核心供应链', relationReason: 'DRAM/NAND存储芯片设计，产业链关联明确', relationScore: 60, riskNote: '公司规模与盈利仍受行业周期影响' },
      { code: '000021', name: '深科技', relationType: '核心供应链', relationReason: '存储封装测试及制造服务，处于产业链关键环节', relationScore: 60, riskNote: '封测受订单和代工价格影响' },
      { code: '001309', name: '德明利', relationType: '同类技术', relationReason: '存储模组和主控相关产品，属于存储终端链', relationScore: 45, riskNote: '与SK海力士/三星的直接业务关系需单独核实' },
    ],
  },
  {
    terms: /黄金|白银|贵金属|金价|银价|gold|silver/i,
    category: 'commodity',
    themes: ['黄金', '白银', '贵金属'],
    direction: 'positive',
    impactPath: '金银期货/现货异动→资源品价格传导→优先验证采选冶炼公司',
    candidates: [
      { code: '600988', name: '赤峰黄金', relationType: '直接产品/业务', relationReason: '黄金采选与冶炼收入直接受金价驱动', relationScore: 70, riskNote: '金价回撤和矿山成本是主要风险' },
      { code: '600547', name: '山东黄金', relationType: '行业龙头', relationReason: '国内黄金采选龙头，金价敏感度高', relationScore: 50, riskNote: '大型矿山成本、汇率及产量影响利润' },
      { code: '600489', name: '中金黄金', relationType: '行业龙头', relationReason: '黄金资源与冶炼龙头，直接受贵金属价格影响', relationScore: 50, riskNote: '泛黄金行情不代表个股同步上涨' },
      { code: '000426', name: '兴业银锡', relationType: '直接产品/业务', relationReason: '白银等有色金属资源占比明确，受银价传导', relationScore: 70, riskNote: '多金属组合会稀释单一白银弹性' },
    ],
  },
  {
    terms: /美债回购|财政部回购|回购美债|利率|美元|Treasury|buyback/i,
    category: 'macro-liquidity',
    themes: ['宏观流动性', '利率', '贵金属'],
    direction: 'mixed',
    impactPath: '美债回购→期限利差/美元与全球流动性变化→先列预期方向，待竞价共振后再确认个股',
    candidates: [],
  },
]

function normalizeText(item: NewsFlashItem): string {
  return `${item.title} ${item.summary}`
}

export function classifyOvernightCatalyst(item: NewsFlashItem): Omit<NewsCatalyst, 'relatedStocks'> {
  const text = normalizeText(item)
  const mapping = /美债回购|财政部回购|回购美债|Treasury|buyback/i.test(text)
    ? STATIC_MAPPINGS.find((entry) => entry.category === 'macro-liquidity')
    : STATIC_MAPPINGS.find((entry) => entry.terms.test(text))
  const category = mapping?.category ?? 'industry-supply'
  const verification: CatalystVerification = item.important ? 'important-source' : item.source === 'cls' ? 'multi-source' : 'single-source'
  const score = Math.min(100, 45 + (item.important ? 20 : 0) + (mapping ? 25 : 0) + (item.stocks.length ? 10 : 0))
  return {
    id: item.id,
    time: item.time,
    title: item.title,
    summary: item.summary,
    source: item.source,
    url: item.url,
    category,
    verification,
    importanceScore: score,
    direction: mapping?.direction ?? 'neutral',
    impactPath: mapping?.impactPath ?? '产业链新闻待竞价验证，未建立强关联映射',
    themes: mapping?.themes ?? [],
    warnings: mapping ? [] : ['缺少已验证的产业映射，暂不扩展个股名单'],
  }
}

function mappingFor(catalyst: Pick<NewsCatalyst, 'title' | 'summary'>) {
  const text = `${catalyst.title} ${catalyst.summary}`
  if (/美债回购|财政部回购|回购美债|Treasury|buyback/i.test(text)) {
    return STATIC_MAPPINGS.find((entry) => entry.category === 'macro-liquidity')
  }
  return STATIC_MAPPINGS.find((entry) => entry.terms.test(text))
}

function marketScore(stock: AuctionStockLike | undefined, rankedAmount: number, relatedFirstBoards: number): number {
  if (!stock) return 0
  const gap = stock.changePct ?? 0
  const gapScore = gap >= 9.5 ? 10 : gap >= 3 ? 8 : gap > 0 ? 5 : 0
  const amountScore = rankedAmount <= 5 ? 10 : rankedAmount <= 15 ? 7 : rankedAmount <= 30 ? 4 : 0
  const breadthScore = relatedFirstBoards >= 3 ? 10 : relatedFirstBoards > 0 ? 5 : 0
  return gapScore + amountScore + breadthScore
}

export function buildRelatedStocks(
  catalyst: Pick<NewsCatalyst, 'title' | 'summary'>,
  stocks: AuctionStockLike[],
  options: { relatedFirstBoards?: number } = {},
): RelatedStock[] {
  const mapping = mappingFor(catalyst)
  if (!mapping) return []
  const byCode = new Map(stocks.map((stock) => [stock.code, stock]))
  const ranked = [...stocks].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
  return mapping.candidates
    .map((candidate) => {
      const quote = byCode.get(candidate.code)
      const rank = Math.max(1, ranked.findIndex((stock) => stock.code === candidate.code) + 1)
      const score = marketScore(quote, rank, options.relatedFirstBoards ?? 0)
      const validationState: ValidationState = !quote ? '未验证' : score >= 18 ? '强化' : (quote.changePct ?? 0) < 0 ? '背离' : '未验证'
      return {
        ...candidate,
        marketScore: score,
        confidence: Math.min(100, candidate.relationScore + score),
        validationState,
        changePct: quote?.changePct,
        auctionAmount: quote?.amount,
        firstBoard: quote?.firstBoard,
      }
    })
    .filter((stock) => stock.relationScore >= 45)
    .sort((a, b) => b.relationScore + b.marketScore - (a.relationScore + a.marketScore))
    .slice(0, 5)
}

export function buildOvernightContextFromItems(
  items: NewsFlashItem[],
  args: { windowStart: string; windowEnd: string; asof?: string; stocks?: AuctionStockLike[]; sourceWarnings?: string[] } ,
): OvernightContext {
  const stockList = args.stocks ?? []
  const categoryCounts = new Map<OvernightCatalystCategory, number>()
  const catalysts = items
    .map((item) => {
      const classified = classifyOvernightCatalyst(item)
      const related = buildRelatedStocks(classified, stockList, {
        relatedFirstBoards: stockList.filter((stock) => stock.firstBoard).length,
      })
      return { ...classified, relatedStocks: related }
    })
    .filter((item) => item.importanceScore >= 60)
    .sort((a, b) => b.importanceScore - a.importanceScore || Date.parse(b.time) - Date.parse(a.time))
    .filter((item) => {
      const count = categoryCounts.get(item.category) ?? 0
      if (count >= 3) return false
      categoryCounts.set(item.category, count + 1)
      return true
    })
    .slice(0, 10)
  const expectedDirections = [...new Set(catalysts.flatMap((item) => item.themes))]
  const warnings = [...(args.sourceWarnings ?? [])]
  if (!items.length) warnings.push('隔夜窗口未获取到有效新闻')
  return {
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    asof: args.asof ?? new Date().toISOString(),
    sourceCoverage: {
      fetched: ['eastmoney', 'cls', 'sina'],
      succeeded: items.length ? ['eastmoney', 'cls', 'sina'] : [],
      itemCount: items.length,
      windowItemCount: items.length,
      coveragePct: items.length ? 100 : 0,
      warnings,
    },
    newsCatalysts: catalysts,
    expectedDirections,
    auctionConfirmedDirections: [],
    openConfirmedDirections: [],
    warnings,
  }
}

export async function fetchOvernightContext(args: {
  windowStart: string
  windowEnd: string
  stocks?: AuctionStockLike[]
}): Promise<OvernightContext> {
  const data = await fetchNewsFlashWindow(args.windowStart, args.windowEnd)
  const context = buildOvernightContextFromItems(data.items, {
    ...args,
    asof: data.asof,
    stocks: args.stocks,
    sourceWarnings: data.sourceCoverage.warnings,
  })
  context.sourceCoverage.fetched = data.sourceCoverage.fetched
  context.sourceCoverage.succeeded = data.sourceCoverage.succeeded
  context.sourceCoverage.coveragePct = data.sourceCoverage.fetched.length
    ? Math.round((data.sourceCoverage.succeeded.length / data.sourceCoverage.fetched.length) * 100)
    : 0
  return context
}
