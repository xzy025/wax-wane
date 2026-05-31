import { Activity, CheckCircle, CurrencyCircleDollar, Database } from 'phosphor-react'
import type { TradeGroup, MetricCard } from '../types'

export const metricCards = [
  {
    key: 'realizedPnl',
    value: '¥18,426',
    positive: true,
    tone: 'positive',
    icon: CurrencyCircleDollar,
  },
  { key: 'winRate', value: '58.3%', tone: 'neutral', icon: CheckCircle },
  { key: 'payoff', value: '1.72', tone: 'positive', icon: Activity },
  { key: 'fees', value: '¥2,184', tone: 'warning', icon: Database },
] satisfies MetricCard[]

export const tradeGroups = [
  {
    id: 'tg-001',
    code: '300750',
    name: 'CATL',
    opened: '2026-03-04',
    closed: '2026-03-18',
    pnl: 8460,
    returnRate: 9.4,
    days: 14,
    totalFee: 324.6,
    strategy: 'Pullback',
    mistakes: ['Early profit taking'],
    status: 'Reviewed',
  },
  {
    id: 'tg-002',
    code: '600519',
    name: 'Kweichow Moutai',
    opened: '2026-03-12',
    closed: '2026-03-21',
    pnl: -3920,
    returnRate: -3.1,
    days: 9,
    totalFee: 204.8,
    strategy: 'Index beta',
    mistakes: ['No plan', 'Late stop loss'],
    status: 'Follow up',
  },
  {
    id: 'tg-003',
    code: '002594',
    name: 'BYD',
    opened: '2026-04-02',
    closed: '2026-04-09',
    pnl: 5260,
    returnRate: 6.6,
    days: 7,
    totalFee: 152.0,
    strategy: 'Breakout',
    mistakes: [],
    status: 'Reviewed',
  },
  {
    id: 'tg-004',
    code: '601318',
    name: 'Ping An',
    opened: '2026-04-11',
    closed: null,
    pnl: -1180,
    returnRate: -1.8,
    days: 27,
    totalFee: 12.6,
    strategy: 'Reversal',
    mistakes: ['Oversized position'],
    status: 'Not reviewed',
  },
] satisfies TradeGroup[]

export const ledgerRows = [
  ['2026-04-11', '601318', 'Ping An', 'Buy', '1,200', '41.20', '49,440.00', '12.60'],
  ['2026-04-09', '002594', 'BYD', 'Sell', '500', '228.60', '114,300.00', '124.80'],
  ['2026-04-02', '002594', 'BYD', 'Buy', '500', '217.80', '108,900.00', '27.20'],
  ['2026-03-21', '600519', 'Kweichow Moutai', 'Sell', '100', '1,508.00', '150,800.00', '166.20'],
  ['2026-03-12', '600519', 'Kweichow Moutai', 'Buy', '100', '1,546.00', '154,600.00', '38.60'],
]

export const mistakeStats: [string, number, number][] = [
  ['No plan', 8, -12640],
  ['Late stop loss', 5, -9280],
  ['Early profit taking', 4, 3110],
  ['Oversized position', 3, -6740],
]
