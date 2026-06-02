// Memory Extraction — Automatically extract lessons and patterns from trade data
import {
  addTradeLesson,
  addTradePattern,
  addSuccessPattern,
  addKeyDecision,
  type TradePattern,
  type SuccessPattern,
} from './memoryEnhanced'

// ── Lesson Extraction ─────────────────────────────────────

/** Extract lessons from review notes */
export async function extractLessonsFromReview(
  userId: string,
  tradeGroupId: string,
  reviewNote: {
    buy_reason?: string
    sell_reason?: string
    execution_review?: string
    lesson?: string
  },
): Promise<void> {
  if (!reviewNote.lesson) return

  // Categorize the lesson
  const category = categorizeLesson(reviewNote.lesson)

  // Find related theory
  const theory = inferTheory(reviewNote.lesson)

  await addTradeLesson(userId, {
    date: new Date().toISOString().split('T')[0],
    tradeGroupId,
    lesson: reviewNote.lesson,
    category,
    theory,
  })
}

function categorizeLesson(lesson: string): 'entry' | 'exit' | 'position_sizing' | 'timing' | 'risk_management' {
  const lower = lesson.toLowerCase()

  if (lower.includes('买入') || lower.includes('入场') || lower.includes('追高') || lower.includes('抄底')) {
    return 'entry'
  }
  if (lower.includes('卖出') || lower.includes('止盈') || lower.includes('止损') || lower.includes('出场')) {
    return 'exit'
  }
  if (lower.includes('仓位') || lower.includes('加仓') || lower.includes('减仓') || lower.includes('满仓')) {
    return 'position_sizing'
  }
  if (lower.includes('时机') || lower.includes('早了') || lower.includes('晚了') || lower.includes('等待')) {
    return 'timing'
  }
  return 'risk_management'
}

function inferTheory(lesson: string): string {
  const lower = lesson.toLowerCase()

  if (lower.includes('wyckoff') || lower.includes('吸筹') || lower.includes('派发') || lower.includes('量价')) {
    return 'Wyckoff'
  }
  if (lower.includes('道氏') || lower.includes('趋势') || lower.includes('支撑') || lower.includes('阻力')) {
    return '道氏理论'
  }
  if (lower.includes('价格行为') || lower.includes('k线') || lower.includes('形态') || lower.includes('信号')) {
    return '价格行为'
  }
  if (lower.includes('情绪') || lower.includes('龙头') || lower.includes('连板') || lower.includes('涨停')) {
    return 'A股情绪'
  }
  return '综合'
}

// ── Pattern Extraction ────────────────────────────────────

/** Extract patterns from trade groups */
export async function extractPatternsFromTrades(
  userId: string,
  tradeGroups: Array<Record<string, unknown>>,
): Promise<void> {
  // Analyze mistake patterns
  const mistakeGroups = new Map<string, Array<Record<string, unknown>>>()

  for (const group of tradeGroups) {
    const mistakes = parseMistakes(group.mistakes_json as string ?? group.mistakes as string ?? '[]')
    for (const mistake of mistakes) {
      const existing = mistakeGroups.get(mistake) ?? []
      existing.push(group)
      mistakeGroups.set(mistake, existing)
    }
  }

  // Create patterns from mistake groups
  for (const [mistake, groups] of mistakeGroups) {
    if (groups.length < 2) continue // Need at least 2 occurrences

    const pnls = groups.map(g => (g.pnl as number) ?? 0)
    const avgLoss = pnls.filter(p => p < 0).reduce((s, p) => s + p, 0) / Math.max(pnls.filter(p => p < 0).length, 1)

    const pattern: TradePattern = {
      pattern: mistake,
      frequency: groups.length,
      avgLoss: Math.round(avgLoss),
      preventionRule: generatePreventionRule(mistake),
      relatedMistakes: [mistake],
    }

    await addTradePattern(userId, pattern)
  }

  // Analyze success patterns
  const strategyGroups = new Map<string, Array<Record<string, unknown>>>()

  for (const group of tradeGroups) {
    const strategy = group.strategy as string
    if (!strategy) continue
    const pnl = (group.pnl as number) ?? 0
    if (pnl <= 0) continue // Only positive trades

    const existing = strategyGroups.get(strategy) ?? []
    existing.push(group)
    strategyGroups.set(strategy, existing)
  }

  for (const [strategy, groups] of strategyGroups) {
    if (groups.length < 2) continue

    const pnls = groups.map(g => (g.pnl as number) ?? 0)
    const avgGain = pnls.reduce((s, p) => s + p, 0) / pnls.length

    const pattern: SuccessPattern = {
      pattern: strategy,
      frequency: groups.length,
      avgGain: Math.round(avgGain),
      conditions: inferConditions(strategy),
      relatedStrategy: strategy,
    }

    await addSuccessPattern(userId, pattern)
  }
}

function parseMistakes(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed.map(String)
    if (typeof parsed === 'string') return [parsed]
    return []
  } catch {
    return []
  }
}

function generatePreventionRule(mistake: string): string {
  const rules: Record<string, string> = {
    '追高买入': '情绪高涨时克制，等回调再入场',
    '扛单不止损': '入场前设好止损位，严格执行',
    '频繁交易': '减少交易次数，只做高确定性机会',
    '过早止盈': '设好目标价，不到不卖',
    '逆势操作': '先判断趋势方向，顺势而为',
    '满仓操作': '控制单票仓位不超过 30%',
    '听消息买入': '独立分析，不盲从消息',
    '不设止损': '每笔交易必须有止损计划',
  }

  return rules[mistake] ?? '制定明确的交易规则并严格执行'
}

function inferConditions(strategy: string): string[] {
  const conditions: Record<string, string[]> = {
    '首板涨停': ['涨停封板', '成交量放大', '板块联动'],
    '低吸': ['回调到支撑位', '缩量企稳', '趋势向上'],
    '打板': ['连板股', '情绪周期高潮期', '龙头效应'],
    '趋势跟踪': ['均线多头排列', '突破前高', '放量上涨'],
  }

  return conditions[strategy] ?? ['需要进一步分析']
}

// ── Decision Extraction ───────────────────────────────────

/** Extract key decisions from conversation */
export function extractDecisionsFromConversation(
  messages: Array<{ role: string; content: string }>,
): Array<{ decision: string; reasoning: string }> {
  const decisions: Array<{ decision: string; reasoning: string }> = []

  // Look for assistant messages that contain decision-like language
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue

    const content = msg.content

    // Pattern: "建议..." or "我建议..."
    const suggestions = content.match(/(?:建议|我建议|推荐)[：:]\s*(.+?)(?:\n|$)/g)
    if (suggestions) {
      for (const s of suggestions) {
        decisions.push({
          decision: s.replace(/^(?:建议|我建议|推荐)[：:]\s*/, '').trim(),
          reasoning: 'Agent 建议',
        })
      }
    }

    // Pattern: "根据...分析..."
    const analyses = content.match(/根据(.+?)分析[，,]\s*(.+?)(?:\n|。)/g)
    if (analyses) {
      for (const a of analyses) {
        decisions.push({
          decision: a.trim(),
          reasoning: '数据分析',
        })
      }
    }
  }

  return decisions
}
