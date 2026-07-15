import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IntelView from './IntelView'
import type { Translation } from '../types'
import type { NewsFlashData, NewsFlashHookResult } from '../hooks/useNewsFlash'
import type { ResearchData, ResearchHookResult, ResearchReportEntry } from '../hooks/useResearch'
import zh from '../i18n/zh'

const t = zh as Translation

const flashData: NewsFlashData = {
  asof: '2026-07-07T08:30:00.000Z',
  sources: { eastmoney: true, sina: true },
  items: [
    {
      id: 'em-1',
      time: '2026-07-07T16:28:24+08:00',
      title: '重要会议召开',
      summary: '会议部署下半年经济工作,强调扩大内需。',
      source: 'eastmoney',
      important: true,
      stocks: [{ code: '603132' }],
    },
    {
      id: 'sina-2',
      time: '2026-07-07T16:31:33+08:00',
      title: '波士顿动力机器人亮相世界杯',
      summary: '',
      source: 'sina',
      important: false,
      stocks: [],
      url: 'https://finance.sina.cn/7x24/detail-x.d.html',
    },
  ],
}

const analyzedEntry: ResearchReportEntry = {
  file: { name: 'a.pdf', kind: 'pdf', sizeBytes: 2048, mtimeMs: 1, date: '2026-07-07', fingerprint: 'a.pdf|2048|1' },
  status: 'analyzed',
  analysis: {
    fingerprint: 'a.pdf|2048|1',
    fileName: 'a.pdf',
    date: '2026-07-07',
    stockName: '宁德时代',
    stockCode: '300750',
    industry: '动力电池',
    brokerage: '测试券商',
    rating: '买入',
    targetPrice: '320-350元',
    thesis: ['市占率稳定', '储能放量'],
    catalysts: ['储能大单'],
    risks: ['锂价波动'],
    oneLiner: '动力电池龙头,储能打开第二曲线。',
    analyzedAt: '2026-07-07T09:00:00.000Z',
    truncated: false,
  },
}

const pendingEntry: ResearchReportEntry = {
  file: { name: 'b.md', kind: 'md', sizeBytes: 512, mtimeMs: 2, date: '2026-07-07', fingerprint: 'b.md|512|2' },
  status: 'pending',
  analysis: null,
}

const failedEntry: ResearchReportEntry = {
  file: { name: 'c.pdf', kind: 'pdf', sizeBytes: 99, mtimeMs: 3, date: '2026-07-07', fingerprint: 'c.pdf|99|3' },
  status: 'extract_failed',
  analysis: null,
  error: '正文过短(可能是扫描件,无文本层)',
}

const researchData: ResearchData = {
  date: '2026-07-07',
  llmConfigured: true,
  analyzing: false,
  reports: [analyzedEntry, pendingEntry, failedEntry],
  digest: {
    date: '2026-07-07',
    fingerprintsHash: 'abc',
    reportCount: 1,
    overview: '今日机构聚焦**新能源**。',
    hotIndustries: ['动力电池'],
    keyStocks: [{ name: '宁德时代', code: '300750', reason: '两家覆盖' }],
    consensus: '共识在储能放量。',
    generatedAt: '2026-07-07T09:05:00.000Z',
  },
  generatedAt: '2026-07-07T09:06:00.000Z',
}

let flashResult: NewsFlashHookResult
let researchResult: ResearchHookResult
let datesResult: { dates: string[]; reload: () => void }

vi.mock('../hooks/useNewsFlash', () => ({
  useNewsFlash: () => flashResult,
}))
vi.mock('../hooks/useResearch', () => ({
  useResearch: () => researchResult,
  useResearchDates: () => datesResult,
}))

describe('IntelView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flashResult = {
      data: structuredClone(flashData),
      loading: false,
      error: null,
      lastUpdated: new Date('2026-07-07T16:32:00'),
      refresh: vi.fn(async () => true),
    }
    researchResult = {
      data: structuredClone(researchData),
      loading: false,
      error: null,
      lastUpdated: new Date('2026-07-07T16:32:00'),
      refresh: vi.fn(async () => true),
    }
    datesResult = { dates: ['2026-07-07', '2026-07-04'], reload: vi.fn() }
  })

  it('默认显示快讯 tab:条目/要闻标记/个股 chip/来源标', () => {
    render(<IntelView t={t} />)
    expect(screen.getByText('重要会议召开')).toBeInTheDocument()
    expect(screen.getByText('要闻')).toBeInTheDocument()
    expect(screen.getByText('603132')).toBeInTheDocument()
    expect(screen.getByText('东财')).toBeInTheDocument()
    // 有 url 的条目渲染为外链
    expect(screen.getByRole('link', { name: '波士顿动力机器人亮相世界杯' })).toHaveAttribute(
      'href',
      'https://finance.sina.cn/7x24/detail-x.d.html',
    )
  })

  it('单源失联 → 顶栏失联徽标', () => {
    flashResult.data = { ...structuredClone(flashData), sources: { eastmoney: true, sina: false } }
    render(<IntelView t={t} />)
    expect(screen.getByText(/新浪源失联/)).toBeInTheDocument()
  })

  it('快讯 error 且有旧数据 → 错误条与旧数据同屏', () => {
    flashResult.error = 'boom'
    render(<IntelView t={t} />)
    expect(screen.getByText('快讯获取失败')).toBeInTheDocument()
    expect(screen.getByText('重要会议召开')).toBeInTheDocument()
  })

  it('切到研报 tab:分析卡字段 + 展开核心逻辑 + 待分析/解析失败状态', async () => {
    render(<IntelView t={t} />)
    await userEvent.click(screen.getByRole('button', { name: '每日研报' }))
    // 分析卡(「宁德时代」同时出现在卡名与汇总重点标的 chip → 恰为 2 处)
    expect(screen.getAllByText('宁德时代')).toHaveLength(2)
    expect(screen.getAllByText('300750').length).toBeGreaterThan(0)
    expect(screen.getByText('买入')).toBeInTheDocument()
    expect(screen.getByText('动力电池龙头,储能打开第二曲线。')).toBeInTheDocument()
    // 展开三段
    expect(screen.queryByText('市占率稳定')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /展开/ }))
    expect(screen.getByText('市占率稳定')).toBeInTheDocument()
    expect(screen.getByText('储能大单')).toBeInTheDocument()
    expect(screen.getByText('锂价波动')).toBeInTheDocument()
    // 待分析 / 解析失败
    expect(screen.getByText('b.md')).toBeInTheDocument()
    expect(screen.getByText('待分析')).toBeInTheDocument()
    expect(screen.getByText('c.pdf')).toBeInTheDocument()
    expect(screen.getByText('解析失败')).toBeInTheDocument()
    // 汇总卡
    expect(screen.getByText(/当日研报汇总/)).toBeInTheDocument()
    expect(screen.getByText('新能源')).toBeInTheDocument()
    expect(screen.getByText(/共识在储能放量/)).toBeInTheDocument()
    // 日期 chip(>1 天才显示)
    expect(screen.getByRole('button', { name: '07-04' })).toBeInTheDocument()
  })

  it('LLM 未配置 → 降级提示条,文件列表仍在', async () => {
    researchResult.data = { ...structuredClone(researchData), llmConfigured: false, digest: null }
    render(<IntelView t={t} />)
    await userEvent.click(screen.getByRole('button', { name: '每日研报' }))
    expect(screen.getByText(/LLM 未配置或不可用/)).toBeInTheDocument()
    expect(screen.getByText('b.md')).toBeInTheDocument()
  })

  it('当日无研报 → 空态 + 目录提示', async () => {
    researchResult.data = { ...structuredClone(researchData), reports: [], digest: null }
    render(<IntelView t={t} />)
    await userEvent.click(screen.getByRole('button', { name: '每日研报' }))
    expect(screen.getByText(/当日暂无研报/)).toBeInTheDocument()
  })

  it('飞书同步状态:未配置不渲染,出错显示徽标(title 带详情),成功显示时间', async () => {
    // 默认 fixture 无 feishu 字段 → 不渲染
    const first = render(<IntelView t={t} />)
    await userEvent.click(screen.getByRole('button', { name: '每日研报' }))
    expect(screen.queryByText(/飞书同步/)).not.toBeInTheDocument()
    first.unmount()

    // 出错:徽标 + title 详情
    researchResult.data = {
      ...structuredClone(researchData),
      feishu: { configured: true, syncing: false, lastSyncAt: null, lastError: 'code=99991672 无权限' },
    }
    const second = render(<IntelView t={t} />)
    await userEvent.click(screen.getByRole('button', { name: '每日研报' }))
    expect(screen.getByText('飞书同步出错')).toHaveAttribute('title', 'code=99991672 无权限')
    second.unmount()

    // 成功:同步时间小字(相对 fixture 的 lastUpdated=16:32 → 5 分钟前)
    researchResult.data = {
      ...structuredClone(researchData),
      feishu: {
        configured: true,
        syncing: false,
        lastSyncAt: new Date('2026-07-07T16:27:00').toISOString(),
        lastError: null,
      },
    }
    render(<IntelView t={t} />)
    await userEvent.click(screen.getByRole('button', { name: '每日研报' }))
    expect(screen.getByText(/飞书同步 · 5分钟前/)).toBeInTheDocument()
  })
})
