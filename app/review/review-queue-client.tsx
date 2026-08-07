"use client";

import { useCallback, useEffect, useState } from "react";

type Category = "priority" | "review" | "new" | "archive";

type ReviewItem = Readonly<{
  verdictId: number;
  gmailMessageId: string;
  agreesWithFiling: boolean | null;
  deterministicOutcome: string;
  recommendedCategory: Category | null;
  rationale: string | null;
  malformed: boolean;
  subject: string;
  from: string;
  bodyExcerpt: string;
}>;

type CategoryIntent = Readonly<{
  priority: string;
  review: string;
  new: string;
  archive: string;
}>;

type QueuePayload = Readonly<{
  auditRunId: string | null;
  syncRunId: string | null;
  items: readonly ReviewItem[];
  categoryIntent: CategoryIntent | null;
}>;

const CATEGORY_KEYS: ReadonlyArray<{ key: string; category: Category; label: string }> = [
  { key: "1", category: "priority", label: "1 Priority" },
  { key: "2", category: "review", label: "2 Review" },
  { key: "3", category: "new", label: "3 New" },
  { key: "4", category: "archive", label: "4 Archive" },
];

async function loadQueue(): Promise<QueuePayload> {
  const response = await fetch("/api/review/queue", {
    method: "GET",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error("Could not load review queue");
  }
  return response.json() as Promise<QueuePayload>;
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

export function ReviewQueueClient() {
  const [queue, setQueue] = useState<QueuePayload | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadQueue();
      setQueue(next);
      setIndex(0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load review queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const items = queue?.items ?? [];
  const current = items[index] ?? null;
  const intent = queue?.categoryIntent;

  const labelCurrent = useCallback(async (ownerLabel: Category) => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitLabel(current.gmailMessageId, ownerLabel);
      setQueue((prev) => {
        if (!prev) return prev;
        const nextItems = prev.items.filter((item) => item.gmailMessageId !== current.gmailMessageId);
        return { ...prev, items: nextItems };
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

  if (loading) {
    return <section className="card review-queue"><p>Loading review queue…</p></section>;
  }

  if (!queue?.auditRunId) {
    return (
      <section className="card review-queue">
        <p>No Audit Run yet. Run a shadow audit first, then return here.</p>
        <button type="button" className="button" onClick={() => void refresh()}>Refresh</button>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="card review-queue">
        <p>Queue empty for the latest Audit Run. All pending items may already carry Owner Labels.</p>
        <button type="button" className="button" onClick={() => void refresh()}>Refresh</button>
      </section>
    );
  }

  return (
    <section className="card review-queue">
      <div className="review-queue-meta">
        <p>
          Sitting {index + 1} of {items.length}
          {queue.auditRunId ? ` · audit ${queue.auditRunId.slice(0, 8)}` : ""}
        </p>
        <p className="review-queue-keys">Keys: j/k navigate · 1–4 label</p>
      </div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {current ? (
        <div className="review-panels">
          <article className="review-panel">
            <h2>Snapshot</h2>
            <p><strong>From</strong> {current.from}</p>
            <p><strong>Subject</strong> {current.subject}</p>
            <pre className="review-excerpt">{current.bodyExcerpt}</pre>
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
      </div>
    </section>
  );
}
