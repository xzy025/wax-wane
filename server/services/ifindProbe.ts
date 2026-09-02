import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const IFIND_DEFAULT_BASE_URL = 'https://quantapi.51ifind.com/api/v1';
export const IFIND_DEFAULT_TIMEOUT_MS = 12_000;
export const IFIND_DEFAULT_REQUEST_GAP_MS = 350;
export const IFIND_CAPABILITY_MATRIX_JSON = 'ifind-capability-matrix.json';
export const IFIND_CAPABILITY_MATRIX_MD = 'ifind-capability-matrix.md';

export type IFindCapability =
  | 'stock-info'
  | 'realtime-l1'
  | 'financial-statements'
  | 'historical-price'
  | 'financial-index'
  | 'holder-info'
  | 'forecast'
  | 'business-segmentation'
  | 'announcement'
  | 'high-frequency'
  | 'intraday-snapshot'
  | 'level-2-orderbook'
  | 'fund-flow-ranking';

export type IFindProbeStatus =
  | 'available'
  | 'permission-denied'
  | 'unsupported'
  | 'empty'
  | 'error'
  | 'not-configured';

export type IFindJsonObject = Record<string, unknown>;

export interface IFindProbeRequest {
  id: string;
  capability: IFindCapability;
  endpoint: string;
  body: IFindJsonObject;
  fields?: string[];
  note?: string;
  skipReason?: string;
}

export interface IFindProbeResult {
  id: string;
  capability: IFindCapability;
  endpoint: string;
  source: 'ifind-http-api';
  sourceTier: 'shadow';
  status: IFindProbeStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  httpStatus?: number;
  fields: string[];
  codes: string[];
  responseShape?: string;
  sample?: unknown;
  level2Verified?: boolean;
  errorCode?: string;
  message?: string;
  note?: string;
}

export interface IFindCapabilityMatrix {
  generatedAt: string;
  source: 'ifind-http-api';
  sourceTier: 'shadow';
  codes: string[];
  tradeDate?: string;
  results: IFindProbeResult[];
  notes: string[];
}

export interface IFindConfigFromEnv {
  baseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  codes: string[];
  tradeDate?: string;
  startTime: string;
  endTime: string;
  timeoutMs: number;
  requestGapMs: number;
  l2Indicators: string[];
}

export interface IFindProbeOptions {
  baseUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  codes?: string[];
  tradeDate?: string;
  startTime?: string;
  endTime?: string;
  timeoutMs?: number;
  requestGapMs?: number;
  fetchImpl?: IFindFetch;
  now?: () => Date;
  customRequests?: IFindProbeRequest[];
  l2Indicators?: string[];
}

export interface IFindHttpResponse {
  httpStatus: number;
  ok: boolean;
  body: unknown;
  rawText: string;
  jsonParsed: boolean;
}

export type IFindFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export class IFindConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IFindConfigurationError';
  }
}

export interface IFindClient {
  readonly isConfigured: boolean;
  ensureAccessToken(): Promise<string>;
  request(endpoint: string, body: IFindJsonObject): Promise<IFindHttpResponse>;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new IFindConfigurationError(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseCsv(value: string | undefined): string[] {
  return value
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
}

function validateCodes(codes: string[]): string[] {
  const normalized = [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
  if (normalized.length === 0) {
    throw new IFindConfigurationError('IFIND_CODES must contain at least one symbol');
  }
  for (const code of normalized) {
    if (!/^\d{6}\.(SH|SZ|BJ)$/.test(code)) {
      throw new IFindConfigurationError(`Invalid iFinD code: ${code}; use e.g. 000001.SZ`);
    }
  }
  return normalized;
}

function validateDate(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new IFindConfigurationError(`${name} must use YYYY-MM-DD`);
  }
  return value;
}

function normalizeBaseUrl(value: string | undefined): string {
  const candidate = value ?? IFIND_DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new IFindConfigurationError(`Invalid IFIND_BASE_URL: ${candidate}`);
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    throw new IFindConfigurationError('IFIND_BASE_URL must use HTTPS, except for localhost tests');
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

export function readIFindConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IFindConfigFromEnv {
  const envValue = (name: string): string | undefined => env[name]?.trim() || undefined;
  const codes = validateCodes(parseCsv(envValue('IFIND_CODES')).length > 0
    ? parseCsv(envValue('IFIND_CODES'))
    : ['000001.SZ', '600519.SH']);
  const l2Indicators = parseCsv(envValue('IFIND_L2_INDICATORS'));
  return {
    baseUrl: normalizeBaseUrl(envValue('IFIND_BASE_URL')),
    accessToken: envValue('IFIND_ACCESS_TOKEN'),
    refreshToken: envValue('IFIND_REFRESH_TOKEN'),
    codes,
    tradeDate: validateDate(envValue('IFIND_TRADE_DATE'), 'IFIND_TRADE_DATE'),
    startTime: envValue('IFIND_START_TIME') ?? '09:30:00',
    endTime: envValue('IFIND_END_TIME') ?? '15:00:00',
    timeoutMs: parsePositiveInt(envValue('IFIND_TIMEOUT_MS'), IFIND_DEFAULT_TIMEOUT_MS, 'IFIND_TIMEOUT_MS'),
    requestGapMs: parsePositiveInt(envValue('IFIND_REQUEST_GAP_MS'), IFIND_DEFAULT_REQUEST_GAP_MS, 'IFIND_REQUEST_GAP_MS'),
    l2Indicators,
  };
}

function redactSecrets(value: string, secrets: Array<string | undefined>): string {
  return secrets.filter((secret): secret is string => Boolean(secret)).reduce(
    (result: string, secret: string) => result.split(secret).join('[REDACTED]'),
    value,
  );
}

function buildUrl(baseUrl: string, endpoint: string): string {
  if (!endpoint || endpoint.includes('://') || endpoint.includes('?')) {
    throw new IFindConfigurationError(`Invalid iFinD endpoint: ${endpoint}`);
  }
  return `${baseUrl}/${endpoint.replace(/^\/+/, '')}`;
}

function createAbortSignal(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

async function parseResponseBody(response: Response): Promise<{ body: unknown; rawText: string; jsonParsed: boolean }> {
  const rawText = await response.text();
  if (!rawText.trim()) return { body: undefined, rawText, jsonParsed: true };
  try {
    return { body: JSON.parse(rawText) as unknown, rawText, jsonParsed: true };
  } catch {
    return { body: rawText, rawText, jsonParsed: false };
  }
}

export function createIFindClient(options: {
  baseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  timeoutMs?: number;
  fetchImpl?: IFindFetch;
}): IFindClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? IFIND_DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  let accessToken = options.accessToken?.trim() || undefined;
  let tokenPromise: Promise<string> | undefined;
  const isConfigured = Boolean(accessToken || options.refreshToken?.trim());

  const ensureAccessToken = async (): Promise<string> => {
    if (accessToken) return accessToken;
    if (!options.refreshToken?.trim()) {
      throw new IFindConfigurationError('Missing IFIND_ACCESS_TOKEN or IFIND_REFRESH_TOKEN');
    }
    if (tokenPromise) return tokenPromise;
    tokenPromise = (async () => {
      const abort = createAbortSignal(timeoutMs);
      try {
        const response = await fetchImpl(buildUrl(baseUrl, 'get_access_token'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            refresh_token: options.refreshToken as string,
          },
          signal: abort.signal,
        });
        const parsed = await parseResponseBody(response);
        const candidate = parsed.body && typeof parsed.body === 'object'
          ? (parsed.body as IFindJsonObject).access_token
            ?? ((parsed.body as IFindJsonObject).data as IFindJsonObject | undefined)?.access_token
          : undefined;
        if (!response.ok || typeof candidate !== 'string' || !candidate) {
          throw new Error(redactSecrets(
            `iFinD access token request failed (${response.status}): ${parsed.rawText.slice(0, 300)}`,
            [options.refreshToken],
          ));
        }
        accessToken = candidate;
        return candidate;
      } finally {
        abort.dispose();
      }
    })();
    try {
      return await tokenPromise;
    } catch (error) {
      tokenPromise = undefined;
      throw error;
    }
  };

  const request = async (endpoint: string, body: IFindJsonObject): Promise<IFindHttpResponse> => {
    const token = await ensureAccessToken();
    const abort = createAbortSignal(timeoutMs);
    try {
      const response = await fetchImpl(buildUrl(baseUrl, endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: token,
        },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      const parsed = await parseResponseBody(response);
      return {
        httpStatus: response.status,
        ok: response.ok && response.status < 400,
        body: parsed.body,
        rawText: parsed.rawText,
        jsonParsed: parsed.jsonParsed,
      };
    } finally {
      abort.dispose();
    }
  };

  return { isConfigured, ensureAccessToken, request };
}

function codesBody(codes: string[]): string {
  return codes.join(',');
}

export function buildIFindProbeRequests(options: {
  codes: string[];
  tradeDate?: string;
  startTime: string;
  endTime: string;
  l2Indicators?: string[];
  customRequests?: IFindProbeRequest[];
}): IFindProbeRequest[] {
  const codes = validateCodes(options.codes);
  const custom = options.customRequests ?? [];
  const hasCustomCapability = (capability: IFindCapability) => custom.some((item) => item.capability === capability);
  const requests: IFindProbeRequest[] = [
    {
      id: 'realtime-l1',
      capability: 'realtime-l1',
      endpoint: 'real_time_quotation',
      body: {
        codes: codesBody(codes),
        indicators: 'latest,bid1,ask1,bidSize1,askSize1',
      },
      fields: ['latest', 'bid1', 'ask1', 'bidSize1', 'askSize1'],
      note: 'L1 quotation and one-level bid/ask probe.',
    },
    {
      id: 'high-frequency-1m',
      capability: 'high-frequency',
      endpoint: 'high_frequency',
      body: {
        codes: codesBody(codes),
        indicators: 'open,high,low,close,volume,amount,changeRatio',
        starttime: options.tradeDate ? `${options.tradeDate} ${options.startTime}` : options.startTime,
        endtime: options.tradeDate ? `${options.tradeDate} ${options.endTime}` : options.endTime,
        interval: '1m',
      },
      fields: ['open', 'high', 'low', 'close', 'volume', 'amount', 'changeRatio'],
      note: 'High-frequency interval is supplied as a research probe; confirm account granularity in the returned data.',
    },
    {
      id: 'intraday-snapshot-l1',
      capability: 'intraday-snapshot',
      endpoint: 'snap_shot',
      body: {
        codes: codesBody(codes),
        indicators: 'open,high,low,latest,bid1,ask1,bidSize1,askSize1',
        starttime: options.tradeDate ? `${options.tradeDate} ${options.startTime}` : options.startTime,
        endtime: options.tradeDate ? `${options.tradeDate} ${options.endTime}` : options.endTime,
      },
      fields: ['open', 'high', 'low', 'latest', 'bid1', 'ask1', 'bidSize1', 'askSize1'],
      note: 'Intraday snapshot L1 probe.',
    },
  ];

  const l2Indicators = options.l2Indicators?.filter(Boolean) ?? [];
  if (l2Indicators.length > 0 && !hasCustomCapability('level-2-orderbook')) {
    requests.push({
      id: 'level-2-orderbook',
      capability: 'level-2-orderbook',
      endpoint: 'snap_shot',
      body: { codes: codesBody(codes), indicators: l2Indicators.join(',') },
      fields: l2Indicators,
      note: 'Indicators must be copied from the official Super Command; ten levels and a timestamp are required for an L2 conclusion.',
    });
  } else if (!hasCustomCapability('level-2-orderbook')) {
    requests.push({
      id: 'level-2-orderbook',
      capability: 'level-2-orderbook',
      endpoint: 'snap_shot',
      body: {},
      fields: [],
      skipReason: 'No official Super Command indicator list supplied; no L2 indicator IDs were guessed.',
    });
  }

  if (!hasCustomCapability('fund-flow-ranking')) {
    requests.push({
      id: 'fund-flow-ranking',
      capability: 'fund-flow-ranking',
      endpoint: 'custom',
      body: {},
      fields: [],
      skipReason: 'Fund-flow and ranking indicators must be generated and verified with the official Super Command before probing.',
    });
  }

  // Kimi-verified capabilities (shadow tier): placeholders until official HTTP endpoints are confirmed.
  const kimiVerifiedCapabilities: Array<{ capability: IFindCapability; id: string; note: string }> = [
    { capability: 'stock-info', id: 'stock-info', note: 'Kimi verified via plugin; official HTTP endpoint not yet confirmed.' },
    { capability: 'financial-statements', id: 'financial-statements', note: 'Kimi verified via plugin; official HTTP endpoint not yet confirmed.' },
    { capability: 'historical-price', id: 'historical-price', note: 'Kimi verified via plugin; official HTTP endpoint not yet confirmed.' },
    { capability: 'financial-index', id: 'financial-index', note: 'Kimi verified via plugin; official HTTP endpoint not yet confirmed.' },
    { capability: 'holder-info', id: 'holder-info', note: 'Kimi verified via plugin; official HTTP endpoint not yet confirmed.' },
    { capability: 'forecast', id: 'forecast', note: 'Kimi verified via plugin; official HTTP endpoint not yet confirmed.' },
    { capability: 'business-segmentation', id: 'business-segmentation', note: 'Kimi verified via plugin; official HTTP endpoint not yet confirmed.' },
    { capability: 'announcement', id: 'announcement', note: 'Kimi verified via plugin; official HTTP endpoint not yet confirmed.' },
  ];
  for (const item of kimiVerifiedCapabilities) {
    if (!hasCustomCapability(item.capability)) {
      requests.push({
        id: item.id,
        capability: item.capability,
        endpoint: 'not-confirmed',
        body: {},
        fields: [],
        skipReason: item.note,
      });
    }
  }

  return [...requests, ...custom];
}
function isObject(value: unknown): value is IFindJsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findErrorValue(body: unknown): unknown {
  if (!isObject(body)) return undefined;
  return body.errorcode ?? body.errorCode ?? body.code;
}

function findMessage(body: unknown): string | undefined {
  if (typeof body === 'string') return body.slice(0, 500);
  if (!isObject(body)) return undefined;
  const value = body.errmsg ?? body.errorMsg ?? body.message ?? body.msg ?? body.error;
  return typeof value === 'string' ? value.slice(0, 500) : undefined;
}

function hasText(value: string | undefined, patterns: RegExp[]): boolean {
  return Boolean(value && patterns.some((pattern) => pattern.test(value)));
}

function classifyIFindStatus(response: IFindHttpResponse): IFindProbeStatus {
  const message = findMessage(response.body) ?? response.rawText;
  if (!response.jsonParsed && response.rawText.trim()) return 'error';
  if (response.httpStatus === 401 || response.httpStatus === 403 || hasText(message, [/无权限/i, /permission/i, /未授权/i, /授权/i])) {
    return 'permission-denied';
  }
  if (response.httpStatus === 404 || hasText(message, [/unsupported/i, /not support/i, /不存在/i, /不支持/i])) {
    return 'unsupported';
  }
  if (response.httpStatus === 429) return 'error';
  if (!response.ok) return 'error';
  const errorValue = findErrorValue(response.body);
  if (typeof errorValue === 'number' && errorValue !== 0) {
    return hasText(message, [/无权限/i, /permission/i, /未授权/i, /授权/i]) ? 'permission-denied' : 'error';
  }
  if (isEmptyPayload(response.body)) return 'empty';
  return 'available';
}

function isEmptyPayload(body: unknown): boolean {
  if (body === undefined || body === null) return true;
  if (Array.isArray(body)) return body.length === 0;
  if (!isObject(body)) return false;
  const candidates = ['data', 'tables', 'table', 'result', 'results'];
  for (const key of candidates) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === undefined || value === null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (isObject(value)) return Object.keys(value).length === 0;
  }
  return false;
}

function responseShape(value: unknown, depth = 0): string {
  if (depth > 2) return '…';
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `array[${value.length}]${value.length ? `<${responseShape(value[0], depth + 1)}>` : ''}`;
  if (isObject(value)) {
    const keys = Object.keys(value).slice(0, 12);
    return `{${keys.map((key) => `${key}:${responseShape(value[key], depth + 1)}`).join(', ')}}`;
  }
  return typeof value;
}

function sampleResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 2).map((item) => sampleResponse(item));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).slice(0, 12).map(([key, item]) => [key, sampleResponse(item)]));
  }
  if (typeof value === 'string') return value.slice(0, 300);
  return value;
}

function extractCodes(body: IFindJsonObject): string[] {
  const value = body.codes ?? body.thscode ?? body.code;
  if (typeof value === 'string') return parseCsv(value);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function errorCodeString(body: unknown): string | undefined {
  const value = findErrorValue(body);
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return undefined;
}

function verifyLevel2Response(body: unknown): boolean {
  const serialized = JSON.stringify(body).toLowerCase();
  const levelNumbers = (side: 'bid' | 'ask'): Set<number> => {
    const pattern = side === 'bid' ? /(?:bid|buy)[a-z_]*(\d{1,2})/g : /(?:ask|sell)[a-z_]*(\d{1,2})/g;
    return new Set(Array.from(serialized.matchAll(pattern), (match) => Number(match[1])));
  };
  const bidLevels = levelNumbers('bid');
  const askLevels = levelNumbers('ask');
  const hasAllTen = (levels: Set<number>) => Array.from({ length: 10 }, (_, index) => index + 1).every((level) => levels.has(level));
  const hasTimestamp = /"(?:timestamp|datetime|date_time|time)"\s*:/.test(serialized);
  return hasAllTen(bidLevels) && hasAllTen(askLevels) && hasTimestamp;
}

function toIso(now: () => Date): string {
  return now().toISOString();
}

function notConfiguredResult(request: IFindProbeRequest, now: () => Date, codes: string[]): IFindProbeResult {
  const timestamp = toIso(now);
  return {
    id: request.id,
    capability: request.capability,
    endpoint: request.endpoint,
    source: 'ifind-http-api',
    sourceTier: 'shadow',
    status: 'not-configured',
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: 0,
    fields: request.fields ?? [],
    codes,
    note: request.skipReason ?? 'No iFinD access token or refresh token was configured.',
  };
}

export async function probeIFindCapabilities(options: IFindProbeOptions = {}): Promise<IFindCapabilityMatrix> {
  const now = options.now ?? (() => new Date());
  const config: IFindConfigFromEnv = {
    baseUrl: normalizeBaseUrl(options.baseUrl),
    accessToken: options.accessToken,
    refreshToken: options.refreshToken,
    codes: validateCodes(options.codes ?? ['000001.SZ', '600519.SH']),
    tradeDate: validateDate(options.tradeDate, 'tradeDate'),
    startTime: options.startTime ?? '09:30:00',
    endTime: options.endTime ?? '15:00:00',
    timeoutMs: options.timeoutMs ?? IFIND_DEFAULT_TIMEOUT_MS,
    requestGapMs: options.requestGapMs ?? IFIND_DEFAULT_REQUEST_GAP_MS,
    l2Indicators: options.l2Indicators ?? [],
  };
  const requests = buildIFindProbeRequests({ ...config, customRequests: options.customRequests });
  const client = createIFindClient({ ...config, fetchImpl: options.fetchImpl });
  const results: IFindProbeResult[] = [];

  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    if (request.skipReason || !client.isConfigured) {
      results.push(notConfiguredResult(request, now, config.codes));
      continue;
    }
    if (index > 0 && config.requestGapMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, config.requestGapMs));
    const startedAt = toIso(now);
    const startMs = Date.now();
    try {
      const response = await client.request(request.endpoint, request.body);
      const finishedAt = toIso(now);
      const message = findMessage(response.body);
      const status = classifyIFindStatus(response);
      const level2Verified = request.capability === 'level-2-orderbook'
        ? status === 'available' && verifyLevel2Response(response.body)
        : undefined;
      results.push({
        id: request.id,
        capability: request.capability,
        endpoint: request.endpoint,
        source: 'ifind-http-api',
        sourceTier: 'shadow',
        status,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, Date.now() - startMs),
        httpStatus: response.httpStatus,
        fields: request.fields ?? [],
        codes: extractCodes(request.body).length > 0 ? extractCodes(request.body) : config.codes,
        responseShape: responseShape(response.body),
        sample: sampleResponse(response.body),
        level2Verified,
        errorCode: errorCodeString(response.body),
        message,
        note: request.capability === 'level-2-orderbook' && !level2Verified
          ? 'Endpoint responded, but it does not prove ten bid/ask levels plus a timestamp; treat it as L1/未验证。'
          : request.note,
      });
    } catch (error) {
      const finishedAt = toIso(now);
      const message = redactSecrets(error instanceof Error ? error.message : String(error), [config.accessToken, config.refreshToken]);
      results.push({
        id: request.id,
        capability: request.capability,
        endpoint: request.endpoint,
        source: 'ifind-http-api',
        sourceTier: 'shadow',
        status: error instanceof IFindConfigurationError ? 'not-configured' : 'error',
        startedAt,
        finishedAt,
        durationMs: Math.max(0, Date.now() - startMs),
        fields: request.fields ?? [],
        codes: config.codes,
        message,
        note: request.note,
      });
    }
  }

  return {
    generatedAt: toIso(now),
    source: 'ifind-http-api',
    sourceTier: 'shadow',
    codes: config.codes,
    tradeDate: config.tradeDate,
    results,
    notes: [
      'This matrix is shadow research only; it does not feed ladder scoring, candidate ranking, or promotion-rate statistics.',
      'permission-denied, unsupported, empty, and error are distinct outcomes; none is converted to a zero value.',
      'A Level-2 conclusion requires at least bid/ask ten levels and a timestamp in the same response.',
      'Fund-flow or ranking evidence must state scope, timestamp, unit, and intraday/after-close nature before use.',
    ],
  };
}

function escapeMarkdown(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderIFindCapabilityMatrix(matrix: IFindCapabilityMatrix): string {
  const lines = [
    '# iFinD 能力探针矩阵（shadow）',
    '',
    `生成时间：${matrix.generatedAt}`,
    `标的：${matrix.codes.join(', ')}`,
    `交易日：${matrix.tradeDate ?? '未指定'}`,
    '',
    '> 本文件只记录研究探针结果，不修改连板天梯、候选规则、评分权重或晋级率统计。',
    '',
    '| 能力 | 状态 | HTTP | 字段 | 形状 | 说明 |',
    '| --- | --- | ---: | --- | --- | --- |',
    ...matrix.results.map((result) => [
      result.capability,
      result.status,
      result.httpStatus === undefined ? '' : String(result.httpStatus),
      result.fields.join(', '),
      result.responseShape ?? '',
      result.message ?? result.note ?? '',
    ].map(escapeMarkdown).join(' | ')).map((line) => `| ${line} |`),
    '',
    '## 判定备注',
    '',
    ...matrix.notes.map((note) => `- ${note}`),
    '',
    '## Kimi 人工交叉核验记录模板',
    '',
    '| 查询日期 | 候选 | 查询问题 | 返回时间/口径 | 排名范围 | 单位 | 原始来源 | 结论（不回写评分） |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '|  |  | 独家资金排行/主力动向/异常盘口/行业资金排名 |  |  |  |  |  |',
    '',
    'Kimi 结果只作为人工研究校验层；必须保存时间、口径、范围、单位和来源，不能把自然语言结论直接写入战法统计。',
    '',
  ];
  return lines.join('\n');
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, content, 'utf8');
    try {
      await rename(temporary, target);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
      await rm(target, { force: true });
      await rename(temporary, target);
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function writeIFindCapabilityMatrix(root: string, matrix: IFindCapabilityMatrix): Promise<{ jsonPath: string; markdownPath: string }> {
  const jsonPath = resolve(root, IFIND_CAPABILITY_MATRIX_JSON);
  const markdownPath = resolve(root, IFIND_CAPABILITY_MATRIX_MD);
  await writeAtomic(jsonPath, `${JSON.stringify(matrix, null, 2)}\n`);
  await writeAtomic(markdownPath, renderIFindCapabilityMatrix(matrix));
  return { jsonPath, markdownPath };
}

function capabilityValue(value: unknown): value is IFindCapability {
  return value === 'stock-info'
    || value === 'realtime-l1'
    || value === 'financial-statements'
    || value === 'historical-price'
    || value === 'financial-index'
    || value === 'holder-info'
    || value === 'forecast'
    || value === 'business-segmentation'
    || value === 'announcement'
    || value === 'high-frequency'
    || value === 'intraday-snapshot'
    || value === 'level-2-orderbook'
    || value === 'fund-flow-ranking';
}

export async function readIFindRequestFile(path: string): Promise<IFindProbeRequest[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const entries = Array.isArray(raw) ? raw : isObject(raw) ? raw.requests : undefined;
  if (!Array.isArray(entries)) throw new IFindConfigurationError('iFinD request file must be an array or an object with a requests array');
  return entries.map((entry, index) => {
    if (!isObject(entry) || typeof entry.id !== 'string' || !capabilityValue(entry.capability)
      || typeof entry.endpoint !== 'string' || !isObject(entry.body)) {
      throw new IFindConfigurationError(`Invalid iFinD request at index ${index}`);
    }
    const fields = entry.fields === undefined
      ? undefined
      : Array.isArray(entry.fields) && entry.fields.every((field) => typeof field === 'string')
        ? entry.fields
        : undefined;
    if (entry.fields !== undefined && fields === undefined) {
      throw new IFindConfigurationError(`Invalid fields at iFinD request index ${index}`);
    }
    return {
      id: entry.id,
      capability: entry.capability,
      endpoint: entry.endpoint,
      body: entry.body,
      fields,
      note: typeof entry.note === 'string' ? entry.note : undefined,
    };
  });
}
