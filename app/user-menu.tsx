"use client";

import Link from "next/link";
import { SignOutButton } from "@/app/auth/sign-out-button";
import type { OwnerUser } from "@/app/owner-user";

export function UserMenu({ user }: { user: OwnerUser }) {
  const name = user.name.trim();
  const label = name || user.email || "Owner";
  return (
    <details className="user-menu">
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
        <SignOutButton className="user-menu-sign-out" />
      </div>
    </details>
  );
}
