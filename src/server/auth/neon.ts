import "server-only";
import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";
import { getServerConfig } from "@/src/config/server";

let auth: NeonAuth | undefined;

export function getNeonAuth(): NeonAuth {
  if (!auth) {
    const config = getServerConfig();
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
