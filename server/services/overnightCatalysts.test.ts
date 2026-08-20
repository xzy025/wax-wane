import { describe, expect, it } from 'vitest'
import { buildOvernightContextFromItems, buildRelatedStocks, classifyOvernightCatalyst } from './overnightCatalysts'
import type { NewsFlashItem } from './newsFlashNormalize'

const item = (title: string, important = true): NewsFlashItem => ({
  id: title,
  time: '2026-08-19T20:00:00+08:00',
  title,
  summary: '',
  source: 'cls',
  important,
  stocks: [],
})

describe('overnight catalyst mapping', () => {
  it('maps mRNA news to direct and peer biotech candidates', () => {
    const classified = classifyOvernightCatalyst(item('Moderna个性化mRNA癌症疫苗三期试验成功'))
    const related = buildRelatedStocks(classified, [])
    expect(classified.category).toBe('product-clinical')
    expect(related.length).toBeGreaterThanOrEqual(2)
    expect(related.some((row) => row.relationType === '直接产品/业务')).toBe(true)
  })

  it('does not pad a macro Treasury headline with weak generic stocks', () => {
    const classified = classifyOvernightCatalyst(item('美国财政部扩大美债回购'))
    expect(classified.category).toBe('macro-liquidity')
    expect(buildRelatedStocks(classified, [])).toEqual([])
  })

  it('marks strong auction response while retaining weak relation candidates', () => {
    const classified = classifyOvernightCatalyst(item('黄金白银期货暴涨'))
    const related = buildRelatedStocks(classified, [
      { code: '600988', name: '赤峰黄金', changePct: 9.8, amount: 10_000_000_000 },
      { code: '600547', name: '山东黄金', changePct: -1, amount: 1_000_000 },
    ])
    expect(related[0].validationState).toBe('强化')
    expect(related.some((row) => row.validationState === '背离')).toBe(true)
  })

  it('keeps event directions and source warnings in the context', () => {
    const context = buildOvernightContextFromItems([item('SK海力士回购')], {
      windowStart: '2026-08-19T15:00:00+08:00',
      windowEnd: '2026-08-20T09:15:00+08:00',
      sourceWarnings: ['sina page 2 failed'],
    })
    expect(context.expectedDirections).toContain('存储')
    expect(context.warnings).toContain('sina page 2 failed')
    expect(context.newsCatalysts[0].relatedStocks.length).toBeGreaterThanOrEqual(2)
  })
})

