"use client";

import Link from "next/link";
import { useState } from "react";
import { ARCHIVE_PURGE_CONFIRM } from "@/src/server/gmail/archive-purge-confirm";

export function ArchiveTrashPanel({
  gmailConnected,
  configured,
}: {
  gmailConnected: boolean;
  configured: boolean;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [understood, setUnderstood] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function purge(pageToken?: string | null): Promise<void> {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/archive/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        redirect: "manual",
        body: JSON.stringify({
          confirm: ARCHIVE_PURGE_CONFIRM,
          ...(pageToken ? { pageToken } : {}),
        }),
      });
      const body = await response.json() as {
        trashedCount?: number;
        skippedStarredCount?: number;
        exhausted?: boolean;
        nextPageToken?: string | null;
        archiveLabelName?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Archive could not be moved to Trash.");
      const count = body.trashedCount ?? 0;
      const skipped = body.skippedStarredCount ?? 0;
      const label = body.archiveLabelName ?? "archive";
      setNextPageToken(body.exhausted ? null : (body.nextPageToken ?? null));
      const skipNote = skipped > 0
        ? ` Skipped ${skipped} starred message${skipped === 1 ? "" : "s"}.`
        : "";
      setNotice(body.exhausted
        ? `Moved ${count} message${count === 1 ? "" : "s"} labeled ${label} to Gmail Trash.${skipNote}`
        : `Moved ${count} message${count === 1 ? "" : "s"} labeled ${label} to Gmail Trash.${skipNote} More remain — use Trash more.`);
      setStep(2);
      setUnderstood(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Archive could not be moved to Trash.");
    } finally {
      setPending(false);
    }
  }

  const canTrashMore = Boolean(nextPageToken);
  const ready = gmailConnected && configured;

  return <>
    <div className="announcements" aria-live="polite" aria-atomic="true">
      {error && <div className="alert error" role="alert"><strong>Action needed</strong><span>{error}</span></div>}
      {notice && <div className="alert success" role="status"><strong>Update</strong><span>{notice}</span></div>}
      {!gmailConnected && <div className="alert error" role="status"><strong>Gmail required</strong><span>Connect Gmail on the dashboard before trashing archive mail.</span></div>}
      {gmailConnected && !configured && (
        <div className="alert error" role="status">
          <strong>Configuration required</strong>
          <span>Set an archive label in <Link href="/configuration">Configuration</Link> first.</span>
        </div>
      )}
    </div>

    <section className="history danger-card" aria-label="Archive trash">
      <div className="section-heading">
        <div>
          <p className="step">DANGER ZONE</p>
          <h2>Trash archive</h2>
        </div>
        <p>Moves messages with the archive label into Gmail Trash (recoverable). Starred messages are skipped. Not permanent delete.</p>
      </div>
      {step === 0 && (
        <button
          className="button danger"
          type="button"
          disabled={pending || !ready}
          onClick={() => { setStep(1); setUnderstood(false); setNextPageToken(null); }}
        >
          Delete all archive…
        </button>
      )}
      {step >= 1 && (
        <div className="danger-panel">
          <p className="field-help">
            This moves every message currently labeled with your configured archive destination to Gmail Trash,
            except starred messages, which are left in place. You can recover trashed messages from Trash in Gmail. Sync must not be running.
          </p>
          <label className="danger-confirm" htmlFor="purgeUnderstood">
            <input
              id="purgeUnderstood"
              type="checkbox"
              checked={understood}
              disabled={pending}
              onChange={(event) => setUnderstood(event.target.checked)}
            />
            <span>I understand these messages will be moved to Gmail Trash.</span>
          </label>
          <div className="purge-actions">
            <button
              className="button danger"
              type="button"
              disabled={pending || !understood || !ready}
              onClick={() => void purge()}
            >
              {pending ? <><span className="spinner" aria-hidden="true" />Trashing…</> : "Confirm trash archive"}
            </button>
            {canTrashMore && (
              <button
                className="button secondary-ink"
                type="button"
                disabled={pending || !understood}
                onClick={() => void purge(nextPageToken)}
              >
                Trash more
              </button>
            )}
            <button
              className="button secondary-ink"
              type="button"
              disabled={pending}
              onClick={() => { setStep(0); setUnderstood(false); setNextPageToken(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  </>;
}
