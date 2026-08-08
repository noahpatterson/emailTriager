"use server";

import { redirect } from "next/navigation";
import { getServerConfig } from "@/src/config/server";
import {
  clearLocalDevSession,
  establishLocalDevSession,
} from "@/src/server/auth/local-dev";
import { getNeonAuth } from "@/src/server/auth/neon";
import { clearDemoSessionCookieAndData } from "@/src/server/demo/session";

export type SignInState = Readonly<{ error: string | null }>;

export async function continueAsLocalOwner(): Promise<void> {
  const config = getServerConfig();
  if (!config.insecureLocalDev) {
    throw new Error("Local owner sign-in is only available in insecure local mode");
  }
  await establishLocalDevSession();
  redirect("/");
}

export async function signOutLocalOwner(): Promise<void> {
  const config = getServerConfig();
  if (!config.insecureLocalDev) {
    throw new Error("Local sign-out is only available in insecure local mode");
  }
  await clearLocalDevSession();
  redirect("/auth/sign-in");
}

export async function signOutDemoVisitor(): Promise<void> {
  const config = getServerConfig();
  if (!config.demoProfile) {
    throw new Error("Demo sign-out is only available when APP_PROFILE=demo");
  }
  await clearDemoSessionCookieAndData();
  redirect("/auth/sign-in");
}

export async function signIn(_state: SignInState, formData: FormData): Promise<SignInState> {
  if (getServerConfig().demoProfile) {
    return { error: "Use Start demo session in the public demo." };
  }
  if (getServerConfig().insecureLocalDev) {
    return { error: "Use Continue as local owner in insecure local mode." };
  }

  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  const email = typeof emailValue === "string" ? emailValue.trim() : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";

  if (!email || !password) return { error: "Enter your email and password." };

  const result = await getNeonAuth().signIn.email({
    email,
    password,
    callbackURL: "/",
  });

  if (result.error) {
    return { error: result.error.message ?? "Unable to sign in. Check your email and password." };
  }

  redirect(result.data?.url ?? "/");
}
