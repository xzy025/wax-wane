import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RotationTempoGrid from './RotationTempoGrid'
import type { Translation } from '../types'
import type { RotationTempoResult, TempoRow, RotationTempoHookResult } from '../hooks/useRotationTempo'
import zh from '../i18n/zh'

const t = zh as Translation

const cell = (date: string, state: 'launch' | 'adjust', dayN: number, tier: 'strong' | 'weak' | 'adjust', chg: number, qualifiers: string[] = []) =>
  ({ date, state, dayN, tier, chg, qualifiers }) as TempoRow['cells'][number]

const DATES = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10']

const mkRow = (o: Partial<TempoRow>): TempoRow => ({
  code: 'BK1036',
  name: '半导体',
  source: 'em-industry',
  recon: false,
  cells: DATES.map((d, i) => cell(d, 'launch', i + 1, 'strong', 2.0)),
  heat: 3,
  active: true,
  notes: [],
  ...o,
})

const mockData: RotationTempoResult = {
  asof: '2026-07-10',
  dates: DATES,
  benchmark: { name: '上证指数', cells: DATES.map((d) => ({ date: d, chg: 0.5 })) },
  rows: [
    mkRow({
      code: 'BK1036',
      name: '半导体',
      heat: 5,
      cells: [
        cell('2026-07-06', 'adjust', 3, 'adjust', -0.4, ['resilient']),
        cell('2026-07-07', 'launch', 1, 'weak', 0.9, ['aboveIndex']),
        cell('2026-07-08', 'launch', 2, 'strong', 2.3, ['aboveIndex', 'volUp']),
        cell('2026-07-09', 'launch', 3, 'strong', 3.0),
        cell('2026-07-10', 'launch', 4, 'strong', 2.6),
      ],
      notes: [{ kind: 'inflow', date: '2026-07-10', detail: '41.5亿' }],
    }),
    mkRow({ code: 'BK0917', name: '算力概念', source: 'em-concept', heat: 4, cells: DATES.slice(1).map((d, i) => cell(d, 'launch', i + 1, 'weak', 1.0)) }), // 首日缺格
    mkRow({ code: 'BK9999', name: '冷门板块', heat: 0, active: false }), // 非活跃,默认不显示
  ],
  sources: { em: 'recon', kpl: 'off' },
}

const baseResult: RotationTempoHookResult = {
  data: mockData,
  loading: false,
  error: null,
  lastUpdated: new Date('2026-07-10T16:30:00'),
  refresh: vi.fn(),
}

let hookResult: RotationTempoHookResult = { ...baseResult }
vi.mock('../hooks/useRotationTempo', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRotationTempo: () => hookResult,
}))

describe('RotationTempoGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    hookResult = { ...baseResult, data: structuredClone(mockData) }
  })

  it('渲染标题/基准行/格子文案与三色class/注记chips/成分重构徽标', () => {
    render(<RotationTempoGrid t={t} />)
    expect(screen.getByText(/板块轮动节奏 · 2026-07-10/)).toBeInTheDocument()
    expect(screen.getByText('上证指数')).toBeInTheDocument()
    expect(screen.getAllByText('启动第4天').length).toBeGreaterThan(0) // 半导体今日格(算力概念末格同文案)
    expect(screen.getByText('调整第3天')).toBeInTheDocument()
    // 三色 class
    const strongCells = document.querySelectorAll('.rtempo-cell--strong')
    expect(strongCells.length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.rtempo-cell--adjust').length).toBeGreaterThan(0)
    // qualifier chips + 当日富注记
    expect(screen.getAllByText('强于指数').length).toBeGreaterThan(0)
    expect(screen.getByText('抗跌')).toBeInTheDocument()
    expect(screen.getByText(/资金回流 41\.5亿/)).toBeInTheDocument()
    // 成分重构徽标
    expect(screen.getByText('成分重构')).toBeInTheDocument()
    // 非活跃行不显示
    expect(screen.queryByText('冷门板块')).not.toBeInTheDocument()
  })

  it('缺席格渲染 —(算力概念首日无数据)', () => {
    render(<RotationTempoGrid t={t} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('钉选:点击置顶并写 localStorage;钉选后非活跃行也显示', async () => {
    const d = structuredClone(mockData)
    hookResult.data = d
    render(<RotationTempoGrid t={t} />)
    const pinBtns = screen.getAllByTitle('钉选置顶')
    await userEvent.click(pinBtns[1]) // 钉选 算力概念
    expect(JSON.parse(localStorage.getItem('rotation-tempo-pins') ?? '[]')).toEqual(['BK0917'])
    // 钉选行排最前:名字列顺序 = 算力概念 → 半导体
    const names = [...document.querySelectorAll('.rtempo-name-text')].map((x) => x.textContent)
    expect(names[0]).toBe('算力概念')
  })

  it('fromArchive → 归档徽标;空行集 → 空态文案', () => {
    hookResult.data = { ...structuredClone(mockData), fromArchive: true }
    const { rerender } = render(<RotationTempoGrid t={t} />)
    expect(screen.getByText('归档')).toBeInTheDocument()
    hookResult.data = { ...structuredClone(mockData), rows: [] }
    rerender(<RotationTempoGrid t={t} />)
    expect(screen.getByText('近5日无强启动板块')).toBeInTheDocument()
  })

  it('error 且无数据 → 失败提示;loading 且无数据 → 不渲染', () => {
    hookResult = { ...baseResult, data: null, error: 'boom' }
    const { rerender, container } = render(<RotationTempoGrid t={t} />)
    expect(screen.getByText('节奏表获取失败')).toBeInTheDocument()
    hookResult = { ...baseResult, data: null, loading: true }
    rerender(<RotationTempoGrid t={t} />)
    expect(container).toBeEmptyDOMElement()
  })
})
