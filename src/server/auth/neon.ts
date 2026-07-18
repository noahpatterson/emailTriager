import "server-only";
import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";
import { getServerConfig } from "@/src/config/server";

let auth: NeonAuth | undefined;

export function getNeonAuth(): NeonAuth {
  if (!auth) {
    const config = getServerConfig();
    if (config.insecureLocalDev) {
      throw new Error("Neon Auth is disabled when INSECURE_LOCAL_DEV=true");
    }
    if (!config.neonAuthBaseUrl || !config.neonAuthCookieSecret) {
      throw new Error("Neon Auth is not configured");
    }
    auth = createNeonAuth({
      baseUrl: config.neonAuthBaseUrl,
      cookies: {
        secret: config.neonAuthCookieSecret,
        // Lax is required so the OAuth challenge cookie is sent on the
        // top-level return navigation from Google → the app.
        sameSite: "lax",
      },
    });
  }
  return auth;
}
