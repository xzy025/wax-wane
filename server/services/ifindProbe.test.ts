import { describe, expect, it, vi } from 'vitest';
import {
  type IFindFetch,
  probeIFindCapabilities,
  readIFindConfigFromEnv,
  renderIFindCapabilityMatrix,
} from './ifindProbe';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('iFinD capability probe', () => {
  it('parses codes and Super Command supplied L2 indicators from env', () => {
    const config = readIFindConfigFromEnv({
      IFIND_CODES: '000001.sz, 600519.SH',
      IFIND_L2_INDICATORS: 'bid1,bid2,ask1,ask2',
      IFIND_TRADE_DATE: '2026-08-24',
      IFIND_TIMEOUT_MS: '5000',
      IFIND_REQUEST_GAP_MS: '10',
    });
    expect(config.codes).toEqual(['000001.SZ', '600519.SH']);
    expect(config.l2Indicators).toEqual(['bid1', 'bid2', 'ask1', 'ask2']);
    expect(config.tradeDate).toBe('2026-08-24');
    expect(config.timeoutMs).toBe(5000);
  });

  it('does not call the network when credentials are absent', async () => {
    const fetchImpl = vi.fn() as unknown as IFindFetch;
    const matrix = await probeIFindCapabilities({ fetchImpl, requestGapMs: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(matrix.results.map((result) => result.status)).toEqual(
      Array.from({ length: 13 }, () => 'not-configured'),
    );
  });

  it('refreshes a token and distinguishes permission errors from empty data', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl: IFindFetch = async (input, init) => {
      calls.push({ input, init });
      if (input.endsWith('/get_access_token')) return response({ data: { access_token: 'test-access-token' } });
      if (input.endsWith('/real_time_quotation')) return response({ data: [{ latest: 3863.17 }] });
      if (input.endsWith('/high_frequency')) return response({ errorcode: -201, errmsg: '无权限' });
      if (input.endsWith('/snap_shot') && JSON.stringify(init?.body).includes('bid10')) {
        return response({ data: [{ ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => ['bid' + (index + 1), 1])), ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => ['ask' + (index + 1), 1])), timestamp: '2026-08-24 15:00:00' }] });
      }
      return response({ tables: [] });
    };

    const matrix = await probeIFindCapabilities({
      refreshToken: 'test-refresh-token',
      codes: ['000001.SZ'],
      l2Indicators: ['bid1', 'bid2', 'bid3', 'bid4', 'bid5', 'bid6', 'bid7', 'bid8', 'bid9', 'bid10', 'ask1', 'ask2', 'ask3', 'ask4', 'ask5', 'ask6', 'ask7', 'ask8', 'ask9', 'ask10'],
      requestGapMs: 0,
      fetchImpl,
    });

    expect(calls[0].input).toContain('/get_access_token');
    expect(String(calls[0].init?.body)).not.toContain('test-refresh-token');
    expect(matrix.results.find((result) => result.capability === 'realtime-l1')?.status).toBe('available');
    expect(matrix.results.find((result) => result.capability === 'high-frequency')?.status).toBe('permission-denied');
    expect(matrix.results.find((result) => result.capability === 'intraday-snapshot')?.status).toBe('empty');
    expect(matrix.results.find((result) => result.capability === 'level-2-orderbook')?.status).toBe('available');
    expect(matrix.results.find((result) => result.capability === 'level-2-orderbook')?.level2Verified).toBe(true);
  });

  it('classifies non-empty invalid JSON as error', async () => {
    const fetchImpl: IFindFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => 'not-json',
    } as Response);
    const matrix = await probeIFindCapabilities({
      accessToken: 'test-access-token',
      requestGapMs: 0,
      fetchImpl,
    });
    expect(matrix.results.find((result) => result.capability === 'realtime-l1')?.status).toBe('error');
  });
  it('renders a manual Kimi evidence section without feeding scoring', async () => {
    const matrix = await probeIFindCapabilities({ requestGapMs: 0 });
    const markdown = renderIFindCapabilityMatrix(matrix);
    expect(markdown).toContain('fund-flow-ranking');
    expect(markdown).toContain('Kimi 人工交叉核验记录模板');
    expect(markdown).toContain('不修改连板天梯');
  });
});
