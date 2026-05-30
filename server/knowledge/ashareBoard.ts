// A-Share Board Trading Knowledge Base
// A股连板接力知识库

export const ashareBoard = {
  name: 'A股连板接力',
  description: 'A股特有的涨停板交易策略，基于情绪周期和龙头战法',

  // 情绪周期
  sentimentCycle: {
    icePoint: {
      name: '冰点期',
      characteristics: [
        '连板高度降至2-3板',
        '涨停家数<30',
        '市场赚钱效应差',
        '高位股连续跌停',
      ],
      strategy: '空仓等待，观察首板股',
      riskLevel: 'high',
      entryThreshold: '无明确买点',
    },
    recovery: {
      name: '修复期',
      characteristics: [
        '连板高度开始回升',
        '涨停家数恢复到50+',
        '出现换手龙',
        '亏钱效应减弱',
      ],
      strategy: '可以参与首板和2板',
      riskLevel: 'medium',
      entryThreshold: '首板放量，2板确认',
    },
    climax: {
      name: '高潮期',
      characteristics: [
        '连板高度>5板',
        '涨停家数>100',
        '多只股票连续涨停',
        '市场情绪亢奋',
      ],
      strategy: '参与龙头，但要控制仓位',
      riskLevel: 'medium',
      entryThreshold: '龙头股3板以上',
    },
    retreat: {
      name: '退潮期',
      characteristics: [
        '连板高度见顶回落',
        '高位股开始分歧',
        '补涨股出现',
        '赚钱效应减弱',
      ],
      strategy: '减仓，参与补涨',
      riskLevel: 'high',
      entryThreshold: '补涨股首板',
    },
  },

  // 龙头股类型
  leaderTypes: {
    spaceLeader: {
      name: '空间龙头',
      description: '连板高度最高的股票',
      characteristics: [
        '连续涨停板数最多',
        '市场关注度最高',
        '带动板块情绪',
      ],
      strategy: '在3板以上参与，但需要市场情绪配合',
      risk: '高位接力风险大',
    },
    sentimentLeader: {
      name: '情绪龙头',
      description: '带动板块情绪的股票',
      characteristics: [
        '涨停后带动板块其他股票',
        '成交量放大',
        '市场号召力强',
      ],
      strategy: '在首板或2板参与',
      risk: '需要板块配合',
    },
    catchUpLeader: {
      name: '补涨龙头',
      description: '龙头见顶后补涨的股票',
      characteristics: [
        '龙头股见顶后启动',
        '通常在3-5板',
        '市场情绪仍在',
      ],
      strategy: '在龙头见顶后参与',
      risk: '补涨空间有限',
    },
  },

  // 连板接力策略
  boardStrategies: {
    firstBoard: {
      name: '首板策略',
      conditions: [
        '需要板块配合',
        '成交量放大',
        '题材有持续性',
      ],
      entry: '涨停板打开后回封',
      stopLoss: '跌破涨停价',
      target: '2板以上',
    },
    secondBoard: {
      name: '2板策略',
      conditions: [
        '首板确认强势',
        '板块有持续性',
        '市场情绪修复',
      ],
      entry: '2板打开后回封',
      stopLoss: '跌破2板涨停价',
      target: '3板以上',
    },
    thirdBoard: {
      name: '3板策略',
      conditions: [
        '成为龙头候选',
        '市场情绪高潮',
        '板块有持续性',
      ],
      entry: '3板打开后回封',
      stopLoss: '跌破3板涨停价',
      target: '4板以上',
    },
    highBoard: {
      name: '4板+策略',
      conditions: [
        '市场情绪配合',
        '成为空间龙头',
        '题材有持续性',
      ],
      entry: '需要更高确定性',
      stopLoss: '严格止损',
      target: '根据市场情绪判断',
    },
  },

  // 情绪指标
  sentimentIndicators: [
    {
      name: '连板高度',
      description: '市场最高连板数',
      icePoint: '2-3板',
      recovery: '3-4板',
      climax: '5板以上',
      retreat: '见顶回落',
    },
    {
      name: '涨停家数',
      description: '当日涨停股票数量',
      icePoint: '<30',
      recovery: '30-60',
      climax: '>100',
      retreat: '见顶回落',
    },
    {
      name: '晋级率',
      description: '昨日涨停今日继续涨停的比例',
      icePoint: '<20%',
      recovery: '20-40%',
      climax: '>50%',
      retreat: '见顶回落',
    },
    {
      name: '涨跌比',
      description: '上涨家数/下跌家数',
      icePoint: '<0.5',
      recovery: '0.5-1',
      climax: '>2',
      retreat: '见顶回落',
    },
  ],
}

// 分析函数
export function analyzeSentimentPhase(data: {
  limitUpCount: number
  limitDownCount: number
  maxBoardHeight: number
  promotionRate: number
  advance: number
  decline: number
}): {
  phase: string
  confidence: number
  analysis: string
  strategies: string[]
} {
  const { limitUpCount, limitDownCount, maxBoardHeight, promotionRate, advance, decline } = data

  let phase = 'unknown'
  let confidence = 0
  const strategies: string[] = []

  // 判断情绪阶段
  if (maxBoardHeight <= 3 && limitUpCount < 30) {
    phase = 'icePoint'
    confidence = 0.8
    strategies.push('空仓等待，观察首板股')
  } else if (maxBoardHeight >= 3 && maxBoardHeight <= 4 && limitUpCount >= 30 && limitUpCount <= 60) {
    phase = 'recovery'
    confidence = 0.7
    strategies.push('可以参与首板和2板')
  } else if (maxBoardHeight >= 5 && limitUpCount > 100) {
    phase = 'climax'
    confidence = 0.8
    strategies.push('参与龙头，但要控制仓位')
  } else if (maxBoardHeight > 4 && promotionRate < 30) {
    phase = 'retreat'
    confidence = 0.7
    strategies.push('减仓，参与补涨')
  }

  const phaseNames: Record<string, string> = {
    icePoint: '冰点期',
    recovery: '修复期',
    climax: '高潮期',
    retreat: '退潮期',
    unknown: '未知',
  }

  const analysis = [
    `情绪处于${phaseNames[phase]}`,
    `连板高度${maxBoardHeight}板`,
    `涨停${limitUpCount}家`,
    `晋级率${promotionRate}%`,
    `涨跌比${(advance / Math.max(decline, 1)).toFixed(2)}`,
  ].join('，')

  return {
    phase,
    confidence,
    analysis,
    strategies,
  }
}
