import React, { useCallback, useRef, useState } from 'react'
import { CaretRight, File, UploadSimple, CheckCircle, Warning } from 'phosphor-react'
import {
  parseFile,
  mapAndValidate,
  STANDARD_FIELDS,
  type CsvPreview,
  type ColumnMapping,
} from '../engine/csvParser'
import { buildTradeGroups } from '../engine/tradeGroup'
import { validateTrades, getPositionQuantities } from '../engine/position'
import { useAppState, useAppDispatch } from '../store'
import { fmt } from '../i18n'
import type { Translation } from '../types'

interface ImportViewProps {
  t: Translation
}

type ImportStep = 'upload' | 'mapping' | 'preview' | 'done'

export default function ImportView({ t }: ImportViewProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<ImportStep>('upload')
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({
    tradeDate: '',
    stockCode: '',
    stockName: '',
    side: '',
    quantity: '',
    price: '',
    grossAmount: '',
    commission: '',
    stampTax: '',
    transferFee: '',
    netAmount: '',
  })
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [importResult, setImportResult] = useState<{ count: number; errors: number } | null>(null)
  const dispatch = useAppDispatch()
  const { trades } = useAppState()

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      try {
        const result = await parseFile(file)
        setPreview(result)
        // Auto-detect column mapping
        const autoMapping: ColumnMapping = { ...mapping }
        for (const field of STANDARD_FIELDS) {
          const match = result.headers.find((h) => {
            const lower = h.toLowerCase()
            if (field.key === 'tradeDate') return lower.includes('日期') || lower.includes('date')
            if (field.key === 'stockCode') return lower.includes('代码') || lower.includes('code')
            if (field.key === 'stockName') return lower.includes('名称') || lower.includes('name')
            if (field.key === 'side')
              return lower.includes('方向') || lower.includes('side') || lower.includes('买卖')
            if (field.key === 'quantity')
              return lower.includes('数量') || lower.includes('qty') || lower.includes('quantity')
            if (field.key === 'price') return lower.includes('价格') || lower.includes('price')
            if (field.key === 'grossAmount')
              return lower.includes('金额') || lower.includes('amount')
            if (field.key === 'commission')
              return (
                lower.includes('佣金') || lower.includes('commission') || lower.includes('手续费')
              )
            if (field.key === 'stampTax') return lower.includes('印花') || lower.includes('stamp')
            if (field.key === 'transferFee')
              return lower.includes('过户') || lower.includes('transfer')
            if (field.key === 'netAmount') return lower.includes('实收') || lower.includes('net')
            return false
          })
          if (match) autoMapping[field.key] = match
        }
        setMapping(autoMapping)
        setStep('mapping')
      } catch (err) {
        alert(fmt(t.import.parseFailed, err instanceof Error ? err.message : t.import.unknownError))
      }
    },
    [mapping],
  )

  const handleImport = useCallback(() => {
    if (!preview) return
    const { trades: parsed, errors } = mapAndValidate(preview, mapping)
    setValidationErrors(errors)

    if (parsed.length > 0) {
      const existingPositions = getPositionQuantities(trades)
      const validated = validateTrades(parsed, existingPositions)
      dispatch({ type: 'ADD_TRADES', payload: validated })
      // Rebuild trade groups from all trades
      const allTrades = [...trades, ...validated]
      const groups = buildTradeGroups(allTrades)
      dispatch({ type: 'SET_TRADE_GROUPS', payload: groups })
      dispatch({
        type: 'ADD_IMPORT_BATCH',
        payload: {
          id: `batch-${Date.now()}`,
          filename: 'import.csv',
          importedAt: new Date().toISOString(),
          rowCount: preview.totalRows,
          status: errors.length > 0 ? 'draft' : 'imported',
        },
      })
      setImportResult({ count: parsed.length, errors: errors.length })
      setStep('done')
    }
  }, [preview, mapping, dispatch, trades])

  const handleReset = useCallback(() => {
    setStep('upload')
    setPreview(null)
    setValidationErrors([])
    setImportResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  return (
    <div className="content-grid import-grid">
      <article className="panel upload-panel">
        <div className="upload-box">
          {step === 'upload' ? (
            <>
              <UploadSimple size={34} aria-hidden="true" />
              <h2>{t.import.uploadTitle}</h2>
              <p>{t.import.uploadDesc}</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
              <button
                className="primary-button"
                type="button"
                onClick={() => fileRef.current?.click()}
              >
                <File size={18} aria-hidden="true" />
                {t.import.selectFile}
              </button>
            </>
          ) : step === 'mapping' ? (
            <>
              <CheckCircle size={34} style={{ color: 'var(--blue)' }} />
              <h2>{fmt(t.import.parsedTitle, preview?.totalRows ?? 0)}</h2>
              <p>{t.import.parsedDesc}</p>
              <button className="primary-button" type="button" onClick={handleImport}>
                {t.import.confirmImport}
              </button>
            </>
          ) : step === 'done' ? (
            <>
              <CheckCircle size={34} style={{ color: 'var(--red)' }} />
              <h2>{t.import.doneTitle}</h2>
              <p>
                {fmt(t.import.doneCount, importResult?.count ?? 0)}
                {importResult?.errors ? fmt(t.import.doneWarnings, importResult.errors) : ''}
              </p>
              <button className="text-button" type="button" onClick={handleReset}>
                {t.import.importMore}
              </button>
            </>
          ) : null}
        </div>
      </article>

      <article className="panel">
        <div className="panel-title">
          <div>
            <h2>{t.import.pipelineTitle}</h2>
            <p>{t.import.pipelineDesc}</p>
          </div>
        </div>
        <div className="step-list">
          {t.import.steps.map(([title, text], index) => {
            const isActive =
              (step === 'upload' && index === 0) ||
              (step === 'mapping' && index <= 1) ||
              (step === 'done' && true)
            return (
              <div className="step-item" key={title} style={{ opacity: isActive ? 1 : 0.5 }}>
                <span>{index + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
              </div>
            )
          })}
        </div>
      </article>

      {step === 'mapping' && preview && (
        <article className="panel wide">
          <div className="panel-title">
            <div>
              <h2>{t.import.columnMappingTitle}</h2>
              <p>{t.import.columnMappingDesc}</p>
            </div>
          </div>
          <div className="mapping-grid">
            {STANDARD_FIELDS.map((field) => (
              <div className="mapping-row" key={field.key}>
                <span>{field.label}</span>
                <CaretRight size={16} aria-hidden="true" />
                <select
                  value={mapping[field.key]}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  style={{
                    padding: '6px 8px',
                    border: '1px solid var(--line)',
                    borderRadius: '6px',
                    background: 'var(--surface-soft)',
                    fontWeight: 600,
                  }}
                >
                  <option value="">{t.import.noColumnSelected}</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <small>{field.required ? t.import.required : t.import.optional}</small>
              </div>
            ))}
          </div>

          {preview.rows.length > 0 && (
            <div style={{ marginTop: '18px' }}>
              <h3 style={{ marginBottom: '10px', fontSize: '0.95rem' }}>{t.import.previewTitle}</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                  <thead>
                    <tr>
                      {preview.headers.map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: '8px',
                            borderBottom: '1px solid var(--line)',
                            textAlign: 'left',
                            color: 'var(--muted)',
                            fontWeight: 800,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {validationErrors.length > 0 && (
            <div
              style={{
                marginTop: '14px',
                padding: '12px',
                borderRadius: '8px',
                background: 'var(--red-soft)',
                color: 'var(--red)',
              }}
            >
              <strong>{fmt(t.import.validationWarnings, validationErrors.length)}</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>
                {validationErrors.slice(0, 10).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
                {validationErrors.length > 10 && (
                  <li>{fmt(t.import.moreWarnings, validationErrors.length - 10)}</li>
                )}
              </ul>
            </div>
          )}
        </article>
      )}

      {step === 'upload' && (
        <article className="panel wide">
          <div className="panel-title">
            <div>
              <h2>{t.import.mappingTitle}</h2>
              <p>{t.import.mappingDesc}</p>
            </div>
          </div>
          <div className="mapping-grid">
            {t.import.mappingRows.map(([source, target, status]) => (
              <div className="mapping-row" key={target}>
                <span>{source}</span>
                <CaretRight size={16} aria-hidden="true" />
                <strong>{target}</strong>
                <small>{status}</small>
              </div>
            ))}
          </div>
        </article>
      )}
    </div>
  )
}
