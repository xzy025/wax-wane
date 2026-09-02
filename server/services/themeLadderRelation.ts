import {
  DEFAULT_THEME_TAXONOMY,
  resolveThemeLabels,
  type ThemeTaxonomy,
} from './themeTaxonomy'

export type ThemeLadderRelation =
  | 'replenishment'
  | 'leader-driven'
  | 'follower'
  | 'isolated'
  | 'unavailable'

export interface ThemeLadderStockInput {
  code: string
  name: string
  consecutiveDays: number
  themes: string[]
  primaryTheme: string
  score: number
  changePct: number
  onePrice: boolean
  themeProvider?: string
  themeAsOf?: string
}

export interface ThemeLadderThemeInput {
  name: string
  grade: 'A' | 'B' | 'C' | 'D'
  count: number
  firstBoardCount: number
  multiBoardCount: number
  maxBoards: number
  continuity: number
  promotionRate: number | null
}

export interface ThemeLadderEvidence {
  relation: ThemeLadderRelation
  score: number | null
  bonus: number
  parentTheme: string
  leader: {
    code: string
    name: string
    consecutiveDays: number
  } | null
  lowerLadderCodes: string[]
  lowerLadderCount: number
  lowerLadderPositiveRate: number | null
  themeGrade: ThemeLadderThemeInput['grade'] | null
  themeBreadth: number | null
  themeContinuity: number | null
  themePromotionRate: number | null
  evidence: string[]
  missingReasons: string[]
  note: string
}

export interface ThemeTaxonomyContext {
  provider?: string
  asof?: string
  taxonomy?: ThemeTaxonomy
}

function stockThemeMappings(
  stock: ThemeLadderStockInput,
  context: ThemeTaxonomyContext = {},
) {
  return resolveThemeLabels(
    [stock.primaryTheme, ...stock.themes],
    context.provider ?? stock.themeProvider ?? 'unknown',
    context.asof ?? stock.themeAsOf ?? '9999-12-31',
    context.taxonomy ?? DEFAULT_THEME_TAXONOMY,
  )
}

function researchTheme(stock: ThemeLadderStockInput, context: ThemeTaxonomyContext): string {
  return stockThemeMappings(stock, context).find((mapping) => mapping.status === 'mapped')?.canonicalName ?? ''
}

function sameResearchTheme(
  a: ThemeLadderStockInput,
  b: ThemeLadderStockInput,
  context: ThemeTaxonomyContext,
): boolean {
  const aIds = new Set(
    stockThemeMappings(a, context)
      .filter((mapping) => mapping.status === 'mapped')
      .flatMap((mapping) => [mapping.themeId, mapping.parentId].filter((id): id is string => id !== null)),
  )
  const bIds = new Set(
    stockThemeMappings(b, context)
      .filter((mapping) => mapping.status === 'mapped')
      .flatMap((mapping) => [mapping.themeId, mapping.parentId].filter((id): id is string => id !== null)),
  )
  return Array.from(aIds).some((id) => bIds.has(id))
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value))
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function leaderFirst(a: ThemeLadderStockInput, b: ThemeLadderStockInput): number {
  return b.consecutiveDays - a.consecutiveDays || b.score - a.score || a.code.localeCompare(b.code)
}

function lowerLadder(rows: ThemeLadderStockInput[], boards: number): ThemeLadderStockInput[] {
  return rows.filter((row) => row.consecutiveDays < boards && row.consecutiveDays >= 1)
}

/**
 * Scores the structural relationship between a candidate and its same-theme
 * ladder. This is a research adjustment, not a return forecast or an
 * execution permission. Shared tags alone never create a positive bonus.
 */
export function scoreThemeLadderRelation(args: {
  stock: ThemeLadderStockInput
  peers: ThemeLadderStockInput[]
  theme?: ThemeLadderThemeInput
  taxonomyContext?: ThemeTaxonomyContext
}): ThemeLadderEvidence {
  const { stock, theme } = args
  const taxonomyContext = args.taxonomyContext ?? {}
  const parentTheme = researchTheme(stock, taxonomyContext) || '未识别题材'
  const sameThemePeers = args.peers.filter(
    (row) => row.code !== stock.code && sameResearchTheme(stock, row, taxonomyContext),
  )
  const higher = sameThemePeers.filter((row) => row.consecutiveDays > stock.consecutiveDays).sort(leaderFirst)
  const lower = lowerLadder(sameThemePeers, stock.consecutiveDays).sort(leaderFirst)
  const lowerPositiveRate = lower.length
    ? round((lower.filter((row) => row.changePct >= 0).length / lower.length) * 100)
    : null
  const themeGrade = theme?.grade ?? null
  const themeBreadth = sameThemePeers.length + 1
  const themeContinuity = theme?.continuity ?? null
  const themePromotionRate = theme?.promotionRate ?? null
  const missingReasons: string[] = []

  const stockMappings = stockThemeMappings(stock, taxonomyContext)
  if (!stock.primaryTheme && stock.themes.length === 0) {
    missingReasons.push('缺少候选题材标签')
  } else {
    missingReasons.push(
      ...stockMappings
        .filter((mapping) => mapping.status !== 'mapped')
        .flatMap((mapping) => mapping.missingReasons),
    )
  }

  if (stock.consecutiveDays <= 4) {
    const leader = higher[0] ?? null
    if (!leader) {
      return {
        relation: missingReasons.length ? 'unavailable' : 'isolated',
        score: missingReasons.length ? null : 50,
        bonus: 0,
        parentTheme,
        leader: null,
        lowerLadderCodes: lower.map((row) => row.code),
        lowerLadderCount: lower.length,
        lowerLadderPositiveRate: lowerPositiveRate,
        themeGrade,
        themeBreadth,
        themeContinuity,
        themePromotionRate,
        evidence: ['候选处于4板以下，但未发现更高板同研究题材龙头'],
        missingReasons,
        note: '未形成上方龙头—下方补涨结构，不加补涨分',
      }
    }

    const gap = leader.consecutiveDays - stock.consecutiveDays
    const bonus = Math.min(
      8,
      4 + (gap >= 2 ? 2 : 0) + (themeGrade === 'A' ? 1 : themeGrade === 'B' ? 0.5 : 0) + (stock.onePrice ? 0 : 1),
    )
    return {
      relation: 'replenishment',
      score: round(clamp(65 + bonus * 3)),
      bonus: round(bonus),
      parentTheme,
      leader: {
        code: leader.code,
        name: leader.name,
        consecutiveDays: leader.consecutiveDays,
      },
      lowerLadderCodes: lower.map((row) => row.code),
      lowerLadderCount: lower.length,
      lowerLadderPositiveRate: lowerPositiveRate,
      themeGrade,
      themeBreadth,
      themeContinuity,
      themePromotionRate,
      evidence: [
        `候选${stock.consecutiveDays}板，上方${leader.consecutiveDays}板${leader.name}同研究题材`,
        `板差${gap}，补涨关系仅作为结构加分，不等同于次日必涨`,
      ],
      missingReasons,
      note: `上方${leader.name}（${leader.consecutiveDays}板）提供补涨锚点，结构加${round(bonus)}分`,
    }
  }

  const leader = higher.length === 0 ? stock : higher[0]
  if (higher.length > 0) {
    return {
      relation: 'follower',
      score: 45,
      bonus: 0,
      parentTheme,
      leader: {
        code: leader.code,
        name: leader.name,
        consecutiveDays: leader.consecutiveDays,
      },
      lowerLadderCodes: lower.map((row) => row.code),
      lowerLadderCount: lower.length,
      lowerLadderPositiveRate: lowerPositiveRate,
      themeGrade,
      themeBreadth,
      themeContinuity,
      themePromotionRate,
      evidence: [`候选${stock.consecutiveDays}板但上方仍有${leader.consecutiveDays}板${leader.name}，不认定为题材龙头`],
      missingReasons,
      note: '高板跟随者不重复领取龙头带动加分',
    }
  }

  const breadthSignal = lower.length >= 1 ? Math.min(3, lower.length) : 0
  const qualitySignal = themeGrade === 'A' ? 2 : themeGrade === 'B' ? 1 : 0
  const continuitySignal = themeContinuity != null && themeContinuity >= 50 ? 1 : 0
  const driven = lower.length >= 1 &&
    (qualitySignal > 0 || (continuitySignal > 0 && themeBreadth >= 2))
  const bonus = driven ? Math.min(8, 3 + breadthSignal + qualitySignal + continuitySignal) : 0
  const score = round(
    clamp(
      45 + breadthSignal * 12 + qualitySignal * 10 + continuitySignal * 8,
    ),
  )
  return {
    relation: missingReasons.length ? 'unavailable' : driven ? 'leader-driven' : 'isolated',
    score: missingReasons.length ? null : score,
    bonus: round(bonus),
    parentTheme,
    leader: {
      code: stock.code,
      name: stock.name,
      consecutiveDays: stock.consecutiveDays,
    },
    lowerLadderCodes: lower.map((row) => row.code),
    lowerLadderCount: lower.length,
    lowerLadderPositiveRate: lowerPositiveRate,
    themeGrade,
    themeBreadth,
    themeContinuity,
    themePromotionRate,
    evidence: driven
      ? [
          `${stock.consecutiveDays}板高标下方有${lower.length}只同研究题材梯队`,
          `题材${themeGrade ?? '未知'}级、连续性${themeContinuity ?? '--'}%，具备板块带动的结构证据`,
        ]
      : ['5板以上高标下方未形成足够的同研究题材梯队或题材质量不足'],
    missingReasons,
    note: driven
      ? `下方${lower.length}只同题材梯队形成带动，结构加${round(bonus)}分`
      : '未确认龙头带动板块，不加带动分',
  }
}
