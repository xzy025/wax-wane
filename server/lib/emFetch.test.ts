import { describe, it, expect } from 'vitest'
import { classifyEmHost, createEmFetch, EmCooldownError, type EmFetchDeps } from './emFetch'

// 时间/睡眠全注入(仓库约定:不用 fake timers)。sleep 立即返回并推进假时钟,
// 因此节流等待不阻塞测试,只留下可断言的 sleeps 轨迹。
function makeClock() {
  let t = 0
  const sleeps: number[] = []
  const deps: Partial<EmFetchDeps> = {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
    random: () => 0,
  }
  return { deps, sleeps, advance: (ms: number) => (t += ms) }
}

const ok = () => new Response('{}', { status: 200 })
const status = (code: number) => new Response(null, { status: code })
const flush = () => new Promise((r) => setImmediate(r))

const QUOTE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600000'
const REPORT_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_X'

describe('classifyEmHost', () => {
  it('push2 行情族(含数字镜像/delay/his/ex)归 quote', () => {
    for (const h of [
      'push2.eastmoney.com',
      'push2his.eastmoney.com',
      'push2ex.eastmoney.com',
      'push2delay.eastmoney.com',
      '82.push2.eastmoney.com',
      '1.push2his.eastmoney.com',
    ]) {
      expect(classifyEmHost(`https://${h}/api/x`)).toBe('quote')
    }
  })
  it('其余东财域归 report(含 http 明文与 dfcfw PDF)', () => {
    for (const u of [
      'https://datacenter-web.eastmoney.com/api/data/v1/get',
      'http://datacenter-web.eastmoney.com/api/data/v1/get',
      'https://datacenter.eastmoney.com/securities/api/data/v1/get',
      'https://emappdata.eastmoney.com/stockrank/getAllCurrentList',
      'https://np-weblist.eastmoney.com/comm/web/getFastNewsList',
      'https://searchapi.eastmoney.com/api/suggest/get',
      'https://search-api-web.eastmoney.com/search/jsonp',
      'https://reportapi.eastmoney.com/report/list',
      'https://pdf.dfcfw.com/pdf/H3_X_1.pdf',
    ]) {
      expect(classifyEmHost(u)).toBe('report')
    }
  })
  it('非东财域与畸形 URL 返回 null', () => {
    expect(classifyEmHost('https://qt.gtimg.cn/q=sh600000')).toBeNull()
    expect(classifyEmHost('https://hq.sinajs.cn/list=sh600000')).toBeNull()
    expect(classifyEmHost('https://www.cls.cn/v1/roll')).toBeNull()
    expect(classifyEmHost('https://fakeeastmoney.com/x')).toBeNull() // 后缀伪装不放行
    expect(classifyEmHost('not a url')).toBeNull()
  })
})

describe('起点间隔节流', () => {
  it('同类第二个请求等满 gap,不同类互不占用', async () => {
    const { deps, sleeps } = makeClock()
    let calls = 0
    const { emFetch } = createEmFetch(
      { quoteGapMs: 100, reportGapMs: 300, quoteConc: 8, reportConc: 2, retries: 0 },
      { ...deps, fetchImpl: (async () => (calls++, ok())) as typeof fetch },
    )
    await emFetch(QUOTE_URL)
    expect(sleeps).toEqual([]) // 首发不等待
    await emFetch(QUOTE_URL)
    expect(sleeps).toEqual([100]) // 距上次起点不足 gap,补齐
    await emFetch(REPORT_URL)
    expect(sleeps).toEqual([100]) // report 账本独立,首发不受 quote 影响
    expect(calls).toBe(3)
  })

  it('需要等待时按 random 追加抖动(≤gap/2)', async () => {
    const { deps, sleeps } = makeClock()
    deps.random = () => 1 // 抖动拉满
    const { emFetch } = createEmFetch(
      { quoteGapMs: 100, quoteConc: 8, retries: 0 },
      { ...deps, fetchImpl: (async () => ok()) as typeof fetch },
    )
    await emFetch(QUOTE_URL)
    await emFetch(QUOTE_URL)
    expect(sleeps).toEqual([150]) // gap 100 + jitter 50
  })
})

describe('并发槽', () => {
  it('超出并发上限的请求排队,前序 settle 后转让槽位', async () => {
    const { deps } = makeClock()
    const pending: Array<(r: Response) => void> = []
    const { emFetch } = createEmFetch(
      { quoteGapMs: 0, quoteConc: 1, retries: 0 },
      { ...deps, fetchImpl: (() => new Promise<Response>((r) => pending.push(r))) as typeof fetch },
    )
    const p1 = emFetch(QUOTE_URL)
    const p2 = emFetch(QUOTE_URL)
    await flush()
    expect(pending.length).toBe(1) // 第二个还在排队,没发出去
    pending[0](ok())
    await p1
    await flush()
    expect(pending.length).toBe(2) // 槽位转让,第二个才发出
    pending[1](ok())
    await p2
  })
})

describe('并发槽 · 异常路径', () => {
  it('fetch 抛异常时槽位照常转让,排队请求不挂死', async () => {
    const { deps } = makeClock()
    const pending: Array<{ resolve: (r: Response) => void; reject: (e: unknown) => void }> = []
    const { emFetch } = createEmFetch(
      { quoteGapMs: 0, quoteConc: 1, retries: 0 },
      {
        ...deps,
        fetchImpl: (() =>
          new Promise<Response>((resolve, reject) => pending.push({ resolve, reject }))) as typeof fetch,
      },
    )
    const p1 = emFetch(QUOTE_URL)
    const p2 = emFetch(QUOTE_URL)
    await flush()
    expect(pending.length).toBe(1)
    pending[0].reject(new TypeError('fetch failed')) // 第一个网络失败(retries=0 → 直接抛)
    await expect(p1).rejects.toThrow('fetch failed')
    await flush()
    expect(pending.length).toBe(2) // 槽位在 finally 转让,第二个照常发出
    pending[1].resolve(ok())
    expect((await p2).status).toBe(200)
  })

  it('超时从出队起算:排队等待不烧 timeoutMs 预算(真实计时器)', async () => {
    // 唯一用真实时钟的用例:AbortSignal.timeout 走真实计时器,注入时钟看不见它。
    // 若超时信号在入队时创建(而非出队),p2 排队 60ms > 预算 30ms,出队时信号已过期。
    const pending: Array<(r: Response) => void> = []
    const dispatched: Array<AbortSignal | null | undefined> = []
    const { emFetch } = createEmFetch(
      { quoteGapMs: 0, quoteConc: 1, retries: 0 },
      {
        fetchImpl: ((_u: unknown, init?: RequestInit) => {
          dispatched.push(init?.signal)
          return new Promise<Response>((r) => pending.push(r))
        }) as typeof fetch,
      },
    )
    const p1 = emFetch(QUOTE_URL)
    const p2 = emFetch(QUOTE_URL, { timeoutMs: 30 })
    await new Promise((r) => setTimeout(r, 60)) // p2 在队列里熬过自己的全部预算
    pending[0](ok())
    await p1
    await flush() // 槽位转让 → p2 出队
    expect(dispatched.length).toBe(2)
    expect(dispatched[1]?.aborted).toBe(false) // 预算从出队才起算 → 信号未过期
    pending[1](ok())
    expect((await p2).status).toBe(200)
  })
})

describe('403 风控冷却', () => {
  it('403 原样返回且挂全域冷却;冷却期内快速失败;过期后恢复', async () => {
    const { deps, advance } = makeClock()
    let calls = 0
    const { emFetch } = createEmFetch(
      { quoteGapMs: 0, quoteConc: 8, cooloffMs: 60_000, retries: 1 },
      { ...deps, fetchImpl: (async () => (calls++ === 0 ? status(403) : ok())) as typeof fetch },
    )
    const res = await emFetch(QUOTE_URL)
    expect(res.status).toBe(403) // 原样返回,调用方自有 !ok 分支
    expect(calls).toBe(1) // 绝不重试 403
    await expect(emFetch(QUOTE_URL)).rejects.toBeInstanceOf(EmCooldownError)
    await expect(emFetch(REPORT_URL)).rejects.toBeInstanceOf(EmCooldownError) // 冷却是全域的
    expect(calls).toBe(1) // 快速失败没碰网络
    advance(60_001)
    expect((await emFetch(QUOTE_URL)).status).toBe(200)
  })

  it('排队期间进入冷却的请求,出队时二次检查也快速失败', async () => {
    const { deps } = makeClock()
    const pending: Array<(r: Response) => void> = []
    const { emFetch } = createEmFetch(
      { quoteGapMs: 0, quoteConc: 1, cooloffMs: 60_000, retries: 0 },
      { ...deps, fetchImpl: (() => new Promise<Response>((r) => pending.push(r))) as typeof fetch },
    )
    const p1 = emFetch(QUOTE_URL)
    const p2 = emFetch(QUOTE_URL) // 排在并发槽后面
    await flush()
    pending[0](status(403)) // 第一个拿到 403 → 全域冷却
    expect((await p1).status).toBe(403)
    await expect(p2).rejects.toBeInstanceOf(EmCooldownError)
    expect(pending.length).toBe(1) // 第二个从未发出
  })
})

describe('重试策略', () => {
  it('5xx 指数退避重试(仅 GET),重试也过节流', async () => {
    const { deps, sleeps } = makeClock()
    let calls = 0
    const { emFetch } = createEmFetch(
      { quoteGapMs: 100, quoteConc: 8, retries: 1 },
      { ...deps, fetchImpl: (async () => (calls++ === 0 ? status(502) : ok())) as typeof fetch },
    )
    const res = await emFetch(QUOTE_URL)
    expect(res.status).toBe(200)
    expect(calls).toBe(2)
    expect(sleeps).toContain(600) // 首次退避 0.6s(random=0)
  })

  it('网络错误重试;配额耗尽抛最后一个错误', async () => {
    const { deps } = makeClock()
    let calls = 0
    const boom = new TypeError('fetch failed')
    const { emFetch } = createEmFetch(
      { quoteGapMs: 0, quoteConc: 8, retries: 1 },
      { ...deps, fetchImpl: (async () => (calls++, Promise.reject(boom))) as unknown as typeof fetch },
    )
    await expect(emFetch(QUOTE_URL)).rejects.toBe(boom)
    expect(calls).toBe(2) // 1 原始 + 1 重试
  })

  it('POST 不重试:5xx 原样返回', async () => {
    const { deps } = makeClock()
    let calls = 0
    const { emFetch } = createEmFetch(
      { reportGapMs: 0, reportConc: 2, retries: 2 },
      { ...deps, fetchImpl: (async () => (calls++, status(500))) as typeof fetch },
    )
    const res = await emFetch(REPORT_URL, { method: 'POST', body: '{}' })
    expect(res.status).toBe(500)
    expect(calls).toBe(1)
  })

  it('末次尝试的 5xx 原样返回(与改造前"无重试直接给调用方"语义一致)', async () => {
    const { deps } = makeClock()
    const { emFetch } = createEmFetch(
      { quoteGapMs: 0, quoteConc: 8, retries: 1 },
      { ...deps, fetchImpl: (async () => status(503)) as typeof fetch },
    )
    const res = await emFetch(QUOTE_URL)
    expect(res.status).toBe(503)
  })

  it('调用方主动中止不重试', async () => {
    const { deps } = makeClock()
    let calls = 0
    const ac = new AbortController()
    ac.abort()
    const { emFetch } = createEmFetch(
      { quoteGapMs: 0, quoteConc: 8, retries: 2 },
      {
        ...deps,
        fetchImpl: (async () => {
          calls++
          throw new DOMException('aborted', 'AbortError')
        }) as unknown as typeof fetch,
      },
    )
    await expect(emFetch(QUOTE_URL, { signal: ac.signal })).rejects.toThrow('aborted')
    expect(calls).toBe(1)
  })
})

describe('直通与超时注入', () => {
  it('非东财域直通:不节流不记账,未给 timeoutMs 不强加 signal', async () => {
    const { deps, sleeps } = makeClock()
    const seen: Array<RequestInit | undefined> = []
    const { emFetch } = createEmFetch(
      { quoteGapMs: 100, quoteConc: 1 },
      {
        ...deps,
        fetchImpl: (async (_u: unknown, init?: RequestInit) => (seen.push(init), ok())) as typeof fetch,
      },
    )
    await emFetch('https://qt.gtimg.cn/q=sh600000')
    await emFetch('https://qt.gtimg.cn/q=sz000001')
    expect(sleeps).toEqual([]) // 连打两发也不排队
    expect(seen[0]?.signal ?? null).toBeNull()
  })

  it('东财域必带超时 signal(timeoutMs 或默认值,从发出时起算)', async () => {
    const { deps } = makeClock()
    const seen: Array<RequestInit | undefined> = []
    const { emFetch } = createEmFetch(
      { quoteGapMs: 0, quoteConc: 8, retries: 0 },
      {
        ...deps,
        fetchImpl: (async (_u: unknown, init?: RequestInit) => (seen.push(init), ok())) as typeof fetch,
      },
    )
    await emFetch(QUOTE_URL, { timeoutMs: 5000 })
    await emFetch(QUOTE_URL)
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(seen[1]?.signal).toBeInstanceOf(AbortSignal) // 默认兜底超时
  })

  it('method/body/headers 原样透传(hotlist emappdata POST 场景)', async () => {
    const { deps } = makeClock()
    let seen: RequestInit | undefined
    const { emFetch } = createEmFetch(
      { reportGapMs: 0, reportConc: 2 },
      {
        ...deps,
        fetchImpl: (async (_u: unknown, init?: RequestInit) => ((seen = init), ok())) as typeof fetch,
      },
    )
    await emFetch('https://emappdata.eastmoney.com/stockrank/getAllCurrentList', {
      method: 'POST',
      body: '{"appId":"appId01"}',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(seen?.method).toBe('POST')
    expect(seen?.body).toBe('{"appId":"appId01"}')
    expect((seen?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})
