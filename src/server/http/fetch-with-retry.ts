type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const MAX_RETRY_DELAY_MS = 2_000;

function parseRetryAfterMs(retryAfter: string): number | null {
  if (/^\d+$/u.test(retryAfter)) {
    return Number(retryAfter) * 1_000;
  }
  const when = Date.parse(retryAfter);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - Date.now());
}

function backoffDelayMs(attempt: number): number {
  return Math.min(100 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

/** Delay before the next attempt, or null when Retry-After exceeds the retry budget. */
function retryDelay(response: Response | null, attempt: number): number | null {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const delayMs = parseRetryAfterMs(retryAfter);
    if (delayMs !== null) {
      if (delayMs > MAX_RETRY_DELAY_MS) return null;
      return delayMs;
    }
  }
  return backoffDelayMs(attempt);
}

export async function fetchWithRetry(
  fetcher: Fetcher,
  input: string | URL | Request,
  init: RequestInit = {},
  options: Readonly<{ timeoutMs?: number; maxAttempts?: number }> = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const response = await fetcher(input, { ...init, signal });
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt === maxAttempts) return response;
      const delayMs = retryDelay(response, attempt);
      if (delayMs === null) return response;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || init.signal?.aborted) throw error;
      const delayMs = retryDelay(null, attempt);
      if (delayMs === null) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
