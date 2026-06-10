// East Money F10 (公司资料) datacenter API: company profile, multi-year key
// financials, and top-10 shareholders. These fill the report fields the quote
// snapshot cannot provide. Pure row-mappers are exported for unit tests; the
// fetchers degrade to null on any network/shape failure.

import { EM_HEADERS } from '../lib/emHeaders'

const DATACENTER_URL = 'https://datacenter.eastmoney.com/securities/api/data/v1/get'
const TIMEOUT_MS = 6000

export interface CompanyProfile {
  orgName: string
  industryEM: string // e.g. 电力设备-电池-锂电池
  industryCSRC: string
  actualHolder: string
  chairman: string
  employees: number
  province: string
  regAddress: string
  listingDate: string // YYYY-MM-DD
  foundDate: string
  mainBusiness: string
}

export interface AnnualFinancials {
  year: number
  revenue: number // 元
  revenueYoy: number // %
  netProfit: number // 归母净利润, 元
  netProfitYoy: number
  deductedProfit: number // 扣非净利润, 元
  deductedProfitYoy: number
  roeWeighted: number // 加权 ROE, %
  grossMargin: number // %
  netMargin: number // %
  debtRatio: number // 资产负债率, %
  eps: number // 基本每股收益, 元
  bps: number // 每股净资产, 元
  ocfPerShare: number // 每股经营现金流, 元
  rdExpense: number // 研发支出, 元
}

export interface TopHolders {
  endDate: string // YYYY-MM-DD
  holders: { rank: number; name: string; ratio: number }[]
  totalRatio: number // 已披露股东合计持股比例, %
}

/** '300750' → '300750.SZ'; 6xxxxx → .SH; 8/4/92 开头 → .BJ (北交所). */
export function toSecucode(code: string): string {
  if (code.startsWith('6')) return `${code}.SH`
  if (code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) return `${code}.BJ`
  return `${code}.SZ`
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** '2018-06-11 00:00:00' → '2018-06-11' */
function dateOnly(v: unknown): string {
  return str(v).slice(0, 10)
}

export function mapCompanyProfile(row: Record<string, unknown> | null | undefined): CompanyProfile | null {
  if (!row || typeof row !== 'object') return null
  const profile: CompanyProfile = {
    orgName: str(row.ORG_NAME),
    industryEM: str(row.BOARD_NAME_LEVEL) || str(row.EM2016),
    industryCSRC: str(row.INDUSTRYCSRC1),
    actualHolder: str(row.ACTUAL_HOLDER),
    chairman: str(row.CHAIRMAN),
    employees: num(row.EMP_NUM),
    province: str(row.PROVINCE),
    regAddress: str(row.REG_ADDRESS),
    listingDate: dateOnly(row.LISTING_DATE),
    foundDate: dateOnly(row.FOUND_DATE),
    mainBusiness: str(row.MAIN_BUSINESS),
  }
  return profile.orgName || profile.industryEM ? profile : null
}

export function mapAnnualFinancials(rows: Record<string, unknown>[] | null | undefined): AnnualFinancials[] {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => ({
      year: num(row.REPORT_YEAR) || parseInt(dateOnly(row.REPORT_DATE).slice(0, 4), 10) || 0,
      revenue: num(row.TOTALOPERATEREVE),
      revenueYoy: num(row.TOTALOPERATEREVETZ),
      netProfit: num(row.PARENTNETPROFIT),
      netProfitYoy: num(row.PARENTNETPROFITTZ),
      deductedProfit: num(row.KCFJCXSYJLR),
      deductedProfitYoy: num(row.KCFJCXSYJLRTZ),
      roeWeighted: num(row.ROEJQ),
      grossMargin: num(row.XSMLL),
      netMargin: num(row.XSJLL),
      debtRatio: num(row.ZCFZL),
      eps: num(row.EPSJB),
      bps: num(row.BPS),
      ocfPerShare: num(row.MGJYXJJE),
      rdExpense: num(row.RDEXPEND),
    }))
    .filter((r) => r.year > 0 && (r.revenue !== 0 || r.netProfit !== 0))
    .sort((a, b) => b.year - a.year)
}

/**
 * Group raw holder rows by END_DATE and pick the newest disclosure that lists a
 * reasonably complete top-10 (interim filings sometimes disclose only the top
 * few holders); fall back to the newest group when none is complete enough.
 */
export function pickLatestHolderGroup(rows: Record<string, unknown>[] | null | undefined): TopHolders | null {
  if (!Array.isArray(rows) || rows.length === 0) return null

  const groups = new Map<string, { rank: number; name: string; ratio: number }[]>()
  for (const row of rows) {
    const endDate = dateOnly(row.END_DATE)
    const name = str(row.HOLDER_NAME)
    if (!endDate || !name) continue
    const holder = { rank: num(row.HOLDER_RANK), name, ratio: num(row.HOLD_NUM_RATIO) }
    const group = groups.get(endDate)
    if (group) group.push(holder)
    else groups.set(endDate, [holder])
  }
  if (groups.size === 0) return null

  const dates = [...groups.keys()].sort().reverse()
  const endDate = dates.find((d) => (groups.get(d)?.length ?? 0) >= 8) ?? dates[0]
  const holders = groups
    .get(endDate)!
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 10)

  return {
    endDate,
    holders,
    totalRatio: Math.round(holders.reduce((sum, h) => sum + h.ratio, 0) * 100) / 100,
  }
}

async function fetchF10Rows(params: Record<string, string>): Promise<Record<string, unknown>[] | null> {
  const search = new URLSearchParams({
    columns: 'ALL',
    pageNumber: '1',
    source: 'HSF10',
    client: 'PC',
    ...params,
  })
  try {
    const res = await fetch(`${DATACENTER_URL}?${search}`, {
      headers: EM_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { result?: { data?: Record<string, unknown>[] } }
    return json?.result?.data ?? null
  } catch {
    return null
  }
}

export async function fetchCompanyProfile(code: string): Promise<CompanyProfile | null> {
  const rows = await fetchF10Rows({
    reportName: 'RPT_F10_BASIC_ORGINFO',
    filter: `(SECUCODE="${toSecucode(code)}")`,
    pageSize: '1',
  })
  return mapCompanyProfile(rows?.[0])
}

export async function fetchFinancialHistory(code: string, years = 4): Promise<AnnualFinancials[]> {
  const rows = await fetchF10Rows({
    reportName: 'RPT_F10_FINANCE_MAINFINADATA',
    filter: `(SECUCODE="${toSecucode(code)}")(REPORT_TYPE="年报")`,
    sortTypes: '-1',
    sortColumns: 'REPORT_DATE',
    pageSize: String(years + 1), // newest row can be an empty pre-disclosure shell
  })
  return mapAnnualFinancials(rows ?? undefined).slice(0, years)
}

export async function fetchTopHolders(code: string): Promise<TopHolders | null> {
  const rows = await fetchF10Rows({
    reportName: 'RPT_F10_EH_HOLDERS',
    filter: `(SECUCODE="${toSecucode(code)}")`,
    sortTypes: '-1,1',
    sortColumns: 'END_DATE,HOLDER_RANK',
    pageSize: '40', // a few disclosure periods × up to 10 holders
  })
  return pickLatestHolderGroup(rows ?? undefined)
}
