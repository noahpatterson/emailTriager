import "server-only";
import { SlidingWindowRateLimiter } from "@/src/server/demo/rate-limit";

/** Conservative free-tier defaults — new demo sessions per IP. */
export const demoSessionMintLimiter = new SlidingWindowRateLimiter({
  limit: 10,
  windowMs: 60 * 60 * 1000,
});

/** Sync / trial POSTs per IP. */
export const demoSyncLimiter = new SlidingWindowRateLimiter({
  limit: 30,
  windowMs: 60 * 1000,
});
