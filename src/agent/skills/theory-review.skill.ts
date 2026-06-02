import type { Skill, SkillContext } from './skill.types'

/**
 * 理论引导复盘 Skill
 *
 * 触发词: 理论分析, 用理论, Wyckoff, 道氏, 价格行为, 理论引导
 * 流程: 理论框架分析 → 交易模式识别 → 理论引导讨论 → 制定改进计划
 * 输出: 理论引导复盘报告
 */
export const theoryReviewSkill: Skill = {
  id: 'theory-review',
  name: '理论引导复盘',
  description: '基于 Wyckoff/Dow/PriceAction/A股情绪 理论分析交易模式，制定改进计划',
  trigger: {
    keywords: ['理论分析', '用理论', '理论引导', '帮我复盘', '分析我的交易', '我最近做得怎么样'],
    minMatches: 1,
  },
  requiredTools: [
    'analyzeWithTheory',
    'analyzeTradePatterns',
    'semanticSearch',
    'generateImprovementPlan',
    'queryTradeHistory',
  ],
  outputFormat: 'report',
  steps: [
    {
      id: 'theory',
      name: '理论框架分析',
      tool: 'analyzeWithTheory',
      args: { analysisType: 'all' },
      postProcess: (result) => {
        if (typeof result !== 'object' || !result) return String(result)
        const r = result as Record<string, unknown>
        const parts: string[] = []
        if (r.wyckoff) parts.push(`Wyckoff: ${JSON.stringify(r.wyckoff)}`)
        if (r.dow) parts.push(`道氏: ${JSON.stringify(r.dow)}`)
        if (r.priceAction) parts.push(`价格行为: ${JSON.stringify(r.priceAction)}`)
        if (r.sentiment) parts.push(`A股情绪: ${JSON.stringify(r.sentiment)}`)
        return parts.join('\n') || JSON.stringify(result)
      },
    },
    {
      id: 'patterns',
      name: '交易模式识别',
      tool: 'analyzeTradePatterns',
      args: { patternType: 'all' },
      postProcess: (result) => {
        if (typeof result !== 'object' || !result) return String(result)
        const r = result as Record<string, unknown>
        const patterns = Array.isArray(r.patterns) ? r.patterns : []
        return patterns
          .map((p: Record<string, unknown>) => `- ${p.name}: ${p.description} (频率: ${p.frequency})`)
          .join('\n') || JSON.stringify(result)
      },
    },
    {
      id: 'history',
      name: '历史经验检索',
      tool: 'semanticSearch',
      args: (ctx: SkillContext) => ({
        query: ctx.results['patterns'] || '交易模式',
        topK: 5,
      }),
      optional: true,
      postProcess: (result) => {
        if (!Array.isArray(result)) return String(result)
        return result
          .slice(0, 3)
          .map((r: Record<string, unknown>) => `- ${r.content}`)
          .join('\n')
      },
    },
    {
      id: 'plan',
      name: '生成改进计划',
      tool: 'generateImprovementPlan',
      args: (ctx: SkillContext) => ({
        patterns: ctx.results['patterns'] || '',
        theory: ctx.results['theory'] || '',
      }),
      optional: true,
      postProcess: (result) => {
        if (typeof result === 'string') return result
        return JSON.stringify(result)
      },
    },
  ],
}

/** Build the final report prompt from step results */
export function buildTheoryReviewPrompt(ctx: SkillContext): string {
  const r = ctx.results

  return `请根据以下理论分析数据，生成一份理论引导复盘报告。

## 理论框架分析
${r['theory'] ?? '未获取'}

## 交易模式识别
${r['patterns'] ?? '未获取'}

## 历史经验
${r['history'] ?? '无'}

## 改进计划
${r['plan'] ?? '未生成'}

请按以下格式输出报告：

## 📚 理论引导复盘报告 — [日期]

### 一、市场理论分析
**Wyckoff 阶段**：[当前阶段] — [分析]
**道氏趋势**：[趋势方向] — [分析]
**价格行为**：[形态信号] — [分析]
**A股情绪**：[情绪阶段] — [分析]

### 二、交易模式发现
| 模式 | 理论依据 | 严重程度 | 发现 |
|------|----------|----------|------|
| ... | ... | ... | ... |

### 三、历史经验参考
[从历史交易中找到的相似经验和教训]

### 四、改进计划
**重点改善**：[领域]
**理论依据**：[理论框架]
**行动项**：
1. [行动1]
2. [行动2]
3. [行动3]

### 五、理论学习推荐
[针对薄弱环节的理论学习建议]`
}
