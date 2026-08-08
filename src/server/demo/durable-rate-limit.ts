import "server-only";
import { withPgClient } from "@/src/server/db";
import type { RateLimitResult } from "@/src/server/demo/rate-limit";

type DurableLimitOptions = Readonly<{
  bucket: string;
  key: string;
  limit: number;
  windowMs: number;
  nowMs?: number;
}>;

async function pruneAndCountWindow(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ count: string }> }> },
  bucket: string,
  key: string,
  cutoffIso: string,
): Promise<number> {
  await client.query(
    `DELETE FROM demo_rate_limit_hit
     WHERE bucket = $1 AND ip_key = $2 AND hit_at <= $3`,
    [bucket, key, cutoffIso],
  );
  const { rows } = await client.query(
    `SELECT COUNT(*)::text AS count FROM demo_rate_limit_hit
     WHERE bucket = $1 AND ip_key = $2 AND hit_at > $3`,
    [bucket, key, cutoffIso],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Read-only sliding-window check (no hit recorded).
 * Use before expensive work; call {@link recordDurableRateLimitHit} only on success.
 */
export async function checkDurableRateLimit(
  options: DurableLimitOptions,
): Promise<RateLimitResult> {
  const { bucket, key, limit, windowMs } = options;
  const nowMs = options.nowMs ?? Date.now();
  const cutoffIso = new Date(nowMs - windowMs).toISOString();

  return withPgClient(async (client) => {
    const count = await pruneAndCountWindow(client, bucket, key, cutoffIso);
    if (count >= limit) return { allowed: false, remaining: 0 };
    return { allowed: true, remaining: limit - count };
  });
}

/** Record a successful action against the sliding window. */
export async function recordDurableRateLimitHit(
  options: Omit<DurableLimitOptions, "limit" | "windowMs"> & { nowMs?: number },
): Promise<void> {
  const now = new Date(options.nowMs ?? Date.now());
  await withPgClient(async (client) => {
    await client.query(
      `INSERT INTO demo_rate_limit_hit (bucket, ip_key, hit_at) VALUES ($1, $2, $3)`,
      [options.bucket, options.key, now.toISOString()],
    );
  });
}

/**
 * Atomic check-and-record (for cheap paths like sync).
 * Prefer check + record-on-success when the limited action can fail after consume.
 */
export async function consumeDurableRateLimit(
  options: DurableLimitOptions,
): Promise<RateLimitResult> {
  const { bucket, key, limit, windowMs } = options;
  const nowMs = options.nowMs ?? Date.now();
  const now = new Date(nowMs);
  const cutoffIso = new Date(nowMs - windowMs).toISOString();

  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      const count = await pruneAndCountWindow(client, bucket, key, cutoffIso);
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

/** Per-IP demo session starts: 5 successful mints / hour. */
export const DEMO_SESSION_MINT_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;
export const DEMO_SYNC_LIMIT = { limit: 30, windowMs: 60 * 1000 } as const;
