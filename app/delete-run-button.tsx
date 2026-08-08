"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";

type DeleteRunButtonProps = Readonly<{
  runId: string;
  trial?: boolean;
  /** When set, called after a successful delete instead of navigating away. */
  onDeleted?: (runId: string) => void;
  redirectTo?: string;
}>;

export function DeleteRunButton({
  runId,
  trial = false,
  onDeleted,
  redirectTo = "/",
}: DeleteRunButtonProps) {
  const router = useRouter();
  const menuId = useId();
  const rootRef = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const root = rootRef.current;
      if (!root || root.contains(event.target as Node)) return;
      root.open = false;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const root = rootRef.current;
      if (!root) return;
      root.open = false;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function onDelete(event: MouseEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const kind = trial ? "trial run" : "sync run";
    if (!window.confirm(
      `Delete this ${kind} from the database? This removes the run and its message records. Gmail is not changed.`,
    )) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) throw new Error("delete failed");
      if (onDeleted) {
        onDeleted(runId);
      } else {
        router.push(redirectTo);
        router.refresh();
      }
    } catch {
      window.alert("This run could not be deleted. Please try again.");
      setBusy(false);
    }
  }

  return (
    <details
      ref={rootRef}
      className="run-menu"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onClick={(event) => event.stopPropagation()}
    >
      <summary
        className="run-menu-trigger"
        aria-label="Run actions"
        aria-controls={menuId}
        aria-haspopup="menu"
      >
        <span aria-hidden="true">⋯</span>
      </summary>
      <div className="run-menu-panel" id={menuId} role="menu">
        <button
          className="run-menu-item danger"
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={(event) => void onDelete(event)}
        >
          {busy ? "Deleting…" : "Delete from database"}
        </button>
      </div>
    </details>
  );
}
