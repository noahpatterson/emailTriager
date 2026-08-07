import "server-only";
import { getServerConfig } from "@/src/config/server";
import { getLocalDevSession, type AuthSession } from "@/src/server/auth/local-dev";
import { getNeonAuth } from "@/src/server/auth/neon";
import { isDemoProfile } from "@/src/server/demo/ai-gate";
import { getDemoSession } from "@/src/server/demo/session";

export type { AuthSession };

export async function getSession(): Promise<AuthSession> {
  if (isDemoProfile()) {
    return getDemoSession();
  }
  const config = getServerConfig();
  if (config.insecureLocalDev) {
    return getLocalDevSession(config.ownerNeonAuthUserId);
  }
  return getNeonAuth().getSession();
}
