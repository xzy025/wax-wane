// MCP 候选集解析层回归测试。
// 关键红线：只认 mcp-universe-<date>.json，绝不读取正式归档 YYYY-MM-DD.json ——
// 后者会被 loadLatestArchive()/实盘战绩回填消费，把未评分候选混进去等于伪造历史。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readdirSync = vi.fn<() => string[]>()
const readFileSync = vi.fn<(p: string, enc: string) => string>()

vi.mock('fs', () => ({
  readdirSync: (...args: unknown[]) => readdirSync(...(args as [])),
  readFileSync: (...args: unknown[]) => readFileSync(...(args as [string, string])),
}))

const { listMcpUniverseDates, loadMcpUniverse, fetchMcpUniverse } = await import('./mcpUniverse')

const FIXTURE = {
  schemaVersion: 'mcp-universe-v1',
  provider: 'westock-mcp(腾讯自选股)',
  asof: '2026-09-15',
  generatedAt: '2026-09-15T15:55:10.538Z',
  purpose: 'research',
  statusNote: '影子运行',
  coverageNote: '被 limit 截断',
  strategies: {
    newhigh_year: {
      label: '今日创一年新高',
      mcpStrategy: 'today_newhigh_in_year',
      totalStocks: 19,
      collected: 10,
      truncated: true,
      codes: [
        { code: '605177', name: '东亚药业' },
        { code: '002913', name: '奥士康' },
      ],
    },
    newhigh_hist: {
      label: '今日创历史新高',
      mcpStrategy: 'today_newhigh_in_hist',
      totalStocks: 10,
      collected: 10,
      truncated: false,
      codes: [{ code: '002913', name: '奥士康' }],
    },
  },
  unionSize: 2,
  union: [
    { code: '605177', name: '东亚药业' },
    { code: '002913', name: '奥士康' },
  ],
}

beforeEach(() => {
  readdirSync.mockReset()
  readFileSync.mockReset()
  readdirSync.mockReturnValue([
    'mcp-universe-2026-09-15.json',
    'mcp-universe-2026-09-14.json',
    '2026-09-11.json', // 正式归档，必须被忽略
    'review-2026-09-15.json', // 复盘归档，必须被忽略
  ])
})

describe('listMcpUniverseDates', () => {
  it('只返回 mcp-universe- 前缀的日期，且不误吞正式/复盘归档', () => {
    expect(listMcpUniverseDates()).toEqual(['2026-09-15', '2026-09-14'])
  })

  it('目录不可读时返回空数组而非抛错', () => {
    readdirSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    expect(listMcpUniverseDates()).toEqual([])
  })
})

describe('loadMcpUniverse', () => {
  it('默认读取最新一份', () => {
    readFileSync.mockReturnValue(JSON.stringify(FIXTURE))
    const d = loadMcpUniverse()
    expect(d?.asof).toBe('2026-09-15')
  })

  it('按 hits 聚合跨策略命中，奥士康同时中两个策略', () => {
    readFileSync.mockReturnValue(JSON.stringify(FIXTURE))
    const d = loadMcpUniverse()
    const osk = d?.union.find((s) => s.code === '002913')
    expect(osk?.hits.sort()).toEqual(['newhigh_hist', 'newhigh_year'])
  })

  it('multiHit 只保留命中 ≥2 个策略的标的', () => {
    readFileSync.mockReturnValue(JSON.stringify(FIXTURE))
    const d = loadMcpUniverse()
    expect(d?.multiHit.map((s) => s.code)).toEqual(['002913'])
  })

  it('透出截断信息，让前端能提示"非全量"', () => {
    readFileSync.mockReturnValue(JSON.stringify(FIXTURE))
    const g = loadMcpUniverse()?.groups.find((x) => x.key === 'newhigh_year')
    // collected 取文件声明值(10)而非 codes 数组长度(2)——本 fixture 里二者不同，
    // 正是为了锁住这个优先级：截图/截断时声明值才是真实的全市场命中数。
    expect(g).toMatchObject({ collected: 10, totalStocks: 19, truncated: true })
  })

  it('缺失 union 字段时自算去重池（兼容旧版生成脚本）', () => {
    const { union: _drop, ...rest } = FIXTURE
    readFileSync.mockReturnValue(JSON.stringify(rest))
    const d = loadMcpUniverse()
    expect(d?.union.map((s) => s.code).sort()).toEqual(['002913', '605177'])
  })

  it('指定日期时精确读取该日期文件', () => {
    readFileSync.mockReturnValue(JSON.stringify(FIXTURE))
    loadMcpUniverse('2026-09-14')
    expect(readFileSync).toHaveBeenCalledWith(
      expect.stringContaining('mcp-universe-2026-09-14.json'),
      'utf8',
    )
  })

  it('文件损坏时返回 null，不抛出', () => {
    readFileSync.mockReturnValue('{ not json')
    expect(loadMcpUniverse()).toBeNull()
  })

  it('日期格式非法时回落最新一份，而非去读任意文件', () => {
    readFileSync.mockReturnValue(JSON.stringify(FIXTURE))
    const d = loadMcpUniverse('../../etc/passwd')
    expect(d?.asof).toBe('2026-09-15')
  })
})

describe('fetchMcpUniverse', () => {
  it('无任何候选集时抛出可操作的错误', () => {
    readdirSync.mockReturnValue([])
    expect(() => fetchMcpUniverse()).toThrow(/mcp-universe/)
  })
})
