// 全局东财节流器(a-stock-data 移植计划②)。情报源:SKILL.md em_get()(L342-403)与
// 风控阈值表(L175-199):>5/s、单IP并发≥10、1min≥200、5min≥300 触发临时封禁,且
// datacenter/push2/push2his/push2ex/reportapi/search 全族共享一个风控面(封禁=IP级成片失联)。
//
// 职责边界(有意收窄):本模块只管 ①分级节流(quote 行情族/report 报表族) ②403 全域冷却
// 快速失败 ③429/5xx 有限重试(仅 GET)。镜像轮换/熔断(tripKlineHost)/响应解析/头注入
// 全部留在调用方——那是已被实战检验的第二层防线,且各调用点的失败返回形态(throw/[]/null)
// 是下游降级链的承重墙,这里绝不吞错、绝不改写 Response。
//
// 关键语义:
// - 超时从「出队真正发请求」起算(timeoutMs),排队等待不烧调用方的超时预算——否则
//   节流延迟会误触调用方 5s 熔断(如 fetchStockKline 的 tripKlineHost)。
// - 403 = 风控信号,永不重试(SKILL:重试无益反而加重);触发全局冷却,冷却期内直接抛
//   EmCooldownError,让调用方降级链(腾讯/新浪/serve-stale/镜像)立刻接管。
// - 非东财域名直通不记账(newsFlash 的 fetchJson 同时抓 cls/sina,误接进来也无害)。
// - 节流状态是进程级的:backtest/optimize CLI 是独立进程,各有各的账本,与 dev server
//   并跑时仍可能叠加——跑重回测前先停服务或调大间隔。
//
// 默认节奏是「压平尖峰」而非照抄 SKILL 1s 串行:全市场扫描(~1200 次K线)实测 27/s 存活
// 数周、约每周被掐一次;1s 串行会把 30-60s 扫描拖到 20 分钟。取中:quote 60ms 起点间隔
// (≈16/s 上限)+并发 8(<风控并发10);report 250ms+并发 2。全部 env 可调,回测等批量
// 场景可用 EM_QUOTE_GAP_MS/EM_REPORT_GAP_MS 加严。

export type EmHostClass = 'quote' | 'report'

/** 按域名分级:quote=push2 行情族(含数字镜像/delay/his/ex),report=其余东财域(数据中心
 *  报表/热榜/快讯/搜索/研报 PDF)。非东财域返回 null(直通不节流)。 */
export function classifyEmHost(url: string): EmHostClass | null {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  const isEm = /(^|\.)eastmoney\.com$/.test(host) || /(^|\.)dfcfw\.com$/.test(host)
  if (!isEm) return null
  return /(^|\.)push2[a-z]*\.eastmoney\.com$/.test(host) ? 'quote' : 'report'
}

export interface EmFetchConfig {
  quoteGapMs: number
  quoteConc: number
  reportGapMs: number
  reportConc: number
  /** 403 触发的全域冷却时长。 */
  cooloffMs: number
  /** 429/5xx/网络错误的追加重试次数(仅 GET;403 与调用方主动中止永不重试)。 */
  retries: number
  /** 调用方未给 timeoutMs 时的兜底超时(东财域必有超时,直通域不强加)。 */
  defaultTimeoutMs: number
}

function envNum(name: string, def: number, min = 0): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v >= min ? v : def
}

function loadConfig(): EmFetchConfig {
  return {
    quoteGapMs: envNum('EM_QUOTE_GAP_MS', 60), // 行情族请求起点最小间隔(全局共享)
    quoteConc: envNum('EM_QUOTE_CONC', 8, 1), // 在飞上限,压在风控并发阈值 10 之下;0 会永久悬挂,拒收
    reportGapMs: envNum('EM_REPORT_GAP_MS', 250), // 报表族低频,接近 SKILL 串行精神
    reportConc: envNum('EM_REPORT_CONC', 2, 1),
    cooloffMs: envNum('EM_COOLOFF_MS', 60_000),
    retries: envNum('EM_RETRIES', 1),
    defaultTimeoutMs: envNum('EM_TIMEOUT_MS', 10_000, 1), // 0 = 即时中止一切请求,拒收
  }
}

/** 冷却期内的快速失败。调用方按普通 fetch 异常处理即可(全部调用点已有 try/catch 降级)。 */
export class EmCooldownError extends Error {
  constructor(remainMs: number) {
    super(`EM 风控冷却中(剩 ${Math.ceil(remainMs / 1000)}s),快速失败交由调用方降级`)
    this.name = 'EmCooldownError'
  }
}

export interface EmFetchInit extends RequestInit {
  /** 单次请求超时,从真正发出请求时起算(非入队时)。 */
  timeoutMs?: number
}

export interface EmFetchDeps {
  now(): number
  sleep(ms: number): Promise<void>
  random(): number
  fetchImpl: typeof fetch
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504])

interface ClassState {
  nextFreeAt: number
  active: number
  waiters: Array<() => void>
}

export function createEmFetch(cfg?: Partial<EmFetchConfig>, deps?: Partial<EmFetchDeps>) {
  const d: EmFetchDeps = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: () => Math.random(),
    fetchImpl: fetch,
    ...deps,
  }
  // 惰性读 env:lib 模块在 index.ts 的 dotenv.config() 之前求值,模块作用域读 env 会漏 .env
  let config: EmFetchConfig | null = null
  const getConfig = (): EmFetchConfig => (config ??= { ...loadConfig(), ...cfg })

  const state: Record<EmHostClass, ClassState> = {
    quote: { nextFreeAt: 0, active: 0, waiters: [] },
    report: { nextFreeAt: 0, active: 0, waiters: [] },
  }
  let cooldownUntil = 0

  function checkCooldown(): void {
    const remain = cooldownUntil - d.now()
    if (remain > 0) throw new EmCooldownError(remain)
  }

  async function acquire(cls: EmHostClass): Promise<void> {
    const c = getConfig()
    const s = state[cls]
    const conc = cls === 'quote' ? c.quoteConc : c.reportConc
    const gap = cls === 'quote' ? c.quoteGapMs : c.reportGapMs
    if (s.active >= conc) {
      // 槽位由 release 转让,醒来即持有,不再自增(否则唤醒与新进者竞态会超并发上限)
      await new Promise<void>((resolve) => s.waiters.push(resolve))
    } else {
      s.active++
    }
    // 起点间隔:预约下一空位;抖动仅在真的需要等待时追加(SKILL 同款语义)
    const now = d.now()
    const at = Math.max(now, s.nextFreeAt)
    s.nextFreeAt = at + gap
    const jitter = at > now ? d.random() * gap * 0.5 : 0
    const wait = at + jitter - now
    if (wait > 0) await d.sleep(wait)
  }

  function release(cls: EmHostClass): void {
    const s = state[cls]
    const waiter = s.waiters.shift()
    if (waiter) waiter()
    else s.active--
  }

  function withTimeout(caller: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
    const t = AbortSignal.timeout(timeoutMs)
    return caller ? AbortSignal.any([caller, t]) : t
  }

  async function emFetch(url: string, init: EmFetchInit = {}): Promise<Response> {
    const { timeoutMs, signal, ...rest } = init
    const cls = classifyEmHost(url)
    if (!cls) {
      // 非东财域直通:不记账、不强加超时(调用方给了 timeoutMs 才补)
      return d.fetchImpl(url, {
        ...rest,
        signal: timeoutMs ? withTimeout(signal, timeoutMs) : signal,
      })
    }
    const c = getConfig()
    const method = (rest.method ?? 'GET').toUpperCase()
    const maxAttempts = method === 'GET' ? 1 + c.retries : 1
    let lastErr: unknown
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await d.sleep(600 * 2 ** (attempt - 1) + d.random() * 200) // 0.6s 起指数退避,不占并发槽
      }
      checkCooldown()
      await acquire(cls)
      try {
        checkCooldown() // 排队期间可能已进入冷却
        const res = await d.fetchImpl(url, {
          ...rest,
          signal: withTimeout(signal, timeoutMs ?? c.defaultTimeoutMs),
        })
        if (res.status === 403) {
          // 风控信号:挂全域冷却,原样返回(调用方自有 !ok 分支),绝不重试
          if (d.now() >= cooldownUntil) {
            console.warn(`[emFetch] HTTP 403 风控信号(${new URL(url).hostname}),全域冷却 ${Math.round(c.cooloffMs / 1000)}s`)
          }
          cooldownUntil = d.now() + c.cooloffMs
          return res
        }
        if (RETRY_STATUS.has(res.status) && attempt < maxAttempts - 1) {
          lastErr = new Error(`HTTP ${res.status}`)
          void res.body?.cancel().catch(() => {}) // 释放连接,别占 Keep-Alive 池
          continue
        }
        return res
      } catch (e) {
        if (e instanceof EmCooldownError) throw e
        if (signal?.aborted) throw e // 调用方主动中止,不是网络问题
        lastErr = e // 超时/连接错误:可重试(仅 GET,配额内)
      } finally {
        release(cls)
      }
    }
    throw lastErr
  }

  /** 探针/调试用只读快照。 */
  function debugState() {
    return {
      cooldownUntil,
      quote: { active: state.quote.active, queued: state.quote.waiters.length },
      report: { active: state.report.active, queued: state.report.waiters.length },
    }
  }

  return { emFetch, debugState }
}

// 进程级单例:首次调用才实例化(此时 dotenv 已加载)
let defaultInstance: ReturnType<typeof createEmFetch> | null = null

/** 所有东财 HTTP 调用的统一入口。用法:把 `fetch(url, { headers, signal: AbortSignal.timeout(X) })`
 *  换成 `emFetch(url, { headers, timeoutMs: X })`;其余 RequestInit(method/body/headers)原样透传。 */
export function emFetch(url: string, init?: EmFetchInit): Promise<Response> {
  defaultInstance ??= createEmFetch()
  return defaultInstance.emFetch(url, init)
}

/** 单例节流账本快照(探针/诊断)。 */
export function emFetchDebugState() {
  defaultInstance ??= createEmFetch()
  return defaultInstance.debugState()
}
