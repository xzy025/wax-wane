import type { ToolModule } from '../types'

export const schema = {
  name: 'getMacroIndicators',
  description:
    'Get current macroeconomic indicators: US 10Y/5Y Treasury yields, gold (XAU/USD), ' +
    'US Dollar Index (DXY), USD/CNY exchange rate, crude oil (WTI), and VIX volatility index. ' +
    'Use when the user asks about macro conditions, risk appetite, or external market factors.',
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
}

export async function execute(): Promise<unknown> {
  const res = await fetch('/api/mcp/macro/indicators')
  if (!res.ok) {
    const text = await res.text()
    return { error: `Failed to fetch macro data: ${res.status} ${text}` }
  }
  return res.json()
}

export const getMacroIndicators: ToolModule = { schema, execute }
