import "server-only";
import { eq, sql } from "drizzle-orm";
import { ownerBinding } from "@/db/schema";
import type { Database } from "@/src/server/db";

/**
 * Ensure an owner_binding row exists for this owner (FK target).
 * Uses auth_user_id conflict target so the same path works in prod (unique)
 * and demo (PK after migrations-demo drops singleton).
 */
export async function ensureOwnerBinding(db: Database, ownerId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO owner_binding (auth_user_id) VALUES (${ownerId})
    ON CONFLICT (auth_user_id) DO NOTHING
  `);
  const [existing] = await db
    .select({ authUserId: ownerBinding.authUserId })
    .from(ownerBinding)
    .where(eq(ownerBinding.authUserId, ownerId))
    .limit(1);
  if (!existing) throw new Error("Owner binding missing after insert");
  if (existing.authUserId !== ownerId) throw new Error("Owner binding mismatch");
}
