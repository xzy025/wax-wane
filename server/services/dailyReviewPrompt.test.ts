import { describe, it, expect } from 'vitest'
import { buildReviewFacts, extractTone, fmtTurnover, REVIEW_SYSTEM_PROMPT } from './dailyReviewPrompt'
import type { DailyReviewData } from './dailyReview'

function fullData(): DailyReviewData {
  return {
    asof: '2026-07-02',
    generatedAt: '2026-07-02T08:00:00.000Z',
    overnight: [
      { code: 'DJI', name: '道琼斯', price: 44000, changePct: -0.32 },
      { code: 'IXIC', name: '纳斯达克', price: 20000, changePct: 0.15 },
    ],
    asia: [
      { code: 'N225', name: '日经225', price: 40000, changePct: -1.2 },
      { code: 'KS11', name: '韩国KOSPI', price: 2800, changePct: 0.8 },
      { code: 'HSI', name: '恒生指数', price: 24000, changePct: 0.55 },
    ],
    news: [
      { title: '央行开展逆回购', summary: '公开市场操作'.repeat(30), source: '财联社', link: 'http://x' },
      { title: '今日复盘', summary: '', source: '复盘资料', link: '' },
    ],
    dragonTiger: [
      { code: '000001', name: '平安银行', changePct: 10.02, netAmt: 2.1e8, reason: '涨停' },
      { code: '600000', name: '浦发银行', changePct: -5.5, netAmt: -1.3e8, reason: '跌幅偏离' },
    ],
    calendar: [
      {
        date: '2026-07-03',
        country: '美国',
        name: '非农就业报告',
        star: 3,
        previous: '14.7万',
        consensus: '11万',
        approx: false,
        source: 'builtin',
      },
    ],
    calendarSource: 'builtin',
    ashare: {
      indices: [{ code: '000001', name: '上证指数', price: 3456.78, changePct: 0.4 }],
      totalTurnover: 1.85e12,
      limitUp: 68,
      limitDown: 5,
      advance: 3120,
      decline: 1890,
    },
    structure: {
      hsCount: 32,
      lsCount: 18,
      hwCount: 25,
      lwCount: 45,
      shortUpPct: 42,
      topHs: [{ name: '光模块', shortChg: 8.2, todayChg: 1.1 }],
      topLs: [{ name: '保险', shortChg: 3.2, todayChg: 0.5 }],
    },
    narrative: null,
  }
}

describe('buildReviewFacts — 事实摘要拼装', () => {
  it('完整数据 → 各段齐全且含关键数字', () => {
    const s = buildReviewFacts(fullData())
    expect(s).toContain('日期:2026-07-02')
    expect(s).toContain('【外围】')
    expect(s).toContain('隔夜美股:道琼斯 -0.32%')
    expect(s).toContain('日经225 -1.20%')
    expect(s).toContain('【消息面】')
    expect(s).toContain('[财联社] 央行开展逆回购')
    expect(s).toContain('【龙虎榜】')
    expect(s).toContain('平安银行(+2.1亿/+10.02%)')
    expect(s).toContain('净卖前列:浦发银行(-1.3亿/-5.50%)')
    expect(s).toContain('【未来一周宏观日历】(来源:内置规则)')
    expect(s).toContain('07-03 美国 非农就业报告 ★★★ 前值14.7万 预期11万')
    expect(s).toContain('【A股】上证指数 +0.40% 3456.78')
    expect(s).toContain('两市成交 1.85万亿')
    expect(s).toContain('涨停 68 跌停 5')
    expect(s).toContain('【板块轮动】')
    expect(s).toContain('强势延续 32 / 底部反转 18')
    expect(s).toContain('抱团龙头:光模块(+8.20%)')
  })

  it('缺段降级:ashare=null / news=[] / 外围全空 → 对应段整体缺失且不抛错', () => {
    const d = { ...fullData(), ashare: null, structure: null, news: [], dragonTiger: [], overnight: [], asia: [], calendar: [] }
    const s = buildReviewFacts(d)
    expect(s).not.toContain('【A股】')
    expect(s).not.toContain('【板块轮动】')
    expect(s).not.toContain('【消息面】')
    expect(s).not.toContain('【龙虎榜】')
    expect(s).not.toContain('【外围】')
    expect(s).not.toContain('【未来一周宏观日历】')
    expect(s).toContain('日期:2026-07-02')
  })

  it('新闻摘要截断到 120 字,日历只取前 8 条', () => {
    const d = fullData()
    d.calendar = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-07-0${(i % 7) + 1}`,
      country: '美国',
      name: `事件${i}`,
      star: 3,
      source: 'builtin' as const,
    }))
    const s = buildReviewFacts(d)
    expect(s).toContain('事件7')
    expect(s).not.toContain('事件8')
    const newsLine = s.split('\n').find((l) => l.includes('央行开展逆回购')) ?? ''
    // "- [财联社] title:" 之后摘要不超 120 字
    expect(newsLine).not.toBe('')
    expect(newsLine.split(':')[1].length).toBeLessThanOrEqual(120)
  })

  it('象限全 0(上游限流) → 板块轮动段整体不出现,不喂假事实给 LLM', () => {
    const d = fullData()
    d.structure = { hsCount: 0, lsCount: 0, hwCount: 0, lwCount: 0, shortUpPct: 0, topHs: [], topLs: [] }
    expect(buildReviewFacts(d)).not.toContain('【板块轮动】')
  })

  it('totalTurnover=0 哨兵 → 成交额部分省略,其余 A股 事实保留', () => {
    const d = fullData()
    if (d.ashare) d.ashare.totalTurnover = 0
    const s = buildReviewFacts(d)
    expect(s).toContain('【A股】')
    expect(s).not.toContain('两市成交')
    expect(s).toContain('涨停 68')
  })

  it('约X日事件带(约)标记', () => {
    const d = fullData()
    d.calendar = [{ date: '2026-07-09', country: '中国', name: 'CPI/PPI 月度物价数据', star: 3, approx: true, source: 'builtin' }]
    expect(buildReviewFacts(d)).toContain('CPI/PPI 月度物价数据(约)')
  })
})

describe('fmtTurnover — 成交额格式化', () => {
  it('≥1e12 → X.XX万亿;不足 → 整数亿', () => {
    expect(fmtTurnover(1.85e12)).toBe('1.85万亿')
    expect(fmtTurnover(9.876e11)).toBe('9876亿')
    expect(fmtTurnover(0)).toBe('0亿')
  })
})

describe('extractTone — 定调句提取三级降级', () => {
  it('标准行(半角/全角冒号均可)', () => {
    expect(extractTone('**一句话定调**:资金高低切换,指数缩量整理\n\n### 今日主线')).toBe('资金高低切换,指数缩量整理')
    expect(extractTone('**一句话定调**：高位股兑现')).toBe('高位股兑现')
  })

  it('缺标准行 → 首个非空非标题行(去包裹**)', () => {
    expect(extractTone('### 今日主线\n**市场缩量分化**\n- 第一条')).toBe('市场缩量分化')
  })

  it('空串/纯标题 → 空串', () => {
    expect(extractTone('')).toBe('')
    expect(extractTone('### 今日主线\n## 明日关注')).toBe('')
  })
})

describe('REVIEW_SYSTEM_PROMPT — 关键约束在位', () => {
  it('含禁止编造/不荐股/字数/格式约束', () => {
    expect(REVIEW_SYSTEM_PROMPT).toContain('禁止编造')
    expect(REVIEW_SYSTEM_PROMPT).toContain('不做投资建议')
    expect(REVIEW_SYSTEM_PROMPT).toContain('350 字')
    expect(REVIEW_SYSTEM_PROMPT).toContain('**一句话定调**')
    expect(REVIEW_SYSTEM_PROMPT).toContain('### 今日主线')
    expect(REVIEW_SYSTEM_PROMPT).toContain('### 明日关注')
  })
})
