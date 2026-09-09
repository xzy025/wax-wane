import { expect, it } from 'vitest'
import { mayReplaceDatedArchive } from './archiveReplacement'
it('never archives Friday data during Monday settlement', () => {
  expect(mayReplaceDatedArchive({ asof: '2026-09-04' }, null, '2026-09-07', 'tempo')).toBe(false)
})
it('preserves an existing narrative when a new review is weaker', () => {
  const base = { asof: '2026-09-07', marketDataAsOf: '2026-09-07', ashare: { indices: [{}] } }
  expect(mayReplaceDatedArchive(base, { ...base, narrative: { markdown: 'facts' } }, base.asof, 'review')).toBe(false)
})
it('preserves legacy narrative even without the new quality metadata', () => {
  const next = { asof: '2026-09-07', marketDataAsOf: '2026-09-07', ashare: { indices: [{}] } }
  expect(mayReplaceDatedArchive(next, { asof: next.asof, narrative: { markdown: 'facts' } }, next.asof, 'review')).toBe(false)
})
