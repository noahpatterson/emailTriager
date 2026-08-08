"use client";

import { useActionState, useState, useTransition } from "react";
import { authClient } from "@/src/auth/client";
import { continueAsLocalOwner, signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

export function SignInForm({
  insecureLocalDev = false,
  demoProfile = false,
}: {
  insecureLocalDev?: boolean;
  demoProfile?: boolean;
}) {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [googlePending, startGoogle] = useTransition();
  const [localPending, startLocal] = useTransition();
  const [demoPending, setDemoPending] = useState(false);
  const busy = pending || googlePending || localPending || demoPending;

  if (demoProfile) {
    return (
      <div className="local-dev-sign-in">
        <p className="inline-warning" role="status">
          Public demo — cookie session, fixture Gmail, no Neon Auth, no model calls.
        </p>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => {
            setDemoError(null);
            setDemoPending(true);
            void (async () => {
              try {
                const response = await fetch("/api/demo/start", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  credentials: "same-origin",
                });
                if (response.status === 429) {
                  setDemoError("Too many demo sessions from this network (5 per hour). Try again later.");
                  return;
                }
                if (!response.ok) throw new Error();
                window.location.assign("/");
              } catch {
                setDemoError("Could not start the demo. Please try again.");
              } finally {
                setDemoPending(false);
              }
            })();
          }}
        >
          {demoPending ? "Starting…" : "Start demo session"}
        </button>
        {demoError && <p className="form-error" role="alert">{demoError}</p>}
      </div>
    );
  }

  if (insecureLocalDev) {
    return (
      <div className="local-dev-sign-in">
        <p className="inline-warning" role="status">
          INSECURE LOCAL DEV — Neon Auth is bypassed. This mode must never be exposed beyond your machine.
        </p>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => startLocal(() => continueAsLocalOwner())}
        >
          {localPending ? "Continuing…" : "Continue as local owner"}
        </button>
      </div>
    );
  }

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
