import "server-only";
import { getServerConfig } from "@/src/config/server";
import { getLocalDevSession, type AuthSession } from "@/src/server/auth/local-dev";
import { getNeonAuth } from "@/src/server/auth/neon";

export type { AuthSession };

export async function getSession(): Promise<AuthSession> {
  const config = getServerConfig();
  if (config.insecureLocalDev) {
    return getLocalDevSession(config.ownerNeonAuthUserId);
  }
  return getNeonAuth().getSession();
}
