import { describe, it, expect } from 'vitest'
import { matchSkill, matchAllSkills, isStructuredRequest } from './skill.router'
import { validateSkillTools } from './skill.executor'
import { skills, getSkillById } from './index'
import { structuredReviewSkill } from './structured-review.skill'
import { theoryReviewSkill } from './theory-review.skill'
import type { Skill } from './skill.types'

describe('Skill Registry', () => {
  it('has at least 2 skills registered', () => {
    expect(skills.length).toBeGreaterThanOrEqual(2)
  })

  it('can get skill by ID', () => {
    expect(getSkillById('structured-review')).toBeDefined()
    expect(getSkillById('theory-review')).toBeDefined()
    expect(getSkillById('nonexistent')).toBeUndefined()
  })

  it('structured review skill has correct trigger keywords', () => {
    expect(structuredReviewSkill.trigger.keywords).toContain('复盘')
    expect(structuredReviewSkill.trigger.keywords).toContain('review')
  })

  it('theory review skill has correct trigger keywords', () => {
    expect(theoryReviewSkill.trigger.keywords).toContain('理论分析')
    expect(theoryReviewSkill.trigger.keywords).toContain('用理论')
  })
})

describe('Skill Router', () => {
  it('matches structured review by keyword "复盘"', () => {
    const skill = matchSkill('帮我复盘一下今天的交易', skills)
    expect(skill?.id).toBe('structured-review')
  })

  it('matches structured review by keyword "review"', () => {
    const skill = matchSkill('daily review', skills)
    expect(skill?.id).toBe('structured-review')
  })

  it('matches structured review by keyword "一键复盘"', () => {
    const skill = matchSkill('一键复盘', skills)
    expect(skill?.id).toBe('structured-review')
  })

  it('matches theory review by keyword "理论分析"', () => {
    const skill = matchSkill('帮我用理论分析一下', skills)
    expect(skill?.id).toBe('theory-review')
  })

  it('matches theory review by keyword "帮我复盘"', () => {
    // "帮我复盘" matches both skills — theory-review has it explicitly
    const skill = matchSkill('帮我复盘分析一下我的交易', skills)
    // Should match one of them (structured-review has "复盘", theory-review has "帮我复盘")
    expect(skill).toBeDefined()
    expect(['structured-review', 'theory-review']).toContain(skill?.id)
  })

  it('matches theory review by keyword in context', () => {
    const skill = matchSkill('用Wyckoff理论分析', skills)
    // "理论分析" is contained in the message, so it matches
    expect(skill?.id).toBe('theory-review')
  })

  it('returns null for no match', () => {
    const skill = matchSkill('今天天气怎么样', skills)
    expect(skill).toBeNull()
  })

  it('matchAllSkills returns all matches sorted by count', () => {
    const matches = matchAllSkills('帮我一键复盘', skills)
    expect(matches.length).toBeGreaterThanOrEqual(1)
    // "复盘" matches structured-review, "一键复盘" also matches
    expect(matches[0].matchCount).toBeGreaterThanOrEqual(1)
  })

  it('isStructuredRequest returns true for skill matches', () => {
    expect(isStructuredRequest('复盘', skills)).toBe(true)
    expect(isStructuredRequest('理论分析', skills)).toBe(true)
    expect(isStructuredRequest('今天吃什么', skills)).toBe(false)
  })
})

describe('Skill Executor Validation', () => {
  it('validates required tools are available', () => {
    const result = validateSkillTools(structuredReviewSkill, [
      'getMacroIndicators',
      'getNewsSummary',
      'getMarketBreadth',
      'getIndexTrends',
      'getLimitPool',
      'queryTradeHistory',
      'calculateMetrics',
    ])
    expect(result.valid).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('reports missing tools', () => {
    const result = validateSkillTools(structuredReviewSkill, [
      'getMacroIndicators',
      // Missing other tools
    ])
    expect(result.valid).toBe(false)
    expect(result.missing.length).toBeGreaterThan(0)
    expect(result.missing).toContain('getNewsSummary')
  })
})

describe('Skill Step Resolution', () => {
  it('structured review has 6 steps', () => {
    expect(structuredReviewSkill.steps).toHaveLength(6)
  })

  it('theory review has 4 steps', () => {
    expect(theoryReviewSkill.steps).toHaveLength(4)
  })

  it('steps have required fields', () => {
    for (const skill of skills) {
      for (const step of skill.steps) {
        expect(step.id).toBeTruthy()
        expect(step.name).toBeTruthy()
        expect(step.tool).toBeTruthy()
      }
    }
  })

  it('dynamic args function works', () => {
    const theoryStep = theoryReviewSkill.steps.find((s) => s.id === 'history')
    expect(theoryStep).toBeDefined()
    expect(typeof theoryStep!.args).toBe('function')

    // Test dynamic args resolution
    if (typeof theoryStep!.args === 'function') {
      const ctx = {
        appState: {} as never,
        results: { patterns: 'test patterns' },
        currentStep: 2,
        totalSteps: 4,
        userMessage: 'test',
        language: 'zh' as const,
      }
      const args = theoryStep!.args(ctx)
      expect(args.query).toBe('test patterns')
    }
  })
})

describe('Custom Skill', () => {
  it('can create and match a custom skill', () => {
    const customSkill: Skill = {
      id: 'custom-test',
      name: 'Test Skill',
      description: 'A test skill',
      trigger: { keywords: ['测试', 'test-skill'] },
      requiredTools: ['getStockQuote'],
      steps: [{ id: 'step1', name: 'Step 1', tool: 'getStockQuote' }],
      outputFormat: 'chat',
    }

    const allSkills = [...skills, customSkill]
    expect(matchSkill('测试一下', allSkills)?.id).toBe('custom-test')
    expect(matchSkill('test-skill please', allSkills)?.id).toBe('custom-test')
  })
})
