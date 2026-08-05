import "server-only";
import { ownerBinding } from "@/db/schema";
import type { Database } from "@/src/server/db";

/** Ensure the singleton owner_binding row exists for this owner (FK target). */
export async function ensureOwnerBinding(db: Database, ownerId: string): Promise<void> {
  // Singleton row: concurrent first callers must not race on insert.
  await db
    .insert(ownerBinding)
    .values({ authUserId: ownerId })
    .onConflictDoNothing({ target: ownerBinding.singleton });
  const [existing] = await db
    .select({ authUserId: ownerBinding.authUserId })
    .from(ownerBinding)
    .limit(1);
  if (!existing) throw new Error("Owner binding missing after insert");
  if (existing.authUserId !== ownerId) throw new Error("Owner binding mismatch");
}
