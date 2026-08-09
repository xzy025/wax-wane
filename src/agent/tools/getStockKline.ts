import type { ToolModule } from '../types'
import { normalizeSecurityCode } from '../../utils/securityCode'

export const schema = {
  name: 'getStockKline',
  description:
    '获取A股或港股个股K线历史数据（日线/周线/月线）。' +
    '返回每根K线的日期、开盘、收盘、最高、最低、成交量、涨跌幅等。' +
    '用于技术面分析：Wyckoff阶段判断、道氏理论趋势、Al Brooks形态识别、支撑阻力位。',
  parameters: {
    type: 'object' as const,
    properties: {
      stockCode: {
        type: 'string',
        description: 'A股代码如 300750，港股代码如 HK2476 或 02476',
      },
      period: {
        type: 'number',
        description: 'K线周期：101=日线，102=周线，103=月线。默认101',
      },
      count: {
        type: 'number',
        description: '获取K线数量，默认30',
      },
    },
    required: ['stockCode'],
  },
}

export async function execute(args: Record<string, unknown>): Promise<unknown> {
  const code = typeof args.stockCode === 'string' ? args.stockCode : ''
  const period = typeof args.period === 'number' ? args.period : 101
  const count = typeof args.count === 'number' ? args.count : 30

  const security = normalizeSecurityCode(code)
  if (!security) {
    return {
      error: 'Invalid stock code. Use an A-share code like 300750 or an HK code like HK2476.',
    }
  }

  const res = await fetch(
    `/api/stock/kline?code=${encodeURIComponent(security.canonicalCode)}&period=${period}&count=${count}`,
  )
  if (!res.ok) {
    const text = await res.text()
    return { error: `Failed to fetch K-line: ${res.status} ${text}` }
  }
  return res.json()
}

export const getStockKline: ToolModule = { schema, execute }
