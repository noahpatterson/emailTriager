import "server-only";
import { withPgClient } from "@/src/server/db";
import type { RateLimitResult } from "@/src/server/demo/rate-limit";

/**
 * Durable sliding-window limiter backed by Postgres so Vercel serverless
 * instances share the same counters (unlike in-memory Maps).
 */
export async function consumeDurableRateLimit(options: {
  bucket: string;
  key: string;
  limit: number;
  windowMs: number;
  nowMs?: number;
}): Promise<RateLimitResult> {
  const { bucket, key, limit, windowMs } = options;
  const nowMs = options.nowMs ?? Date.now();
  const now = new Date(nowMs);
  const cutoff = new Date(nowMs - windowMs);

  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        `DELETE FROM demo_rate_limit_hit
         WHERE bucket = $1 AND ip_key = $2 AND hit_at <= $3`,
        [bucket, key, cutoff.toISOString()],
      );
      const { rows } = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM demo_rate_limit_hit
         WHERE bucket = $1 AND ip_key = $2 AND hit_at > $3`,
        [bucket, key, cutoff.toISOString()],
      );
      const count = Number(rows[0]?.count ?? 0);
      if (count >= limit) {
        await client.query("COMMIT");
        return { allowed: false, remaining: 0 };
      }
      await client.query(
        `INSERT INTO demo_rate_limit_hit (bucket, ip_key, hit_at) VALUES ($1, $2, $3)`,
        [bucket, key, now.toISOString()],
      );
      await client.query("COMMIT");
      return { allowed: true, remaining: limit - count - 1 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export const DEMO_SESSION_MINT_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 } as const;
export const DEMO_SYNC_LIMIT = { limit: 30, windowMs: 60 * 1000 } as const;
