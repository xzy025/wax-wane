/**
 * Fetch with automatic timeout via AbortController.
 * @param url - The URL to fetch
 * @param ms - Timeout in milliseconds (default 10s)
 * @returns Promise<Response>
 */
export async function fetchWithTimeout(url: string, ms = 10_000, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const parentSignal = init.signal
  const abortFromParent = () => controller.abort()
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort()
    else parentSignal.addEventListener('abort', abortFromParent, { once: true })
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}
