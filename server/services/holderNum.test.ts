import { describe, it, expect } from 'vitest'
import { mapHolderNumRows, chunkCodes } from './holderNum'

// fixture = 2026-07-23 实抓 RPT_HOLDERNUMLATEST 原始行(HOLDER_NUM_RATIO 已是百分数、
// 日期带时分秒需切10位;上游 SKILL 写的 AVG_FREE_SHARES 实际不存在,户均持股列名是 AVG_HOLD_NUM)
const LIVE_ROWS = [
  { SECURITY_CODE: '300566', SECURITY_NAME_ABBR: '激智科技', HOLDER_NUM: 23141, PRE_HOLDER_NUM: 24970, HOLDER_NUM_CHANGE: -1829, HOLDER_NUM_RATIO: -7.324789747697, END_DATE: '2026-03-31 00:00:00', HOLD_NOTICE_DATE: '2026-04-29 00:00:00', AVG_HOLD_NUM: 11326.4173112657 },
  { SECURITY_CODE: '600460', HOLDER_NUM: 259362, HOLDER_NUM_RATIO: -6.46, END_DATE: '2026-03-31 00:00:00', HOLD_NOTICE_DATE: '2026-04-30 00:00:00', AVG_HOLD_NUM: 5432.1 },
  { SECURITY_CODE: '000725', HOLDER_NUM: 971956, HOLDER_NUM_RATIO: 2.03, END_DATE: '2026-03-31 00:00:00', HOLD_NOTICE_DATE: '2026-04-30 00:00:00', AVG_HOLD_NUM: 38456.7 },
]

describe('mapHolderNumRows(真实响应 fixture)', () => {
  it('列名映射:日期切10位、环比原样舍两位(已是百分数不再×100)、户均持股取整', () => {
    const map = mapHolderNumRows(LIVE_ROWS)
    expect(map.size).toBe(3)
    expect(map.get('300566')).toEqual({
      endDate: '2026-03-31',
      noticeDate: '2026-04-29',
      holderNum: 23141,
      changePct: -7.32,
      avgHoldShares: 11326,
    })
    expect(map.get('000725')?.changePct).toBe(2.03) // 户数增加(筹码分散)原样保留,展示层区分色彩
  })

  it('脏行防御:缺 code/坏期末日/户数非正/空对象 跳过,不炸不混入', () => {
    const map = mapHolderNumRows([
      {},
      { SECURITY_CODE: 'abcdef', HOLDER_NUM: 100, END_DATE: '2026-03-31 00:00:00' }, // 非数字代码
      { SECURITY_CODE: '600000', HOLDER_NUM: 100, END_DATE: null }, // 无期末日
      { SECURITY_CODE: '600001', HOLDER_NUM: 0, END_DATE: '2026-03-31 00:00:00' }, // 户数非正
      { SECURITY_CODE: '600002', HOLDER_NUM: 100, END_DATE: '2026-03-31 00:00:00' }, // 合法(其余缺省)
    ])
    expect(map.size).toBe(1)
    expect(map.get('600002')).toEqual({ endDate: '2026-03-31', noticeDate: '', holderNum: 100, changePct: 0, avgHoldShares: 0 })
  })

  it('同 code 后行覆盖前行(LATEST 表理论一股一行,防御上游重复)', () => {
    const map = mapHolderNumRows([
      { SECURITY_CODE: '600000', HOLDER_NUM: 100, HOLDER_NUM_RATIO: 1, END_DATE: '2025-12-31 00:00:00' },
      { SECURITY_CODE: '600000', HOLDER_NUM: 90, HOLDER_NUM_RATIO: -10, END_DATE: '2026-03-31 00:00:00' },
    ])
    expect(map.size).toBe(1)
    expect(map.get('600000')?.holderNum).toBe(90)
  })
})

describe('chunkCodes', () => {
  it('去重去脏后按 size 切片,保持输入序', () => {
    expect(chunkCodes(['600000', '000001', '600000', 'bad', '300566'], 2)).toEqual([
      ['600000', '000001'],
      ['300566'],
    ])
  })

  it('空输入/全脏输入 → 空片列表(调用方零请求)', () => {
    expect(chunkCodes([], 40)).toEqual([])
    expect(chunkCodes(['abc', '12345'], 40)).toEqual([])
  })
})
