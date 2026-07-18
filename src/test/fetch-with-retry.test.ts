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
});
