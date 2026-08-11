/**
 * Fetch with automatic timeout via AbortController.
 * @param url - The URL to fetch
 * @param ms - Timeout in milliseconds (default 10s)
 * @returns Promise<Response>
 */
export async function fetchWithTimeout(url: string, ms = 10_000, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
