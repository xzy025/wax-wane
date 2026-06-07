export interface TradingPattern {
  id: string
  name: string
  category: 'teacher' | 'theory'
  description: string
  keyElements: string[]
  analysisGuide: string // instructions for the AI when this pattern is selected
}

export const TRADING_PATTERNS: TradingPattern[] = [
  // ===== 云聪交易模式 =====
  {
    id: '2b-buy',
    name: '2B买入模型',
    category: 'teacher',
    description: '支撑位+五浪结构+K线反转，跌破平台后次日快速拉起',
    keyElements: [
      '支撑压力位（前期重要支撑区域）',
      '五浪下跌结构（日线/60分钟/15分钟）',
      'K线组合：小平台跌破后快速拉起',
      '反转速度：必须是第二天反弹',
    ],
    analysisGuide: `## 2B买入模型分析要点
- 检查交易是否在重要支撑位附近买入
- 下跌是否走出五浪结构（可参考日线或60分钟线）
- 是否出现小平台跌破后次日快速拉起的2B信号
- 如果2B失败，是否走成头肩顶结构（此时不应急于止损，可等右肩加仓）
- 是否结合了资金流和板块热点
- 仓位是否分批建仓（第一批2B信号，第二批右肩位置）`,
  },
  {
    id: 'strong-dip',
    name: '强势股低吸',
    category: 'teacher',
    description: '前期强势股回调到50%位置低吸，需大盘配合',
    keyElements: [
      '前期3个以上涨停的强势股',
      '回调到50%斐波那契位',
      '资金流入确认',
      '大盘环境配合（涨停多、跌停少）',
    ],
    analysisGuide: `## 强势股低吸分析要点
- 个股前期是否有3个以上涨停（强势股特征）
- 是否回调到50%关键位置买入
- 是否有资金流入确认（量比、主力资金）
- 大盘环境是否配合（行情好时大胆做，行情不好时不做）
- 是否结合板块热点和主线
- 仓位管理：是否分批建仓，是否设置加仓位置`,
  },
  {
    id: 'first-board',
    name: '首板涨停',
    category: 'teacher',
    description: '指数情绪+板块热点+赚钱效应，排队买入首板涨停股',
    keyElements: [
      '指数情绪：涨停股100+只',
      '板块情绪：当下热点板块',
      '赚钱效应：最近涨停股表现好',
      '技术形态：大形态突破/茶杯带柄/突破回抽确认',
    ],
    analysisGuide: `## 首板涨停分析要点
- 买入时指数情绪如何（涨停股数量、涨跌比）
- 是否属于当下热点板块和主线
- 赚钱效应如何（最近涨停股表现、高标股是否连续跌停）
- 选股是否按资金流+板块热点筛选
- 技术形态是否符合（大形态突破、茶杯带柄、突破回抽确认）
- 操作手法：当天排队还是第二天集合竞价
- 大盘不好时是否控制了仓位（轻仓练习，不重仓）`,
  },
  {
    id: 'morning-dip',
    name: '早盘指数低吸',
    category: 'teacher',
    description: '指数跌到关键支撑位，分三批资金低吸沪深300/中证500成分股',
    keyElements: [
      '指数跌到关键支撑区间',
      '资金分成三份分批建仓',
      '按资金流+板块热点选股',
      '双突破模型或13个买点',
    ],
    analysisGuide: `## 早盘指数低吸分析要点
- 指数是否跌到关键支撑区间（斐波那契、前期低点）
- 仓位管理：资金是否分成三份（当前位置、更低位置、缺口位置）
- 选股是否按资金流排行+板块热点优先
- 是否排除了风险品种（石油、黄金、白银等受期货影响的）
- 是否有技术买点（双突破模型、日线/4小时/1小时买点）
- 是否考虑了被锤情况，设置好加仓位置`,
  },

  // ===== 理论框架 =====
  {
    id: 'wyckoff',
    name: 'Wyckoff量价理论',
    category: 'theory',
    description: '通过量价关系判断吸筹/上涨/派发/下跌四阶段',
    keyElements: [
      '四阶段判断：吸筹期→上涨期→派发期→下跌期',
      '供需关系：成交量与价格的配合',
      '关键信号：Spring、SOS、LPS、UTAD',
      '主力行为：通过量价推断庄家意图',
    ],
    analysisGuide: `## Wyckoff量价理论分析要点
- 判断当前市场/个股处于哪个阶段（吸筹/上涨/派发/下跌）
- 分析成交量与价格的配合关系（放量上涨=健康，放量下跌=出货）
- 识别关键信号：Spring（诱空后反弹）、SOS（强势信号）、LPS（最后支撑点）、UTAD（诱多后下跌）
- 交易是否在派发期追高（追高买入→Wyckoff派发期特征）
- 仓位调整是否符合当前阶段（吸筹期布局，派发期减仓）`,
  },
  {
    id: 'dow',
    name: '道氏理论',
    category: 'theory',
    description: '主要/次要/短期趋势判断，支撑阻力与趋势反转',
    keyElements: [
      '三级趋势：主要趋势（数月-数年）、次要趋势（数周-数月）、短期趋势（数天-数周）',
      '趋势确认：高点抬高+低点抬高=上升趋势',
      '支撑阻力位：前期高低点、整数关口',
      '趋势反转信号：跌破前低或突破前高',
    ],
    analysisGuide: `## 道氏理论分析要点
- 判断主要趋势方向（上升/下降/横盘）
- 交易方向是否与主要趋势一致（逆势操作=道氏理论趋势判断错误）
- 是否识别了支撑阻力位并在关键位置操作
- 止损设置是否合理（扛单不止损=违反道氏理论趋势反转信号）
- 次要趋势回调时是否提供了更好的入场机会`,
  },
  {
    id: 'price-action',
    name: 'Al Brooks价格行为',
    category: 'theory',
    description: 'K线形态、趋势线、微通道、入场信号分析',
    keyElements: [
      'K线形态：Pin Bar、Engulfing、Inside Bar、Hammer、Shooting Star',
      '趋势线：上升/下降趋势线、突破与回踩',
      '微通道：连续3根以上同方向K线',
      '入场信号：反转K线+突破确认',
    ],
    analysisGuide: `## Al Brooks价格行为分析要点
- 识别K线形态（Pin Bar、Engulfing、Inside Bar、Hammer、Shooting Star等）
- 趋势线是否被突破，突破后是否回踩确认
- 是否存在微通道（连续3根以上同方向K线，不宜逆势）
- 入场信号是否清晰（信号不清晰时频繁交易=Price Action问题）
- 止盈位置是否合理（过早止盈=未充分利用支撑阻力位）
- 市场结构判断（趋势市vs震荡市的应对策略不同）`,
  },
  {
    id: 'sentiment',
    name: 'A股情绪周期',
    category: 'theory',
    description: '冰点/修复/高潮/退潮四阶段，龙头股与连板晋级率',
    keyElements: [
      '四阶段：冰点期→修复期→高潮期→退潮期',
      '龙头股类型：空间龙、情绪龙、补涨龙',
      '连板晋级率：反映市场情绪强弱',
      '赚钱效应：涨停次日表现、跌停数量',
    ],
    analysisGuide: `## A股情绪周期分析要点
- 判断当前市场情绪阶段（冰点/修复/高潮/退潮）
- 冰点期：适合布局，寻找错杀股
- 修复期：适合试探性买入，关注龙头股
- 高潮期：适合持有和减仓，不宜追高
- 退潮期：适合观望和止损，不参与
- 连板晋级率如何（反映市场情绪强弱）
- 龙头股表现（空间龙打开高度、情绪龙带动板块）
- 赚钱效应（涨停次日溢价、跌停数量）`,
  },
]

/** Build pattern context string for system prompt injection */
export function buildPatternContext(selectedIds: string[]): string {
  const selected = TRADING_PATTERNS.filter((p) => selectedIds.includes(p.id))
  if (selected.length === 0) return ''

  const lines = selected.map(
    (p) => `### ${p.name}（${p.category === 'teacher' ? '云聪交易模式' : '理论框架'}）
${p.analysisGuide}`,
  )

  return `
## 🎯 用户选定的交易模式
用户在分析前选择了以下交易模式，请**重点**使用这些框架进行分析。分析时要明确引用选定模式的关键要素，并检查用户的交易是否符合这些模式的规则。

${lines.join('\n\n')}

### 综合分析要求
- 每个交易都要对照选定模式的关键要素逐一检查
- 指出交易中符合/不符合选定模式的地方
- 给出基于选定模式的具体改进建议
- 如果多个模式有交叉关联，指出它们之间的联系
`
}
