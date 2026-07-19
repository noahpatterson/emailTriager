import { describe, expect, test } from "bun:test";
import { fetchWithRetry } from "../server/http/fetch-with-retry";

describe("bounded provider requests", () => {
  test("retries transient responses only up to the configured limit", async () => {
    let attempts = 0;
    const response = await fetchWithRetry(
      async () => {
        attempts += 1;
        return new Response(null, { status: 503 });
      },
      "https://example.test",
      {},
      { maxAttempts: 2 },
    );
    expect(response.status).toBe(503);
    expect(attempts).toBe(2);
  });

  test("does not retry permanent client errors", async () => {
    let attempts = 0;
    await fetchWithRetry(
      async () => {
        attempts += 1;
        return new Response(null, { status: 400 });
      },
      "https://example.test",
    );
    expect(attempts).toBe(1);
  });

  test("passes a finite abort signal to every request", async () => {
    let receivedSignal: AbortSignal | null = null;
    await fetchWithRetry(
      async (_input, init) => {
        receivedSignal = init?.signal ?? null;
        return new Response(null, { status: 200 });
      },
      "https://example.test",
      {},
      { timeoutMs: 50 },
    );
    expect(receivedSignal).not.toBeNull();
  });

  test("honors numeric Retry-After within the retry budget", async () => {
    let attempts = 0;
    const started = Date.now();
    await fetchWithRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(null, { status: 429, headers: { "retry-after": "1" } });
        }
        return new Response(null, { status: 200 });
      },
      "https://example.test",
      {},
      { maxAttempts: 2 },
    );
    expect(attempts).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  test("returns without retrying when Retry-After exceeds the retry budget", async () => {
    let attempts = 0;
    const response = await fetchWithRetry(
      async () => {
        attempts += 1;
        return new Response(null, { status: 429, headers: { "retry-after": "10" } });
      },
      "https://example.test",
      {},
      { maxAttempts: 3 },
    );
    expect(response.status).toBe(429);
    expect(attempts).toBe(1);
  });

  test("parses HTTP-date Retry-After values", async () => {
    let attempts = 0;
    // HTTP-dates are second-resolution; target far enough past backoff (100ms) and within budget.
    const when = new Date(Date.now() + 1_500).toUTCString();
    const started = Date.now();
    await fetchWithRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(null, { status: 503, headers: { "retry-after": when } });
        }
        return new Response(null, { status: 200 });
      },
      "https://example.test",
      {},
      { maxAttempts: 2 },
    );
    expect(attempts).toBe(2);
    // Must exceed exponential backoff (100ms), not merely parse as invalid.
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  });
});
