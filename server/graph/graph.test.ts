import { describe, it, expect } from 'vitest'
import { inferSector } from './graphSync'

// Test the sector inference logic (doesn't require DB)
describe('Sector Inference', () => {
  it('infers bank sector from name', () => {
    expect(inferSector('601398', '工商银行')).toBe('银行')
    expect(inferSector('601939', '建设银行')).toBe('银行')
  })

  it('infers securities sector from name', () => {
    expect(inferSector('601066', '中信建投')).toBe('证券')
  })

  it('infers insurance sector from name', () => {
    expect(inferSector('601318', '中国平安')).toBe('保险')
  })

  it('infers baijiu sector from name', () => {
    expect(inferSector('600519', '贵州茅台')).toBe('白酒')
    expect(inferSector('000858', '五粮液')).toBe('白酒')
  })

  it('infers pharma sector from name', () => {
    expect(inferSector('600276', '恒瑞医药')).toBe('医药')
  })

  it('infers semiconductor sector from name', () => {
    expect(inferSector('688981', '中芯国际')).toBe('半导体')
  })

  it('infers new energy sector from name', () => {
    expect(inferSector('300750', '宁德时代')).toBe('新能源')
  })

  it('infers auto sector from name', () => expect(inferSector('002594', '比亚迪')).toBe('汽车'))

  it('infers real estate sector from name', () => {
    expect(inferSector('000002', '万科A')).toBe('房地产')
  })

  it('falls back to code-based inference', () => {
    expect(inferSector('600000', '浦发银行')).toBe('银行') // Name match
    expect(inferSector('601000', 'SomeStock')).toBe('沪市主板')
    expect(inferSector('000001', 'SomeStock')).toBe('深市主板')
    expect(inferSector('002001', 'SomeStock')).toBe('中小板')
    expect(inferSector('300001', 'SomeStock')).toBe('创业板')
    expect(inferSector('688001', 'SomeStock')).toBe('科创板')
  })

  it('returns 其他 for unknown codes', () => {
    expect(inferSector('999999', 'UnknownStock')).toBe('其他')
  })
})

// Integration tests (require database — skip in CI)
describe.skipIf(!process.env.PG_HOST)('Graph Schema Integration', () => {
  it('initializes graph schema', async () => {
    const { initGraphSchema } = await import('./graphSchema')
    await expect(initGraphSchema()).resolves.not.toThrow()
  })

  it('creates and retrieves a node', async () => {
    const { upsertNode, getNode, deleteNode } = await import('./graphSchema')

    await upsertNode({
      id: 'test:node1',
      type: 'Stock',
      properties: { code: '600519', name: 'Test Stock' },
    })

    const node = await getNode('test:node1')
    expect(node).toBeDefined()
    expect(node?.type).toBe('Stock')
    expect(node?.properties.code).toBe('600519')

    await deleteNode('test:node1')
  })

  it('creates and retrieves edges', async () => {
    const { upsertNode, upsertEdge, getEdgesFrom, deleteNode, deleteEdge } = await import('./graphSchema')

    await upsertNode({ id: 'test:src', type: 'TradeGroup', properties: {} })
    await upsertNode({ id: 'test:tgt', type: 'Mistake', properties: { name: 'test' } })

    await upsertEdge({
      source_id: 'test:src',
      target_id: 'test:tgt',
      type: 'HAS_MISTAKE',
    })

    const edges = await getEdgesFrom('test:src')
    expect(edges.length).toBeGreaterThanOrEqual(1)
    expect(edges.some((e) => e.target_id === 'test:tgt')).toBe(true)

    await deleteEdge('test:src', 'test:tgt', 'HAS_MISTAKE')
    await deleteNode('test:src')
    await deleteNode('test:tgt')
  })

  it('traverses graph', async () => {
    const { upsertNode, upsertEdge, traverse, deleteNode } = await import('./graphSchema')

    // Create a small graph: A -> B -> C
    await upsertNode({ id: 'test:A', type: 'TradeGroup', properties: {} })
    await upsertNode({ id: 'test:B', type: 'Stock', properties: {} })
    await upsertNode({ id: 'test:C', type: 'Sector', properties: {} })
    await upsertEdge({ source_id: 'test:A', target_id: 'test:B', type: 'INVOLVES' })
    await upsertEdge({ source_id: 'test:B', target_id: 'test:C', type: 'IN_SECTOR' })

    const result = await traverse('test:A', { depth: 2 })
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result.some((r) => r.node.id === 'test:B')).toBe(true)
    expect(result.some((r) => r.node.id === 'test:C')).toBe(true)

    await deleteNode('test:A')
    await deleteNode('test:B')
    await deleteNode('test:C')
  })
})
