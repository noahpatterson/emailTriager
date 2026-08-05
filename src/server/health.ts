import "server-only";
import { sql } from "drizzle-orm";
import type { Database } from "@/src/server/db";

/** Unauthenticated health body — never include secrets or error details. */
export type HealthBody = Readonly<{ ok: true }> | Readonly<{ ok: false }>;

/**
 * Build the health HTTP response from a database ping.
 * Success is `{ ok: true }` only after the ping resolves.
 */
export async function healthResponse(
  ping: () => Promise<void>,
): Promise<Response> {
  try {
    await ping();
    return Response.json({ ok: true } satisfies HealthBody, { status: 200 });
  } catch {
    return Response.json({ ok: false } satisfies HealthBody, { status: 503 });
  }
}

export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
