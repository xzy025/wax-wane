import { describe, it, expect } from 'vitest'
import {
  toSecucode,
  mapCompanyProfile,
  mapAnnualFinancials,
  pickLatestHolderGroup,
} from './f10'

describe('toSecucode', () => {
  it('maps exchanges by code prefix', () => {
    expect(toSecucode('600519')).toBe('600519.SH')
    expect(toSecucode('688981')).toBe('688981.SH')
    expect(toSecucode('300750')).toBe('300750.SZ')
    expect(toSecucode('000001')).toBe('000001.SZ')
    expect(toSecucode('830799')).toBe('830799.BJ')
    expect(toSecucode('430047')).toBe('430047.BJ')
    expect(toSecucode('920001')).toBe('920001.BJ')
  })
})

describe('mapCompanyProfile', () => {
  // Trimmed real RPT_F10_BASIC_ORGINFO row for 300750
  const row = {
    ORG_NAME: '宁德时代新能源科技股份有限公司',
    BOARD_NAME_LEVEL: '电力设备-电池-锂电池',
    EM2016: '电气设备-电源设备-储能设备',
    INDUSTRYCSRC1: '制造业-电气机械和器材制造业',
    ACTUAL_HOLDER: '曾毓群',
    CHAIRMAN: '曾毓群',
    EMP_NUM: 185839,
    PROVINCE: '福建',
    REG_ADDRESS: '中国福建省宁德市蕉城区漳湾镇新港路2号',
    LISTING_DATE: '2018-06-11 00:00:00',
    FOUND_DATE: '2011-12-16 00:00:00',
    MAIN_BUSINESS: '从事动力电池、储能电池的研发、生产、销售',
  }

  it('maps a real profile row', () => {
    const p = mapCompanyProfile(row)
    expect(p?.industryEM).toBe('电力设备-电池-锂电池')
    expect(p?.actualHolder).toBe('曾毓群')
    expect(p?.employees).toBe(185839)
    expect(p?.listingDate).toBe('2018-06-11')
    expect(p?.foundDate).toBe('2011-12-16')
  })

  it('falls back to EM2016 when BOARD_NAME_LEVEL is absent', () => {
    const p = mapCompanyProfile({ ...row, BOARD_NAME_LEVEL: null })
    expect(p?.industryEM).toBe('电气设备-电源设备-储能设备')
  })

  it('returns null for empty/garbage rows', () => {
    expect(mapCompanyProfile(null)).toBeNull()
    expect(mapCompanyProfile(undefined)).toBeNull()
    expect(mapCompanyProfile({})).toBeNull()
  })
})

describe('mapAnnualFinancials', () => {
  const row2025 = {
    REPORT_YEAR: 2025,
    REPORT_DATE: '2025-12-31 00:00:00',
    TOTALOPERATEREVE: 423701834000,
    TOTALOPERATEREVETZ: 17.04,
    PARENTNETPROFIT: 72201282000,
    PARENTNETPROFITTZ: 42.28,
    KCFJCXSYJLR: 64507864000,
    KCFJCXSYJLRTZ: 43.37,
    ROEJQ: 24.91,
    XSMLL: 26.27,
    XSJLL: 18.12,
    ZCFZL: 61.94,
    EPSJB: 16.14,
    BPS: 73.87,
    MGJYXJJE: 29.19,
    RDEXPEND: 22146581000,
  }

  it('maps a real annual row', () => {
    const [r] = mapAnnualFinancials([row2025])
    expect(r.year).toBe(2025)
    expect(r.revenue).toBe(423701834000)
    expect(r.roeWeighted).toBe(24.91)
    expect(r.grossMargin).toBe(26.27)
    expect(r.eps).toBe(16.14)
  })

  it('drops empty pre-disclosure shell rows and sorts desc by year', () => {
    const shell = { REPORT_YEAR: 2026, REPORT_DATE: '2026-12-31 00:00:00' }
    const r2023 = { ...row2025, REPORT_YEAR: 2023, REPORT_DATE: '2023-12-31 00:00:00' }
    const result = mapAnnualFinancials([r2023, shell, row2025])
    expect(result.map((r) => r.year)).toEqual([2025, 2023])
  })

  it('derives year from REPORT_DATE when REPORT_YEAR is missing', () => {
    const [r] = mapAnnualFinancials([{ ...row2025, REPORT_YEAR: null }])
    expect(r.year).toBe(2025)
  })

  it('returns [] for non-arrays', () => {
    expect(mapAnnualFinancials(null)).toEqual([])
    expect(mapAnnualFinancials(undefined)).toEqual([])
  })
})

describe('pickLatestHolderGroup', () => {
  function holderRow(endDate: string, rank: number, name: string, ratio: number) {
    return { END_DATE: `${endDate} 00:00:00`, HOLDER_RANK: rank, HOLDER_NAME: name, HOLD_NUM_RATIO: ratio }
  }
  const fullQuarter = Array.from({ length: 10 }, (_, i) =>
    holderRow('2026-03-31', i + 1, `股东${i + 1}`, 10 - i),
  )

  it('prefers the newest disclosure with a complete top list', () => {
    const partial = [
      holderRow('2026-05-11', 1, '厦门瑞庭投资有限公司', 22.04),
      holderRow('2026-05-11', 2, '香港中央结算有限公司', 16.46),
      holderRow('2026-05-11', 3, '黄世霖', 9.09),
    ]
    const result = pickLatestHolderGroup([...partial, ...fullQuarter])
    expect(result?.endDate).toBe('2026-03-31')
    expect(result?.holders).toHaveLength(10)
    expect(result?.holders[0].name).toBe('股东1')
  })

  it('falls back to the newest group when no group is complete', () => {
    const rows = [
      holderRow('2026-05-11', 1, '甲', 20),
      holderRow('2026-05-11', 2, '乙', 10),
      holderRow('2026-04-23', 1, '甲', 21),
    ]
    const result = pickLatestHolderGroup(rows)
    expect(result?.endDate).toBe('2026-05-11')
    expect(result?.totalRatio).toBe(30)
  })

  it('sorts holders by rank and sums ratios', () => {
    const result = pickLatestHolderGroup([...fullQuarter].reverse())
    expect(result?.holders[0].rank).toBe(1)
    expect(result?.totalRatio).toBe(55) // 10+9+…+1
  })

  it('returns null for empty input', () => {
    expect(pickLatestHolderGroup([])).toBeNull()
    expect(pickLatestHolderGroup(null)).toBeNull()
  })
})
