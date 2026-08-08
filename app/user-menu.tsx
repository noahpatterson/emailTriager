"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { SignOutButton } from "@/app/auth/sign-out-button";
import type { OwnerUser } from "@/app/owner-user";

export function UserMenu({
  user,
  demoProfile = false,
  onResetDemo,
  resetting = false,
}: {
  user: OwnerUser;
  demoProfile?: boolean;
  onResetDemo?: () => void;
  resetting?: boolean;
}) {
  const rootRef = useRef<HTMLDetailsElement>(null);
  const name = user.name.trim();
  const label = name || user.email || "Owner";

  useEffect(() => {
    function closeIfOpen() {
      const root = rootRef.current;
      if (root?.open) root.open = false;
    }

    function onPointerDown(event: PointerEvent) {
      const root = rootRef.current;
      if (!root?.open) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      closeIfOpen();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeIfOpen();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <details ref={rootRef} className="user-menu">
      <summary className="user-menu-trigger" aria-label={`Account menu for ${label}`}>
        <span className="user-menu-avatar" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
        <span className="user-menu-label">
          <strong>{label}</strong>
          {name ? <small>{user.email}</small> : null}
        </span>
      </summary>
      <div className="user-menu-panel" role="menu">
        <div className="user-menu-current">
          <p>Signed in as</p>
          <strong>{name || "Owner"}</strong>
          <span>{user.email}</span>
        </div>
        <Link className="user-menu-link" href="/configuration" role="menuitem">Configuration</Link>
        <Link className="user-menu-link" href="/settings" role="menuitem">Settings</Link>
        {demoProfile && onResetDemo ? (
          <button
            className="user-menu-sign-out"
            type="button"
            role="menuitem"
            disabled={resetting}
            onClick={onResetDemo}
          >
            {resetting ? "Clearing…" : "Clear my demo data"}
          </button>
        ) : null}
        <SignOutButton className="user-menu-sign-out" />
      </div>
    </details>
  );
}
