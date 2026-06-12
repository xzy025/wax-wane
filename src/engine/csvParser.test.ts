import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  parseFile,
  mapAndValidate,
  MAX_EXCEL_FILE_SIZE,
  type CsvPreview,
  type ColumnMapping,
} from './csvParser'

function makeExcelFile(
  sheets: Record<string, (string | number)[][]>,
  name = 'test.xlsx',
): File {
  const wb = XLSX.utils.book_new()
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName)
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([buf], name)
}

const fullMapping: ColumnMapping = {
  tradeDate: '成交日期',
  stockCode: '证券代码',
  stockName: '证券名称',
  side: '买卖方向',
  quantity: '成交数量',
  price: '成交价格',
  grossAmount: '成交金额',
  commission: '手续费',
  stampTax: '印花税',
  transferFee: '过户费',
  netAmount: '实收金额',
}

describe('parseFile (xlsx)', () => {
  it('parses headers and rows from the first sheet', async () => {
    const file = makeExcelFile({
      Sheet1: [
        ['成交日期', '证券代码', '买卖方向'],
        ['2026-01-05', '600000', '买入'],
        ['2026-01-06', '000001', '卖出'],
      ],
    })
    const preview = await parseFile(file)
    expect(preview.headers).toEqual(['成交日期', '证券代码', '买卖方向'])
    expect(preview.totalRows).toBe(2)
    expect(preview.rows[0]).toEqual(['2026-01-05', '600000', '买入'])
  })

  it('only consumes the first sheet of a multi-sheet workbook', async () => {
    const file = makeExcelFile({
      First: [
        ['h1', 'h2'],
        ['a', 'b'],
      ],
      Second: [
        ['x1', 'x2'],
        ['c', 'd'],
      ],
    })
    const preview = await parseFile(file)
    expect(preview.headers).toEqual(['h1', 'h2'])
    expect(preview.totalRows).toBe(1)
  })

  it('rejects files above the size limit without parsing them', async () => {
    const file = makeExcelFile({ Sheet1: [['h'], ['v']] })
    Object.defineProperty(file, 'size', { value: MAX_EXCEL_FILE_SIZE + 1 })
    await expect(parseFile(file)).rejects.toThrow('文件过大')
  })

  it('rejects an empty workbook', async () => {
    const file = makeExcelFile({ Sheet1: [['', ''], ['', '']] })
    await expect(parseFile(file)).rejects.toThrow('文件为空')
  })
})

describe('parseFile (csv)', () => {
  it('parses csv headers and rows', async () => {
    const file = new File(
      ['成交日期,证券代码,买卖方向\n2026-01-05,600000,买入\n2026-01-06,000001,卖出\n'],
      'trades.csv',
      { type: 'text/csv' },
    )
    const preview = await parseFile(file)
    expect(preview.headers).toEqual(['成交日期', '证券代码', '买卖方向'])
    expect(preview.totalRows).toBe(2)
  })

  it('rejects an empty csv file', async () => {
    const file = new File(['\n\n'], 'empty.csv', { type: 'text/csv' })
    await expect(parseFile(file)).rejects.toThrow('文件为空')
  })
})

describe('mapAndValidate', () => {
  function previewOf(rows: string[][]): CsvPreview {
    return {
      headers: [
        '成交日期',
        '证券代码',
        '证券名称',
        '买卖方向',
        '成交数量',
        '成交价格',
        '成交金额',
        '手续费',
        '印花税',
        '过户费',
        '实收金额',
      ],
      rows,
      totalRows: rows.length,
    }
  }

  it('maps a valid row and derives net amount from fees', () => {
    const preview = previewOf([
      ['2026-01-05', '600000', '浦发银行', '买入', '1000', '10.5', '10500', '5', '0', '1', ''],
    ])
    const { trades, errors } = mapAndValidate(preview, fullMapping)
    expect(errors).toHaveLength(0)
    expect(trades).toHaveLength(1)
    expect(trades[0].side).toBe('buy')
    expect(trades[0].quantity).toBe(1000)
    expect(trades[0].netAmount).toBe(10500 - 5 - 0 - 1)
  })

  it('falls back to quantity * price when gross amount is missing', () => {
    const preview = previewOf([
      ['2026-01-05', '600000', '', '卖出', '200', '10', '', '', '', '', ''],
    ])
    const { trades, errors } = mapAndValidate(preview, fullMapping)
    expect(errors).toHaveLength(0)
    expect(trades[0].side).toBe('sell')
    expect(trades[0].grossAmount).toBe(2000)
    expect(trades[0].stockName).toBe('600000')
  })

  it('reports invalid stock codes', () => {
    const preview = previewOf([
      ['2026-01-05', 'ABC', '', '买入', '100', '10', '', '', '', '', ''],
    ])
    const { trades, errors } = mapAndValidate(preview, fullMapping)
    expect(trades).toHaveLength(0)
    expect(errors[0]).toContain('证券代码无效')
  })

  it('reports missing trade date and invalid quantity/price', () => {
    const preview = previewOf([
      ['', '600000', '', '买入', '100', '10', '', '', '', '', ''],
      ['2026-01-05', '600000', '', '买入', '0', '10', '', '', '', '', ''],
      ['2026-01-05', '600000', '', '买入', '100', '-1', '', '', '', '', ''],
    ])
    const { trades, errors } = mapAndValidate(preview, fullMapping)
    expect(trades).toHaveLength(0)
    expect(errors).toHaveLength(3)
    expect(errors[0]).toContain('缺少成交日期')
    expect(errors[1]).toContain('数量无效')
    expect(errors[2]).toContain('价格无效')
  })
})
