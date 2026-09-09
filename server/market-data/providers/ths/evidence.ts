import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { HithinkParams } from '../../hithinkFinanceClient'

export const THS_EVIDENCE_SCHEMA_VERSION = 'ths-evidence-v1'

export interface ThsResponseCapture {
  adapter: 'stock-research' | 'market-research'
  dataset: string
  endpoint: string
  params: HithinkParams
  requestId: string | null
  receivedAt: string
  rawBytes: Uint8Array
}

export interface ThsEvidenceManifest {
  schemaVersion: typeof THS_EVIDENCE_SCHEMA_VERSION
  adapterVersion: 'ths-provider-v1'
  capturedAt: string
  captures: Array<Omit<ThsResponseCapture, 'rawBytes' | 'params'> & {
    params: Record<string, string | number | boolean | null>
    rawFile: string
    rawHash: string
  }>
}

function sanitizeParams(params: HithinkParams): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(params).flatMap(([key, value]) => {
    if (/key|token|secret|authorization/i.test(key) || value === undefined) return []
    return [[key, value ?? null] as const]
  }))
}

function rawHash(rawBytes: Uint8Array): string {
  return createHash('sha256').update(rawBytes).digest('hex')
}

/** Writes each raw response once. Existing evidence is never overwritten. */
export async function writeThsEvidence(folder: string, captures: readonly ThsResponseCapture[]): Promise<ThsEvidenceManifest> {
  await mkdir(folder, { recursive: true })
  const manifest: ThsEvidenceManifest = {
    schemaVersion: THS_EVIDENCE_SCHEMA_VERSION,
    adapterVersion: 'ths-provider-v1',
    capturedAt: new Date().toISOString(),
    captures: [],
  }
  for (const [index, capture] of captures.entries()) {
    const rawFile = `raw-${String(index + 1).padStart(3, '0')}.json`
    await writeFile(resolve(folder, rawFile), capture.rawBytes, { flag: 'wx' })
    manifest.captures.push({
      adapter: capture.adapter,
      dataset: capture.dataset,
      endpoint: capture.endpoint,
      params: sanitizeParams(capture.params),
      requestId: capture.requestId,
      receivedAt: capture.receivedAt,
      rawFile,
      rawHash: rawHash(capture.rawBytes),
    })
  }
  await writeFile(resolve(folder, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return manifest
}

/** Refuse altered, missing, or path-traversal raw evidence before replay. */
export async function readVerifiedThsEvidence(folder: string): Promise<Array<{ capture: ThsEvidenceManifest['captures'][number]; rawBytes: Uint8Array }>> {
  const manifest = JSON.parse(await readFile(resolve(folder, 'manifest.json'), 'utf8')) as ThsEvidenceManifest
  if (manifest.schemaVersion !== THS_EVIDENCE_SCHEMA_VERSION || !Array.isArray(manifest.captures)) {
    throw new Error('Unsupported THS evidence manifest')
  }
  return Promise.all(manifest.captures.map(async (capture) => {
    if (!/^raw-\d{3}\.json$/.test(capture.rawFile)) throw new Error('Invalid THS evidence raw-file path')
    const rawBytes = await readFile(resolve(folder, capture.rawFile))
    if (rawHash(rawBytes) !== capture.rawHash) throw new Error(`THS evidence hash mismatch: ${capture.rawFile}`)
    return { capture, rawBytes }
  }))
}
