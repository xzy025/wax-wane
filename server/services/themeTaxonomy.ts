import {
  RELAY_DAILY_REVIEW_TAXONOMY_VERSION,
  type RelayReviewCheckpoint,
} from './relayDailyReviewTypes'

export type ThemeTaxonomyMappingStatus = 'mapped' | 'unmapped' | 'ambiguous'

export interface ThemeTaxonomyAlias {
  provider: string
  rawName: string
  effectiveFrom: string
  effectiveTo: string | null
}

export interface ThemeTaxonomyEntry {
  themeId: string
  canonicalName: string
  parentId: string | null
  aliases: ThemeTaxonomyAlias[]
  taxonomyVersion: string
}

export interface ThemeTaxonomy {
  taxonomyVersion: string
  entries: ThemeTaxonomyEntry[]
}

export interface ThemeTaxonomyMapping {
  provider: string
  rawName: string
  normalizedName: string
  themeId: string | null
  canonicalName: string | null
  parentId: string | null
  taxonomyVersion: string
  status: ThemeTaxonomyMappingStatus
  missingReasons: string[]
}

const GENERIC_NAMES = new Set(['其他', '未知', '未识别题材', ''])

function normalizeThemeName(value: string): string {
  return value.trim().replace(/[\s·、，,/|_-]+/g, '').toLowerCase()
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function aliasKey(provider: string, rawName: string): string {
  return `${provider.trim().toLowerCase()}:${normalizeThemeName(rawName)}`
}

export const DEFAULT_THEME_TAXONOMY: ThemeTaxonomy = {
  taxonomyVersion: RELAY_DAILY_REVIEW_TAXONOMY_VERSION,
  entries: [
    {
      themeId: 'theme:medicine',
      canonicalName: '医药',
      parentId: null,
      taxonomyVersion: RELAY_DAILY_REVIEW_TAXONOMY_VERSION,
      aliases: [
        '医药', '创新药', '疫苗', '疫苗概念', '中药', '基因疗法',
      ].map((rawName) => ({ provider: '*', rawName, effectiveFrom: '2000-01-01', effectiveTo: null })),
    },
    {
      themeId: 'theme:communication',
      canonicalName: '通信',
      parentId: null,
      taxonomyVersion: RELAY_DAILY_REVIEW_TAXONOMY_VERSION,
      aliases: [
        '通信', 'CPO', '光通信', '光纤概念',
      ].map((rawName) => ({ provider: '*', rawName, effectiveFrom: '2000-01-01', effectiveTo: null })),
    },
  ],
}

export function validateThemeTaxonomy(taxonomy: ThemeTaxonomy): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  const keys = new Map<string, string>()
  if (!taxonomy.taxonomyVersion.trim()) errors.push('缺少 taxonomyVersion')

  for (const entry of taxonomy.entries) {
    if (ids.has(entry.themeId)) errors.push(`themeId 重复: ${entry.themeId}`)
    ids.add(entry.themeId)
    if (names.has(entry.canonicalName)) errors.push(`canonicalName 重复: ${entry.canonicalName}`)
    names.add(entry.canonicalName)
    if (entry.taxonomyVersion !== taxonomy.taxonomyVersion) {
      errors.push(`entry 版本不一致: ${entry.themeId}`)
    }
    if (entry.parentId === entry.themeId) errors.push(`theme 不能以自身为 parent: ${entry.themeId}`)
    for (const alias of entry.aliases) {
      if (!validDate(alias.effectiveFrom) || (alias.effectiveTo !== null && !validDate(alias.effectiveTo))) {
        errors.push(`alias 日期无效: ${entry.themeId}/${alias.rawName}`)
      }
      const key = aliasKey(alias.provider, alias.rawName)
      const previous = keys.get(key)
      if (previous && previous !== entry.themeId) errors.push(`alias 歧义: ${key}`)
      keys.set(key, entry.themeId)
    }
  }
  for (const entry of taxonomy.entries) {
    if (entry.parentId !== null && !ids.has(entry.parentId)) {
      errors.push(`parentId 不存在: ${entry.themeId}/${entry.parentId}`)
    }
  }
  return errors
}

function isAliasActive(alias: ThemeTaxonomyAlias, asof: string): boolean {
  return alias.effectiveFrom <= asof && (alias.effectiveTo === null || asof <= alias.effectiveTo)
}

export function resolveThemeLabel(
  rawName: string,
  provider = 'unknown',
  asof = '9999-12-31',
  taxonomy: ThemeTaxonomy = DEFAULT_THEME_TAXONOMY,
): ThemeTaxonomyMapping {
  const normalizedName = normalizeThemeName(rawName)
  const base = {
    provider,
    rawName,
    normalizedName,
    taxonomyVersion: taxonomy.taxonomyVersion,
  }
  if (GENERIC_NAMES.has(rawName.trim()) || !normalizedName) {
    return {
      ...base,
      themeId: null,
      canonicalName: null,
      parentId: null,
      status: 'unmapped',
      missingReasons: ['题材标签为空或为通用占位符'],
    }
  }
  const candidates = taxonomy.entries.filter((entry) => entry.aliases.some((alias) =>
    isAliasActive(alias, asof) &&
    normalizeThemeName(alias.rawName) === normalizedName &&
    (alias.provider === '*' || alias.provider.toLowerCase() === provider.toLowerCase()),
  ))
  if (candidates.length !== 1) {
    return {
      ...base,
      themeId: null,
      canonicalName: null,
      parentId: null,
      status: candidates.length > 1 ? 'ambiguous' : 'unmapped',
      missingReasons: [candidates.length > 1 ? `题材标签映射歧义: ${rawName}` : `未知题材标签: ${rawName}`],
    }
  }
  const entry = candidates[0]
  return {
    ...base,
    themeId: entry.themeId,
    canonicalName: entry.canonicalName,
    parentId: entry.parentId,
    status: 'mapped',
    missingReasons: [],
  }
}

export function resolveThemeLabels(
  rawNames: string[],
  provider = 'unknown',
  asof = '9999-12-31',
  taxonomy: ThemeTaxonomy = DEFAULT_THEME_TAXONOMY,
): ThemeTaxonomyMapping[] {
  return rawNames.map((rawName) => resolveThemeLabel(rawName, provider, asof, taxonomy))
}

/**
 * Keeps the original provider label beside the stable id. The checkpoint
 * argument is intentionally accepted by callers that assemble evidence; it
 * prevents them from silently treating a live mapping as historical fact.
 */
export function themeEvidenceRef(
  mapping: ThemeTaxonomyMapping,
  checkpoint: RelayReviewCheckpoint,
): string {
  return `${mapping.taxonomyVersion}:${mapping.provider}:${mapping.rawName}:${checkpoint}`
}
