import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { ParsedTrade } from '../types'

export interface CsvPreview {
  headers: string[]
  rows: string[][]
  totalRows: number
}

export interface ColumnMapping {
  tradeDate: string
  stockCode: string
  stockName: string
  side: string
  quantity: string
  price: string
  grossAmount: string
  commission: string
  stampTax: string
  transferFee: string
  netAmount: string
}

const STANDARD_FIELDS: { key: keyof ColumnMapping; label: string; required: boolean }[] = [
  { key: 'tradeDate', label: '成交日期 / Trade Date', required: true },
  { key: 'stockCode', label: '证券代码 / Stock Code', required: true },
  { key: 'stockName', label: '证券名称 / Stock Name', required: false },
  { key: 'side', label: '买卖方向 / Side', required: true },
  { key: 'quantity', label: '成交数量 / Quantity', required: true },
  { key: 'price', label: '成交价格 / Price', required: true },
  { key: 'grossAmount', label: '成交金额 / Amount', required: false },
  { key: 'commission', label: '手续费 / Commission', required: false },
  { key: 'stampTax', label: '印花税 / Stamp Tax', required: false },
  { key: 'transferFee', label: '过户费 / Transfer Fee', required: false },
  { key: 'netAmount', label: '实收金额 / Net Amount', required: false },
]

export { STANDARD_FIELDS }

export function parseCsvFile(file: File): Promise<CsvPreview> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      encoding: 'UTF-8',
      complete(results) {
        const allRows = results.data as string[][] // PapaParse returns string[][] when parsing text
        const nonEmpty = allRows.filter((row) => row.some((cell) => cell.trim() !== ''))
        if (nonEmpty.length === 0) {
          reject(new Error('文件为空'))
          return
        }
        const headers = nonEmpty[0]
        const dataRows = nonEmpty.slice(1)
        resolve({
          headers,
          rows: dataRows.slice(0, 50),
          totalRows: dataRows.length,
        })
      },
      error(err) {
        reject(err)
      },
    })
  })
}

function parseExcelFile(file: File): Promise<CsvPreview> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result
        if (!(buffer instanceof ArrayBuffer)) {
          reject(new Error('读取文件失败'))
          return
        }
        const data = new Uint8Array(buffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        if (!sheetName) {
          reject(new Error('Excel 文件无工作表'))
          return
        }
        const sheet = workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' })
        const allRows = jsonData.map((row) => row.map((cell) => String(cell)))
        const nonEmpty = allRows.filter((row) => row.some((cell) => cell.trim() !== ''))
        if (nonEmpty.length === 0) {
          reject(new Error('文件为空'))
          return
        }
        const headers = nonEmpty[0]
        const dataRows = nonEmpty.slice(1)
        resolve({
          headers,
          rows: dataRows.slice(0, 50),
          totalRows: dataRows.length,
        })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsArrayBuffer(file)
  })
}

export function parseFile(file: File): Promise<CsvPreview> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'xlsx' || ext === 'xls') {
    return parseExcelFile(file)
  }
  return parseCsvFile(file)
}

function normalizeSide(value: string): 'buy' | 'sell' {
  const v = value.trim().toLowerCase()
  if (v === 'buy' || v === 'b' || v === '买入' || v === '证券买入') return 'buy'
  if (v === 'sell' || v === 's' || v === '卖出' || v === '证券卖出') return 'sell'
  // Log warning for unknown values instead of silently defaulting
  console.warn(`[csvParser] Unknown side value: "${value}", defaulting to "buy"`)
  return 'buy'
}

function parseNumber(value: string): number {
  const cleaned = value.replace(/[,，\s]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

export function mapAndValidate(
  preview: CsvPreview,
  mapping: ColumnMapping,
): { trades: ParsedTrade[]; errors: string[] } {
  const trades: ParsedTrade[] = []
  const errors: string[] = []

  const headerIndex = new Map<string, number>()
  preview.headers.forEach((h, i) => headerIndex.set(h.trim(), i))

  for (let i = 0; i < preview.rows.length; i++) {
    const row = preview.rows[i]
    const rowNum = i + 2

    const getVal = (field: string): string => {
      const idx = headerIndex.get(field)
      return idx !== undefined ? (row[idx]?.trim() ?? '') : ''
    }

    const tradeDate = getVal(mapping.tradeDate)
    const stockCode = getVal(mapping.stockCode)
    const sideRaw = getVal(mapping.side)
    const quantityRaw = getVal(mapping.quantity)
    const priceRaw = getVal(mapping.price)

    // Validate required fields
    if (!tradeDate) {
      errors.push(`行 ${rowNum}: 缺少成交日期`)
      continue
    }
    if (!stockCode || !/^\d{6}$/.test(stockCode.replace(/\s/g, ''))) {
      errors.push(`行 ${rowNum}: 证券代码无效 (${stockCode})`)
      continue
    }
    if (!sideRaw) {
      errors.push(`行 ${rowNum}: 缺少买卖方向`)
      continue
    }

    const quantity = parseNumber(quantityRaw)
    const price = parseNumber(priceRaw)
    if (quantity <= 0) {
      errors.push(`行 ${rowNum}: 数量无效 (${quantityRaw})`)
      continue
    }
    if (price <= 0) {
      errors.push(`行 ${rowNum}: 价格无效 (${priceRaw})`)
      continue
    }

    const side = normalizeSide(sideRaw)
    const grossAmount = parseNumber(getVal(mapping.grossAmount)) || quantity * price
    const commission = parseNumber(getVal(mapping.commission))
    const stampTax = parseNumber(getVal(mapping.stampTax))
    const transferFee = parseNumber(getVal(mapping.transferFee))
    const netAmount =
      parseNumber(getVal(mapping.netAmount)) || grossAmount - commission - stampTax - transferFee

    const raw: Record<string, string> = {}
    preview.headers.forEach((h, idx) => {
      raw[h] = row[idx] ?? ''
    })

    trades.push({
      tradeDate,
      stockCode: stockCode.replace(/\s/g, ''),
      stockName: getVal(mapping.stockName) || stockCode,
      side,
      quantity,
      price,
      grossAmount,
      commission,
      stampTax,
      transferFee,
      otherFee: 0,
      netAmount,
      raw,
      validationStatus: 'valid',
    })
  }

  return { trades, errors }
}
