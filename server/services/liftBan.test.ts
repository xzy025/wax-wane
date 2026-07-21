import { describe, it, expect } from 'vitest'
import { mapLiftBanRows, groupLiftBans, toLiftBanBadge, windowEnd } from './liftBan'

// fixture = 2026-07-16 实抓 RPT_LIFT_STAGE 原始行(新列名;FREE_DATE 带时分秒、FREE_RATIO 小数)
const LIVE_ROWS = [
  { SECURITY_CODE: '920718', SECURITY_NAME_ABBR: '合肥高科', FREE_DATE: '2026-07-16 00:00:00', FREE_SHARES_TYPE: '追加承诺限售股份上市流通', FREE_SHARES: 4651.0069, ABLE_FREE_SHARES: 102, FREE_RATIO: 0.023660325684 },
  { SECURITY_CODE: '688336', SECURITY_NAME_ABBR: '三生国健', FREE_DATE: '2026-07-16 00:00:00', FREE_SHARES_TYPE: '股权激励限售股份', FREE_SHARES: 89622.5429, ABLE_FREE_SHARES: 188.6029, FREE_RATIO: 0.002108851517 },
  { SECURITY_CODE: '920206', SECURITY_NAME_ABBR: '彩客科技', FREE_DATE: '2026-07-16 00:00:00', FREE_SHARES_TYPE: '公开发行原股东限售股份', FREE_SHARES: 2752.5103, ABLE_FREE_SHARES: 1326.9271, FREE_RATIO: 0.930795971782 },
]

describe('mapLiftBanRows(真实响应 fixture)', () => {
  it('新列名映射:日期切10位、FREE_RATIO 小数→百分比(两位)、万股原样', () => {
    const rows = mapLiftBanRows(LIVE_ROWS)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({
      code: '920718',
      ev: { date: '2026-07-16', type: '追加承诺限售股份上市流通', ratioPct: 2.37, ableSharesWan: 102 },
    })
    expect(rows[2].ev.ratioPct).toBeCloseTo(93.08, 2) // 北交所小票流通盘小,93% 是真实数据
    expect(rows[1].ev.ableSharesWan).toBeCloseTo(188.6029, 4)
  })

  it('脏行防御:缺 code/坏日期/空对象 跳过,不炸不混入', () => {
    const rows = mapLiftBanRows([
      {},
      { SECURITY_CODE: 'abc', FREE_DATE: '2026-07-16 00:00:00' }, // 非6位代码
      { SECURITY_CODE: '600000', FREE_DATE: null }, // 无日期
      { SECURITY_CODE: '600000', FREE_DATE: '2026-08-01 00:00:00' }, // 合法(类型/比例缺省)
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].ev).toEqual({ date: '2026-08-01', type: '', ratioPct: 0, ableSharesWan: 0 })
  })
})

describe('groupLiftBans / toLiftBanBadge', () => {
  it('按 code 分组、组内解禁日升序;角标取最近一批', () => {
    const grouped = groupLiftBans([
      { code: '600000', ev: { date: '2026-08-10', type: '定增', ratioPct: 5, ableSharesWan: 100 } },
      { code: '600000', ev: { date: '2026-07-20', type: '首发', ratioPct: 12, ableSharesWan: 900 } },
      { code: '000001', ev: { date: '2026-07-18', type: '股权激励', ratioPct: 0.2, ableSharesWan: 30 } },
    ])
    expect(grouped.get('600000')?.map((e) => e.date)).toEqual(['2026-07-20', '2026-08-10'])
    expect(toLiftBanBadge(grouped.get('600000'))).toEqual({ date: '2026-07-20', ratioPct: 12, type: '首发' })
    expect(toLiftBanBadge(grouped.get('999999'))).toBeNull() // 无解禁 → null,候选不挂角标
  })
})

describe('windowEnd', () => {
  it('日历日前瞻,跨月正确', () => {
    expect(windowEnd('2026-07-16', 30)).toBe('2026-08-15')
    expect(windowEnd('2026-12-15', 30)).toBe('2027-01-14')
  })
})
