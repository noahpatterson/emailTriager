"use client";

import Link from "next/link";
import { useState } from "react";
import { CONTEST_ARCHIVE_PURGE_CONFIRM } from "@/src/server/gmail/contest-archive-purge-confirm";

export function ContestArchiveTrashPanel({
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
      const response = await fetch("/api/contest-archive/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        redirect: "manual",
        body: JSON.stringify({
          confirm: CONTEST_ARCHIVE_PURGE_CONFIRM,
          ...(pageToken ? { pageToken } : {}),
        }),
      });
      const body = await response.json() as {
        trashedCount?: number;
        exhausted?: boolean;
        nextPageToken?: string | null;
        archiveLabelName?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Contest archive could not be moved to Trash.");
      const count = body.trashedCount ?? 0;
      const label = body.archiveLabelName ?? "contest-archive";
      setNextPageToken(body.exhausted ? null : (body.nextPageToken ?? null));
      setNotice(body.exhausted
        ? `Moved ${count} message${count === 1 ? "" : "s"} labeled ${label} to Gmail Trash.`
        : `Moved ${count} message${count === 1 ? "" : "s"} labeled ${label} to Gmail Trash. More remain — use Trash more.`);
      setStep(2);
      setUnderstood(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Contest archive could not be moved to Trash.");
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
      {!gmailConnected && <div className="alert error" role="status"><strong>Gmail required</strong><span>Connect Gmail on the dashboard before trashing contest-archive mail.</span></div>}
      {gmailConnected && !configured && (
        <div className="alert error" role="status">
          <strong>Configuration required</strong>
          <span>Set a contest-archive label in <Link href="/configuration">Configuration</Link> first.</span>
        </div>
      )}
    </div>

    <section className="history danger-card" aria-label="Contest archive trash">
      <div className="section-heading">
        <div>
          <p className="step">DANGER ZONE</p>
          <h2>Trash contest-archive</h2>
        </div>
        <p>Moves messages with the contest-archive label into Gmail Trash (recoverable). Not permanent delete.</p>
      </div>
      {step === 0 && (
        <button
          className="button danger"
          type="button"
          disabled={pending || !ready}
          onClick={() => { setStep(1); setUnderstood(false); setNextPageToken(null); }}
        >
          Delete all contest-archive…
        </button>
      )}
      {step >= 1 && (
        <div className="danger-panel">
          <p className="field-help">
            This moves every message currently labeled with your configured contest-archive destination to Gmail Trash.
            You can recover them from Trash in Gmail. Sync must not be running.
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
              {pending ? <><span className="spinner" aria-hidden="true" />Trashing…</> : "Confirm trash contest-archive"}
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
