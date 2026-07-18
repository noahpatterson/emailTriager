"use client";

import { useTransition } from "react";
import { authClient } from "@/src/auth/client";

export function SignOutButton({
  className = "button",
  label = "Sign out",
}: {
  className?: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();

  function onSignOut() {
    startTransition(async () => {
      await authClient.signOut();
      window.location.assign("/auth/sign-in");
    });
  }

  return (
    <button className={className} type="button" disabled={pending} onClick={onSignOut}>
      {pending ? "Signing out…" : label}
    </button>
  );
}
