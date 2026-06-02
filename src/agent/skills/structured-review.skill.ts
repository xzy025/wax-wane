import type { Skill, SkillContext } from './skill.types'

/**
 * 结构化复盘 Skill
 *
 * 触发词: 复盘, review, 一键复盘, 每日复盘
 * 流程: 宏观面 → 消息面 → 大盘走势 → 板块热点 → 交易复盘
 * 输出: 结构化复盘报告
 */
export const structuredReviewSkill: Skill = {
  id: 'structured-review',
  name: '结构化复盘',
  description: '一键生成每日复盘报告，覆盖宏观面、消息面、大盘走势、板块热点、交易复盘五个维度',
  trigger: {
    keywords: ['复盘', 'review', '一键复盘', '每日复盘', '市场复盘'],
    minMatches: 1,
  },
  requiredTools: [
    'getMacroIndicators',
    'getNewsSummary',
    'getMarketBreadth',
    'getIndexTrends',
    'getLimitPool',
    'queryTradeHistory',
    'calculateMetrics',
  ],
  outputFormat: 'report',
  steps: [
    {
      id: 'macro',
      name: '宏观面分析',
      tool: 'getMacroIndicators',
      args: {},
      postProcess: (result) => {
        if (typeof result !== 'object' || !result) return String(result)
        const r = result as Record<string, unknown>
        const lines = [
          `美债10Y: ${r.usTreasury10y ?? 'N/A'}`,
          `黄金: ${r.gold ?? 'N/A'}`,
          `美元指数: ${r.usdIndex ?? 'N/A'}`,
          `汇率: ${r.usdcny ?? 'N/A'}`,
          `原油: ${r.crudeOil ?? 'N/A'}`,
          `VIX: ${r.vix ?? 'N/A'}`,
        ]
        return lines.join('\n')
      },
    },
    {
      id: 'news',
      name: '消息面分析',
      tool: 'getNewsSummary',
      args: {},
      postProcess: (result) => {
        if (!Array.isArray(result)) return String(result)
        const headlines = result
          .slice(0, 10)
          .map((r: Record<string, unknown>, i: number) => `${i + 1}. ${r.title}`)
          .join('\n')
        return `今日要闻:\n${headlines}`
      },
    },
    {
      id: 'market',
      name: '大盘走势分析',
      tool: 'getMarketBreadth',
      args: {},
      postProcess: (result) => {
        if (typeof result !== 'object' || !result) return String(result)
        const r = result as Record<string, unknown>
        return [
          `涨: ${r.advance}家 / 跌: ${r.decline}家`,
          `涨停: ${r.limitUpCount}家 / 跌停: ${r.limitDownCount}家`,
          `晋级率: ${r.promotionRate}%`,
        ].join('\n')
      },
    },
    {
      id: 'index',
      name: '指数分时走势',
      tool: 'getIndexTrends',
      args: { code: '000001' },
      optional: true,
      postProcess: (result) => {
        // Index trends data is typically chart data, summarize briefly
        if (typeof result === 'string') return result.substring(0, 300)
        return JSON.stringify(result).substring(0, 300)
      },
    },
    {
      id: 'sector',
      name: '板块热点分析',
      tool: 'getLimitPool',
      args: { direction: 'up' },
      postProcess: (result) => {
        if (typeof result !== 'object' || !result) return String(result)
        const r = result as Record<string, unknown>
        const stocks = Array.isArray(r.stocks) ? r.stocks : []
        const top = stocks
          .slice(0, 10)
          .map((s: Record<string, unknown>) => `${s.name}(${s.code})`)
          .join(', ')
        return `涨停 ${r.count} 家: ${top}`
      },
    },
    {
      id: 'trade-review',
      name: '交易复盘分析',
      tool: 'queryTradeHistory',
      args: {},
      postProcess: (result) => {
        if (typeof result !== 'object' || !result) return String(result)
        const r = result as Record<string, unknown>
        const trades = Array.isArray(r.trades) ? r.trades : []
        return `今日交易 ${trades.length} 笔`
      },
    },
  ],
}

/** Build the final report prompt from step results */
export function buildStructuredReviewPrompt(ctx: SkillContext): string {
  const r = ctx.results

  return `请根据以下数据，生成一份结构化复盘报告。

## 宏观面数据
${r['macro'] ?? '未获取'}

## 消息面数据
${r['news'] ?? '未获取'}

## 大盘走势
${r['market'] ?? '未获取'}

## 指数分时
${r['index'] ?? '未获取'}

## 板块热点
${r['sector'] ?? '未获取'}

## 交易数据
${r['trade-review'] ?? '未获取'}

请按以下格式输出报告：

## 📊 每日复盘报告 — [日期]

### 一、宏观面
[宏观指标表格 + 判断]

### 二、消息面
[重要新闻 + 复盘资料要点]

### 三、大盘走势
[走势描述 + 市场情绪]

### 四、板块热点
[涨停板块 + 连板股 + 资金流向]

### 五、交易复盘
[持仓分析 + 改进建议]`
}
