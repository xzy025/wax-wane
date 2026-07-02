import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DailyReviewCard from './DailyReviewCard'
import type { Translation } from '../types'
import type { DailyReviewData, DailyReviewHookResult } from '../hooks/useDailyReview'
import zh from '../i18n/zh'

const t = zh as Translation

const quote = (code: string, name: string, changePct: number) => ({ code, name, price: 100, changePct })

const mockData: DailyReviewData = {
  asof: '2026-07-02',
  generatedAt: '2026-07-02T08:30:00.000Z',
  overnight: [quote('DJI', '道琼斯', -0.32)],
  asia: [quote('N225', '日经225', -2.47), quote('HSI', '恒生指数', 0.76)],
  news: [
    { title: '央行开展逆回购', summary: '…', source: '财联社', link: 'http://x' },
    { title: '第二条', summary: '', source: '财联社', link: '' },
    { title: '第三条', summary: '', source: '复盘资料', link: '' },
    { title: '第四条', summary: '', source: '复盘资料', link: '' },
  ],
  dragonTiger: [
    { code: '000001', name: '平安银行', changePct: 10.02, netAmt: 2.1e8, reason: '涨停' },
    { code: '600000', name: '浦发银行', changePct: -5.5, netAmt: -1.3e8, reason: '跌幅' },
  ],
  calendar: [
    { date: '2026-07-03', country: '美国', name: '非农就业报告', star: 3, source: 'builtin' },
    { date: '2026-07-09', country: '中国', name: 'CPI/PPI 月度物价数据', star: 3, approx: true, source: 'builtin' },
  ],
  calendarSource: 'builtin',
  ashare: {
    indices: [quote('000001', '上证指数', -2.03)],
    totalTurnover: 3.45e12,
    limitUp: 92,
    limitDown: 6,
    advance: 1000,
    decline: 4000,
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
  narrative: {
    tone: '资金高低切换,指数缩量整理',
    markdown: '**一句话定调**:资金高低切换,指数缩量整理\n\n### 今日主线\n- 主线一',
    generatedAt: '2026-07-02T08:31:00.000Z',
  },
}

const baseResult: DailyReviewHookResult = {
  data: mockData,
  loading: false,
  error: null,
  lastUpdated: new Date('2026-07-02T16:30:00'),
  refresh: vi.fn(),
}

let hookResult: DailyReviewHookResult = { ...baseResult }
vi.mock('../hooks/useDailyReview', () => ({
  useDailyReview: () => hookResult,
}))

describe('DailyReviewCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookResult = { ...baseResult, data: structuredClone(mockData) }
  })

  it('渲染标题与四个数据段(外围/消息面/日历/A股·轮动)', () => {
    render(<DailyReviewCard t={t} />)
    expect(screen.getByText(/每日复盘综述 · 2026-07-02/)).toBeInTheDocument()
    // 外围 chips
    expect(screen.getByText('日经225')).toBeInTheDocument()
    expect(screen.getByText('-2.47%')).toBeInTheDocument()
    // 消息面:新闻链接 + 龙虎榜净买/净卖
    expect(screen.getByRole('link', { name: '央行开展逆回购' })).toHaveAttribute('href', 'http://x')
    expect(screen.getByText('平安银行')).toBeInTheDocument()
    expect(screen.getByText('+2.1亿')).toBeInTheDocument()
    // 日历:事件行 + 来源徽标(规则估算) + 约标记
    expect(screen.getByText('非农就业报告')).toBeInTheDocument()
    expect(screen.getByText('规则估算')).toBeInTheDocument()
    expect(screen.getByText(/约07-09/)).toBeInTheDocument()
    // A股 + 轮动
    expect(screen.getByText('上证指数')).toBeInTheDocument()
    expect(screen.getByText('3.45万亿')).toBeInTheDocument()
    expect(screen.getByText('高强 32')).toBeInTheDocument()
    expect(screen.getByText('光模块')).toBeInTheDocument()
  })

  it('叙事段:定调句常显,正文点「展开综述」才出现,再点收起', async () => {
    render(<DailyReviewCard t={t} />)
    expect(screen.getByText('资金高低切换,指数缩量整理')).toBeInTheDocument()
    expect(screen.queryByText('主线一')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /展开综述/ }))
    expect(screen.getByText('主线一')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /收起/ }))
    expect(screen.queryByText('主线一')).not.toBeInTheDocument()
  })

  it('narrative=null → 显示盘后自动生成提示', () => {
    hookResult.data = { ...structuredClone(mockData), narrative: null }
    render(<DailyReviewCard t={t} />)
    expect(screen.getByText(/叙事综述将在盘后自动生成/)).toBeInTheDocument()
  })

  it('消息面超过 3 条时显示「更多」并可展开', async () => {
    render(<DailyReviewCard t={t} />)
    expect(screen.queryByText('第四条')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /更多\(1\)/ }))
    expect(screen.getByText('第四条')).toBeInTheDocument()
  })

  it('缺段降级:ashare/structure 为 null、外围与消息面为空 → 对应段整体消失,日历仍在', () => {
    hookResult.data = {
      ...structuredClone(mockData),
      overnight: [],
      asia: [],
      news: [],
      dragonTiger: [],
      ashare: null,
      structure: null,
    }
    render(<DailyReviewCard t={t} />)
    expect(screen.queryByText('外围')).not.toBeInTheDocument()
    expect(screen.queryByText('消息面')).not.toBeInTheDocument()
    expect(screen.queryByText('A股 · 板块轮动')).not.toBeInTheDocument()
    expect(screen.getByText('非农就业报告')).toBeInTheDocument()
  })

  it('error 且无数据 → 失败提示;loading 且无数据 → 不渲染', () => {
    hookResult = { ...baseResult, data: null, error: 'boom' }
    const { rerender, container } = render(<DailyReviewCard t={t} />)
    expect(screen.getByText('每日复盘综述获取失败')).toBeInTheDocument()
    hookResult = { ...baseResult, data: null, loading: true }
    rerender(<DailyReviewCard t={t} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('fromCache → 显示缓存徽标', () => {
    hookResult.data = { ...structuredClone(mockData), fromCache: true }
    render(<DailyReviewCard t={t} />)
    expect(screen.getByText('缓存')).toBeInTheDocument()
  })

  it('非 http(s) 的新闻链接不渲染为 <a>(防 javascript: 注入)', () => {
    const d = structuredClone(mockData)
    d.news[0].link = 'javascript:alert(1)' // eslint-disable-line no-script-url
    hookResult.data = d
    render(<DailyReviewCard t={t} />)
    expect(screen.queryByRole('link', { name: '央行开展逆回购' })).not.toBeInTheDocument()
    expect(screen.getByText('央行开展逆回购')).toBeInTheDocument()
  })

  it('totalTurnover=0 哨兵 → 不渲染「0.00万亿」', () => {
    const d = structuredClone(mockData)
    if (d.ashare) d.ashare.totalTurnover = 0
    hookResult.data = d
    render(<DailyReviewCard t={t} />)
    expect(screen.queryByText(/万亿/)).not.toBeInTheDocument()
    expect(screen.getByText('上证指数')).toBeInTheDocument()
  })
})
