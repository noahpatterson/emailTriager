"use client";

import { useActionState, useState, useTransition } from "react";
import { authClient } from "@/src/auth/client";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googlePending, startGoogle] = useTransition();
  const busy = pending || googlePending;

  function signInWithGoogle() {
    setGoogleError(null);
    startGoogle(async () => {
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
      });
      if (error) {
        setGoogleError(error.message ?? "Unable to start Google sign-in.");
      }
    });
  }

  return <>
    <form className="sign-in-form" action={formAction}>
      <label htmlFor="email">Email address</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        disabled={busy}
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        disabled={busy}
      />
      <p className="field-help">Sign in with the email and password for your Neon Auth account.</p>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <button className="button" type="submit" disabled={busy}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
    <div className="sign-in-divider" aria-hidden="true"><span>or</span></div>
    <button className="button secondary-ink" type="button" disabled={busy} onClick={signInWithGoogle}>
      {googlePending ? "Redirecting…" : "Continue with Google"}
    </button>
    {googleError && <p className="form-error" role="alert">{googleError}</p>}
  </>;
}
