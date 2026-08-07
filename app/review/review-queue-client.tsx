"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { ClassificationOutcome } from "@/src/server/gmail/classify";
import type { Category } from "@/src/server/gmail/corpus";

/** Mirrors DEFAULT_REVIEW_PAGE_SIZE — sitting window over stratified pending. */
const REVIEW_SITTING_SIZE = 20;

export type ReviewItem = Readonly<{
  verdictId: number;
  gmailMessageId: string;
  agreesWithFiling: boolean | null;
  deterministicOutcome: ClassificationOutcome | "failed";
  recommendedCategory: Category | null;
  rationale: string | null;
  malformed: boolean;
  subject: string;
  from: string;
  messageSnapshotExcerpt: string;
}>;

export type CategoryIntentView = Readonly<{
  priority: string;
  review: string;
  new: string;
  archive: string;
}>;

export type ReviewQueuePayload = Readonly<{
  auditRunId: string | null;
  syncRunId: string | null;
  pendingCount: number;
  items: readonly ReviewItem[];
  categoryIntent: CategoryIntentView | null;
}>;

const CATEGORY_KEYS: ReadonlyArray<{ key: string; category: Category; label: string }> = [
  { key: "1", category: "priority", label: "1 Priority" },
  { key: "2", category: "review", label: "2 Review" },
  { key: "3", category: "new", label: "3 New" },
  { key: "4", category: "archive", label: "4 Archive" },
];

async function loadQueue(): Promise<ReviewQueuePayload> {
  const response = await fetch("/api/review/queue", {
    method: "GET",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error("Could not load review queue");
  }
  return response.json() as Promise<ReviewQueuePayload>;
}

async function submitLabel(messageId: string, ownerLabel: Category): Promise<void> {
  const response = await fetch(`/api/review/${encodeURIComponent(messageId)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ownerLabel }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not save Owner Label");
  }
}

export function ReviewQueueClient({
  initialQueue,
}: {
  initialQueue: ReviewQueuePayload;
}) {
  const [queue, setQueue] = useState(initialQueue);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        const next = await loadQueue();
        setQueue(next);
        setIndex(0);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load review queue");
      }
    });
  }, []);

  const items = queue.items;
  const current = items[index] ?? null;
  const intent = queue.categoryIntent;
  const pendingBeyondSitting = Math.max(0, queue.pendingCount - items.length);

  const labelCurrent = useCallback(async (ownerLabel: Category) => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitLabel(current.gmailMessageId, ownerLabel);
      setQueue((prev) => {
        const nextItems = prev.items.filter((item) => item.gmailMessageId !== current.gmailMessageId);
        return {
          ...prev,
          items: nextItems,
          pendingCount: Math.max(0, prev.pendingCount - 1),
        };
      });
      setIndex((prev) => {
        const remaining = items.length - 1;
        if (remaining <= 0) return 0;
        return Math.min(prev, remaining - 1);
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Owner Label");
    } finally {
      setBusy(false);
    }
  }, [busy, current, items.length]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.key === "j" || event.key === "J") {
        event.preventDefault();
        setIndex((prev) => Math.min(prev + 1, Math.max(items.length - 1, 0)));
        return;
      }
      if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        setIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      const match = CATEGORY_KEYS.find((entry) => entry.key === event.key);
      if (match) {
        event.preventDefault();
        void labelCurrent(match.category);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items.length, labelCurrent]);

  if (!queue.auditRunId) {
    return (
      <section className="card review-queue">
        <p>No Audit Run yet. Run a shadow audit first, then return here.</p>
        <button type="button" className="button" disabled={pending} onClick={refresh}>
          {pending ? "Refreshing…" : "Refresh"}
        </button>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="card review-queue">
        <p>
          {queue.pendingCount > 0
            ? `Sitting complete — ${queue.pendingCount} pending remain. Refresh for the next sitting.`
            : "Queue empty for the latest Audit Run. All pending items may already carry Owner Labels."}
        </p>
        <button type="button" className="button" disabled={pending} onClick={refresh}>
          {pending ? "Refreshing…" : "Refresh"}
        </button>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="card review-queue">
      <div className="review-queue-meta">
        <p>
          Sitting {index + 1} of {items.length}
          {queue.pendingCount > items.length
            ? ` · ${queue.pendingCount} pending (sitting size ${REVIEW_SITTING_SIZE})`
            : ""}
          {pendingBeyondSitting > 0 ? ` · +${pendingBeyondSitting} after this sitting` : ""}
          {queue.auditRunId ? ` · audit ${queue.auditRunId.slice(0, 8)}` : ""}
        </p>
        <p className="review-queue-keys">Keys: j/k navigate · 1–4 label</p>
      </div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {current ? (
        <div className="review-panels">
          <article className="review-panel">
            <h2>Message Snapshot</h2>
            <p><strong>From</strong> {current.from}</p>
            <p><strong>Subject</strong> {current.subject}</p>
            <pre className="review-excerpt">{current.messageSnapshotExcerpt}</pre>
          </article>
          <article className="review-panel">
            <h2>Filing vs Verdict</h2>
            <p><strong>Deterministic</strong> {current.deterministicOutcome}</p>
            <p>
              <strong>Verdict</strong>{" "}
              {current.agreesWithFiling === false
                ? "Disagreement"
                : current.agreesWithFiling === true
                  ? "Agreement"
                  : "Unknown"}
              {current.recommendedCategory ? ` → ${current.recommendedCategory}` : ""}
            </p>
            <p><strong>Rationale</strong> {current.rationale ?? "—"}</p>
          </article>
          <article className="review-panel">
            <h2>Category Intent</h2>
            {intent ? (
              <dl className="review-intent">
                <div><dt>priority</dt><dd>{intent.priority}</dd></div>
                <div><dt>review</dt><dd>{intent.review}</dd></div>
                <div><dt>new</dt><dd>{intent.new}</dd></div>
                <div><dt>archive</dt><dd>{intent.archive}</dd></div>
              </dl>
            ) : (
              <p>No category intent configured.</p>
            )}
          </article>
        </div>
      ) : null}
      <div className="review-actions">
        {CATEGORY_KEYS.map((entry) => (
          <button
            key={entry.category}
            type="button"
            className="button"
            disabled={busy || !current}
            onClick={() => void labelCurrent(entry.category)}
          >
            {entry.label}
          </button>
        ))}
        <button type="button" className="button" disabled={pending} onClick={refresh}>
          {pending ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </section>
  );
}
