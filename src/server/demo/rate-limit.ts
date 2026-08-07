export type RateLimitResult = Readonly<{
  allowed: boolean;
  remaining: number;
}>;

export type SlidingWindowRateLimiterOptions = Readonly<{
  limit: number;
  windowMs: number;
}>;

/** In-memory sliding-window limiter for demo abuse control (per process). */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly options: SlidingWindowRateLimiterOptions) {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new Error("rate limit must be a positive integer");
    }
    if (!Number.isInteger(options.windowMs) || options.windowMs < 1) {
      throw new Error("rate windowMs must be a positive integer");
    }
  }

  consume(key: string, nowMs: number = Date.now()): RateLimitResult {
    const cutoff = nowMs - this.options.windowMs;
    const prior = this.hits.get(key) ?? [];
    const recent = prior.filter((t) => t > cutoff);
    if (recent.length >= this.options.limit) {
      this.hits.set(key, recent);
      return { allowed: false, remaining: 0 };
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    return { allowed: true, remaining: this.options.limit - recent.length };
  }
}
