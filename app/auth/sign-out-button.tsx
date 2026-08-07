"use client";

import { useTransition } from "react";
import { signOutDemoVisitor, signOutLocalOwner } from "@/app/auth/sign-in/actions";
import { authClient } from "@/src/auth/client";

function isInsecureLocalClient(): boolean {
  return document.body.dataset.insecureLocal === "true";
}

function isDemoClient(): boolean {
  return document.body.dataset.demoProfile === "true";
}

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
      if (isDemoClient()) {
        await signOutDemoVisitor();
        return;
      }
      if (isInsecureLocalClient()) {
        await signOutLocalOwner();
        return;
      }
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
