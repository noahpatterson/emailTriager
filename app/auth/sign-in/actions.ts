"use server";

import { redirect } from "next/navigation";
import { getNeonAuth } from "@/src/server/auth/neon";

export type SignInState = Readonly<{ error: string | null }>;

export async function signIn(_state: SignInState, formData: FormData): Promise<SignInState> {
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
