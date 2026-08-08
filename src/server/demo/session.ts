import "server-only";
import { cookies } from "next/headers";
import { isDemoProfile } from "@/src/server/demo/ai-gate";
import {
  clearDemoSessionData,
  mintDemoSession,
  resolveDemoSessionOwner,
} from "@/src/server/demo/bootstrap";
import { assertDemoDatabaseRoleSafe } from "@/src/server/demo/assert-db-role";
import { checkDemoSessionMintLimit, recordDemoSessionMintHit } from "@/src/server/demo/limiters";
import {
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_TTL_MS,
} from "@/src/server/demo/session-token";
import type { AuthSession } from "@/src/server/auth/local-dev";

export async function getDemoSession(): Promise<AuthSession> {
  if (!isDemoProfile()) return { data: null };
  const jar = await cookies();
  const token = jar.get(DEMO_SESSION_COOKIE)?.value;
  if (!token) return { data: null };
  const ownerId = await resolveDemoSessionOwner(token);
  if (!ownerId) return { data: null };
  return {
    data: {
      user: {
        id: ownerId,
        name: "Demo visitor",
        email: "demo@localhost",
      },
    },
  };
}

export async function establishDemoSession(clientIp: string | null): Promise<{ ownerId: string }> {
  if (!isDemoProfile()) throw new Error("Demo sessions require APP_PROFILE=demo");
  await assertDemoDatabaseRoleSafe();
  const ipKey = clientIp?.trim() || "unknown";
  const limit = await checkDemoSessionMintLimit(ipKey);
  if (!limit.allowed) {
    throw new Error("Demo session rate limit exceeded. Try again later.");
  }
  const session = await mintDemoSession();
  const jar = await cookies();
  jar.set(DEMO_SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(DEMO_SESSION_TTL_MS / 1000),
  });
  await recordDemoSessionMintHit(ipKey);
  return { ownerId: session.ownerId };
}

export async function clearDemoSessionCookieAndData(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(DEMO_SESSION_COOKIE)?.value;
  jar.delete(DEMO_SESSION_COOKIE);
  if (!token) return;
  const ownerId = await resolveDemoSessionOwner(token);
  if (!ownerId) return;
  await clearDemoSessionData(ownerId, token);
}
