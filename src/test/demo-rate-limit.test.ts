import { describe, expect, test } from "bun:test";
import { SlidingWindowRateLimiter } from "@/src/server/demo/rate-limit";

describe("demo per-IP rate limiter", () => {
  test("allows requests under the limit within the window", () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 3, windowMs: 60_000 });
    const at = 1_000_000;
    expect(limiter.consume("1.2.3.4", at)).toEqual({ allowed: true, remaining: 2 });
    expect(limiter.consume("1.2.3.4", at + 1)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume("1.2.3.4", at + 2)).toEqual({ allowed: true, remaining: 0 });
  });

  test("rejects when the limit is exceeded for the same IP", () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 60_000 });
    const at = 2_000_000;
    expect(limiter.consume("10.0.0.1", at).allowed).toBe(true);
    expect(limiter.consume("10.0.0.1", at + 1).allowed).toBe(true);
    expect(limiter.consume("10.0.0.1", at + 2)).toEqual({ allowed: false, remaining: 0 });
  });

  test("tracks IPs independently", () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 60_000 });
    const at = 3_000_000;
    expect(limiter.consume("a", at).allowed).toBe(true);
    expect(limiter.consume("b", at).allowed).toBe(true);
    expect(limiter.consume("a", at + 1).allowed).toBe(false);
    expect(limiter.consume("b", at + 1).allowed).toBe(false);
  });

  test("expires old hits so the window slides", () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 1_000 });
    const at = 4_000_000;
    expect(limiter.consume("9.9.9.9", at).allowed).toBe(true);
    expect(limiter.consume("9.9.9.9", at + 500).allowed).toBe(false);
    expect(limiter.consume("9.9.9.9", at + 1_001).allowed).toBe(true);
  });
});
