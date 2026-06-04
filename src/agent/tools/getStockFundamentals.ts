import type { ToolModule } from '../types'

export const schema = {
  name: 'getStockFundamentals',
  description:
    '获取A股个股基本面数据：市盈率(PE)、市净率(PB)、净资产收益率(ROE)、总市值、行业等。' +
    '用于基本面分析：估值水平、盈利能力、行业对比。',
  parameters: {
    type: 'object' as const,
    properties: {
      stockCode: {
        type: 'string',
        description: '6位股票代码，如 "300750"（宁德时代）',
      },
    },
    required: ['stockCode'],
  },
}

export async function execute(args: Record<string, unknown>): Promise<unknown> {
  const code = typeof args.stockCode === 'string' ? args.stockCode : ''
  if (!code || !/^\d{6}$/.test(code)) {
    return { error: 'Invalid stock code. Provide a 6-digit code like "300750".' }
  }

  const res = await fetch(`/api/stock/fundamentals?code=${code}`)
  if (!res.ok) {
    const text = await res.text()
    return { error: `Failed to fetch fundamentals: ${res.status} ${text}` }
  }
  return res.json()
}

export const getStockFundamentals: ToolModule = { schema, execute }
