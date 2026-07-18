import "server-only";
import { getServerConfig } from "@/src/config/server";
import { authorizeOwner } from "@/src/server/auth/authorize-owner";
import { getSession } from "@/src/server/auth/session";

export async function requireOwner(): Promise<{ userId: string }> {
  const config = getServerConfig();
  return authorizeOwner(
    config.ownerNeonAuthUserId,
    () => getSession(),
  );
}
