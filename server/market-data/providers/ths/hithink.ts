import {
  readHithinkConnectionConfigFromEnv,
  type HithinkConnectionConfig,
} from './config'
import { createThsRuntime, type ThsRuntime } from './runtime'
import type { HithinkFetch, HithinkParams, HithinkResponse } from '../../hithinkFinanceClient'

export interface HithinkProvider {
  readonly runtime: ThsRuntime
  readonly client: {
    readonly isConfigured: boolean
    get<T = unknown>(endpoint: string, params?: HithinkParams): Promise<HithinkResponse<T>>
  }
  readonly connection: HithinkConnectionConfig
}

export function createHithinkProvider(options: {
  connection: HithinkConnectionConfig
  fetchImpl?: HithinkFetch
  sleepImpl?: (ms: number) => Promise<void>
  now?: () => number
}): HithinkProvider {
  const runtime = createThsRuntime(options)
  return { runtime, client: runtime, connection: options.connection }
}

let provider: HithinkProvider | undefined

export function getHithinkProvider(): HithinkProvider {
  provider ??= createHithinkProvider({ connection: readHithinkConnectionConfigFromEnv() })
  return provider
}
