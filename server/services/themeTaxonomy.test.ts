import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_TAXONOMY,
  resolveThemeLabel,
  resolveThemeLabels,
  validateThemeTaxonomy,
  type ThemeTaxonomy,
} from './themeTaxonomy'

describe('relay theme taxonomy', () => {
  it('maps provider synonyms to one stable theme id while preserving raw labels', () => {
    const mappings = resolveThemeLabels(
      ['CPO', '光通信', '光纤概念'],
      'eastmoney',
      '2026-08-28',
    )

    expect(new Set(mappings.map((mapping) => mapping.themeId)).size).toBe(1)
    expect(mappings.every((mapping) => mapping.status === 'mapped')).toBe(true)
    expect(mappings.map((mapping) => mapping.rawName)).toEqual(['CPO', '光通信', '光纤概念'])
    expect(mappings[0].canonicalName).toBe('通信')
  })

  it('maps medicine aliases across providers without fuzzy matching', () => {
    const eastmoney = resolveThemeLabel('创新药', 'eastmoney', '2026-08-28')
    const kpl = resolveThemeLabel('疫苗', 'kpl', '2026-08-28')
    const canonical = resolveThemeLabel('医药', 'internal', '2026-08-28')

    expect(eastmoney.themeId).toBe(kpl.themeId)
    expect(kpl.themeId).toBe(canonical.themeId)
  })

  it('returns unmapped for empty and unknown labels', () => {
    expect(resolveThemeLabel('', 'eastmoney').status).toBe('unmapped')
    expect(resolveThemeLabel('光通信概念改名', 'eastmoney').status).toBe('unmapped')
    expect(resolveThemeLabel('未知', 'eastmoney').missingReasons).toContain('题材标签为空或为通用占位符')
  })

  it('rejects ambiguous aliases and reports taxonomy version errors', () => {
    const taxonomy: ThemeTaxonomy = {
      taxonomyVersion: 'relay-theme-taxonomy-v2',
      entries: [
        {
          themeId: 'theme:a',
          canonicalName: '甲',
          parentId: null,
          taxonomyVersion: 'relay-theme-taxonomy-v2',
          aliases: [{ provider: 'kpl', rawName: '相同', effectiveFrom: '2026-01-01', effectiveTo: null }],
        },
        {
          themeId: 'theme:b',
          canonicalName: '乙',
          parentId: null,
          taxonomyVersion: 'relay-theme-taxonomy-v1',
          aliases: [{ provider: 'kpl', rawName: '相同', effectiveFrom: '2026-01-01', effectiveTo: null }],
        },
      ],
    }

    expect(validateThemeTaxonomy(taxonomy)).toEqual(expect.arrayContaining([
      'alias 歧义: kpl:相同',
      'entry 版本不一致: theme:b',
    ]))
    expect(resolveThemeLabel('相同', 'kpl', '2026-08-28', taxonomy).status).toBe('ambiguous')
  })

  it('uses effective dates for replay and does not rewrite old mappings', () => {
    const taxonomy: ThemeTaxonomy = {
      taxonomyVersion: 'relay-theme-taxonomy-v3',
      entries: [
        {
          themeId: 'theme:old',
          canonicalName: '旧题材',
          parentId: null,
          taxonomyVersion: 'relay-theme-taxonomy-v3',
          aliases: [{ provider: '*', rawName: '重命名', effectiveFrom: '2020-01-01', effectiveTo: '2025-12-31' }],
        },
        {
          themeId: 'theme:new',
          canonicalName: '新题材',
          parentId: null,
          taxonomyVersion: 'relay-theme-taxonomy-v3',
          aliases: [{ provider: '*', rawName: '重命名', effectiveFrom: '2026-01-01', effectiveTo: null }],
        },
      ],
    }

    expect(resolveThemeLabel('重命名', 'eastmoney', '2025-12-31', taxonomy).themeId).toBe('theme:old')
    expect(resolveThemeLabel('重命名', 'eastmoney', '2026-01-02', taxonomy).themeId).toBe('theme:new')
    expect(validateThemeTaxonomy(DEFAULT_THEME_TAXONOMY)).toEqual([])
  })
})
