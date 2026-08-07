import "server-only";
import { getServerConfig } from "@/src/config/server";
import { authorizeOwner } from "@/src/server/auth/authorize-owner";
import { getSession } from "@/src/server/auth/session";
import { isDemoProfile } from "@/src/server/demo/ai-gate";
import { withDemoOwnerScope } from "@/src/server/db";

export async function requireOwner(): Promise<{ userId: string }> {
  if (isDemoProfile()) {
    const { data, error } = await getSession();
    const userId = data?.user?.id;
    if (error || !userId) throw new Error("Not found");
    return { userId };
  }
  const config = getServerConfig();
  return authorizeOwner(config.ownerNeonAuthUserId, () => getSession());
}

/** Authorize, then run under demo RLS scope when APP_PROFILE=demo. */
export async function withOwner<T>(run: (owner: { userId: string }) => Promise<T>): Promise<T> {
  const owner = await requireOwner();
  if (!isDemoProfile()) return run(owner);
  return withDemoOwnerScope(owner.userId, () => run(owner));
}
