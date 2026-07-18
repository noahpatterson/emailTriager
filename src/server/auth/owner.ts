import "server-only";
import { getServerConfig } from "@/src/config/server";
import { authorizeOwner } from "@/src/server/auth/authorize-owner";
import { getNeonAuth } from "@/src/server/auth/neon";

export async function requireOwner(): Promise<{ userId: string }> {
  const config = getServerConfig();
  return authorizeOwner(
    config.ownerNeonAuthUserId,
    () => getNeonAuth().getSession(),
  );
}
