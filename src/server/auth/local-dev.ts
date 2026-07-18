import "server-only";
import { cookies, headers } from "next/headers";
import {
  assertInsecureLocalDevRequest,
  LOCAL_DEV_SESSION_COOKIE,
} from "@/src/server/auth/local-dev-flags";

export {
  assertInsecureLocalDevAllowed,
  isInsecureLocalDevRequested,
  LOCAL_DEV_OWNER_ID_DEFAULT,
  LOCAL_DEV_SESSION_COOKIE,
} from "@/src/server/auth/local-dev-flags";

export type AuthSession = {
  data?: {
    user?: {
      id?: string;
      name?: string;
      email?: string;
    };
  } | null;
  error?: unknown;
};

async function assertLoopbackRequest(): Promise<void> {
  assertInsecureLocalDevRequest(await headers());
}

export async function getLocalDevSession(ownerId: string): Promise<AuthSession> {
  await assertLoopbackRequest();
  const jar = await cookies();
  if (jar.get(LOCAL_DEV_SESSION_COOKIE)?.value !== "1") {
    return { data: null };
  }
  return {
    data: {
      user: {
        id: ownerId,
        name: "Local Owner",
        email: "local-owner@localhost",
      },
    },
  };
}

export async function establishLocalDevSession(): Promise<void> {
  await assertLoopbackRequest();
  const jar = await cookies();
  jar.set(LOCAL_DEV_SESSION_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: false,
  });
}

export async function clearLocalDevSession(): Promise<void> {
  await assertLoopbackRequest();
  const jar = await cookies();
  jar.delete(LOCAL_DEV_SESSION_COOKIE);
}
