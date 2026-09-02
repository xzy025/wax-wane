import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { syncDailyJournal } from './dailyJournal'

let roots: string[] = []

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'daily-journal-'))
  roots.push(root)
  writeFileSync(join(root, 'review-2026-08-31.json'), JSON.stringify({
    asof: '2026-08-31',
    ashare: {
      indices: [{ name: '上证', changePct: 1.2 }],
      totalTurnover: 2_000_000_000_000,
      limitUp: 50,
      limitDown: 3,
      advance: 3000,
      decline: 1800,
    },
    structure: { hsCount: 2, lsCount: 3, hwCount: 1, lwCount: 4, shortUpPct: 66.7, topHs: [{ name: '银行' }] },
    narrative: {
      tone: '市场修复，等待确认',
      markdown: '**一句话定调**: 市场修复，等待确认。\n\n### 今日主线\n- 主线整理。\n\n### 明日关注\n- 关注承接。',
    },
  }), 'utf8')
  writeFileSync(join(root, '2026-08-31.json'), JSON.stringify({
    asof: '2026-08-31',
    regime: { phase: 'repair', temperature: 60, marketChgPct: 1, marketTrend: 'strong' },
    universe: 5000,
    breakout: [{ name: '样本', score: 80 }],
  }), 'utf8')
  writeFileSync(join(root, 'structure-2026-08-31.json'), JSON.stringify({ asof: '2026-08-31' }), 'utf8')
  writeFileSync(join(root, 'tempo-2026-08-31.json'), JSON.stringify({ asof: '2026-08-31' }), 'utf8')
  writeFileSync(join(root, 'forward-2026-08-31.json'), JSON.stringify({
    asof: '2026-08-31',
    overall: { n: 1, winRate: 50, expectancyR: 0.2, stopRate: 20 },
    hold: 20,
  }), 'utf8')
  return root
}

describe('daily journal materialization', () => {
  it('skips without narrative and creates an idempotent dated entry', () => {
    const root = fixtureRoot()
    const first = syncDailyJournal('2026-08-31', root)
    expect(first).toMatchObject({ written: true, action: 'created' })
    const initial = readFileSync(join(root, 'daily-journal.md'), 'utf8')
    expect(initial).toContain('## 2026-08-31(周一)')
    expect(initial).toContain('落盘核验:5/5')

    writeFileSync(join(root, 'review-2026-08-31.json'), JSON.stringify({
      asof: '2026-08-31',
      narrative: {
        tone: '更新',
        markdown: '**一句话定调**: 更新。\n\n### 今日主线\n- 新主线。\n\n### 明日关注\n- 新关注。',
      },
    }), 'utf8')
    const second = syncDailyJournal('2026-08-31', root)
    const updated = readFileSync(join(root, 'daily-journal.md'), 'utf8')
    expect(second).toMatchObject({ written: true, action: 'replaced' })
    expect(updated).toContain('**一句话定调**: 更新。')
    const datedEntries = updated.match(/^## 2026-08-31\(/gm) ?? []
    expect(datedEntries.length).toBe(1)
  })

  it('does not invent a journal entry when the LLM narrative is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'daily-journal-empty-'))
    roots.push(root)
    writeFileSync(join(root, 'review-2026-08-31.json'), JSON.stringify({ asof: '2026-08-31', narrative: null }), 'utf8')
    expect(syncDailyJournal('2026-08-31', root)).toMatchObject({
      written: false,
      action: 'skipped',
      reason: 'narrative-unavailable',
    })
    expect(() => readFileSync(join(root, 'daily-journal.md'), 'utf8')).toThrow()
  })
})
