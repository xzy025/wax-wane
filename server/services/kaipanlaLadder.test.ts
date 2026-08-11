import { describe, expect, it } from 'vitest'
import {
  parseKplRealtimeRow,
  parseKplReasonPayload,
} from './kaipanlaLadder'

describe('kaipanla realtime ladder parser', () => {
  it('maps ladder height, concepts, margin eligibility and one-price hints', () => {
    const stock = parseKplRealtimeRow(
      [
        '300862',
        '蓝盾光电',
        1,
        '',
        1786411500,
        '并购重组',
        12_000_000,
        0,
        0,
        0,
        0,
        520_000_000,
        '并购重组、智能驾驶',
        0,
        8.2,
        2,
        0,
        0,
        '',
        '801250',
        3,
        27.37,
        19.99,
      ],
      2,
    )

    expect(stock).toMatchObject({
      code: '300862',
      consecutiveDays: 2,
      firstTime: '092500',
      themes: ['并购重组', '智能驾驶'],
      isMarginEligible: true,
      onePriceHint: true,
      tBoardHint: false,
    })
  })

  it('marks an auction seal with intraday amplitude as a T-board hint', () => {
    const stock = parseKplRealtimeRow(
      [
        '600721',
        '百花医药',
        0,
        '',
        1786411543,
        '医药',
        0,
        0,
        0,
        0,
        0,
        0,
        'CRO、减肥药',
        0,
        21.72,
        6,
        1,
        1.55,
        '6连板',
      ],
      5,
    )

    expect(stock).toMatchObject({
      consecutiveDays: 6,
      nDayBoards: '6连板',
      onePriceHint: false,
      tBoardHint: true,
    })
  })
})

describe('kaipanla limit reason parser', () => {
  it('selects the requested trading day and preserves the detailed explanation', () => {
    const detail = parseKplReasonPayload(
      {
        StockID: '600611',
        List: [
          {
            Date: '2026-08-11',
            Reason: '无人驾驶+网约车；事件摘要',
            GNSM: '公司与平台合作推进 Robotaxi 运营。',
            SCLT: '日内龙一',
            Boom_ZS: '板块盘中走强',
          },
          { Date: '2026-07-01', Reason: '旧原因' },
        ],
      },
      '600611',
      '2026-08-11',
    )

    expect(detail).toEqual({
      code: '600611',
      date: '2026-08-11',
      reason: '无人驾驶+网约车；事件摘要',
      explanation: '公司与平台合作推进 Robotaxi 运营。',
      marketRole: '日内龙一',
      hotReason: '板块盘中走强',
      source: 'kaipanla',
    })
  })
})
