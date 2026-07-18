type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const MAX_RETRY_DELAY_MS = 2_000;

function retryDelay(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter && /^\d+$/u.test(retryAfter)) {
    return Math.min(Number(retryAfter) * 1_000, MAX_RETRY_DELAY_MS);
  }
  return Math.min(100 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
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
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || init.signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelay(null, attempt)));
    }
  }
  throw lastError;
}
