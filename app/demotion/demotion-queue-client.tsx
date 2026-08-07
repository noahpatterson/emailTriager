"use client";

import { useCallback, useState, useTransition } from "react";
import type { Category } from "@/src/server/gmail/corpus";

export type DemotionItem = Readonly<{
  id: number;
  gmailMessageId: string;
  verdictId: number;
  recommendedCategory: Category;
  rationale: string | null;
  subject: string;
  from: string;
  bodyExcerpt: string;
  createdAt: string;
}>;

export type DemotionQueuePayload = Readonly<{
  pendingCount: number;
  items: readonly DemotionItem[];
}>;

async function loadQueue(): Promise<DemotionQueuePayload> {
  const response = await fetch("/api/demotion/queue", {
    method: "GET",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error("Could not load demotion queue");
  }
  return response.json() as Promise<DemotionQueuePayload>;
}

async function confirmDemotion(messageId: string): Promise<void> {
  const response = await fetch(`/api/demotion/${encodeURIComponent(messageId)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not confirm demotion");
  }
}

export function DemotionQueueClient({
  initialQueue,
}: {
  initialQueue: DemotionQueuePayload;
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
        setError(caught instanceof Error ? caught.message : "Could not load demotion queue");
      }
    });
  }, []);

  const items = queue.items;
  const current = items[index] ?? null;

  const confirmCurrent = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await confirmDemotion(current.gmailMessageId);
      setQueue((prev) => {
        const nextItems = prev.items.filter((item) => item.gmailMessageId !== current.gmailMessageId);
        return {
          pendingCount: Math.max(0, prev.pendingCount - 1),
          items: nextItems,
        };
      });
      setIndex((prev) => {
        const remaining = items.length - 1;
        if (remaining <= 0) return 0;
        return Math.min(prev, remaining - 1);
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not confirm demotion");
    } finally {
      setBusy(false);
    }
  }, [busy, current, items.length]);

  if (items.length === 0) {
    return (
      <section className="card review-queue">
        <p>
          {queue.pendingCount > 0
            ? "Sitting empty — refresh for more pending demotions."
            : "No pending demotions. Archive recommendations from audit appear here for confirmation."}
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
          {index + 1} of {items.length}
          {queue.pendingCount > items.length ? ` · ${queue.pendingCount} pending` : ""}
        </p>
        <p className="review-queue-keys">Confirm applies the archive label in Gmail</p>
      </div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {current ? (
        <div className="review-panels">
          <article className="review-panel">
            <h2>Message Snapshot</h2>
            <p><strong>From</strong> {current.from}</p>
            <p><strong>Subject</strong> {current.subject || "(no subject)"}</p>
            <pre className="review-excerpt">{current.bodyExcerpt || "(no snapshot excerpt)"}</pre>
          </article>
          <article className="review-panel">
            <h2>Demotion</h2>
            <p><strong>Judge recommends</strong> {current.recommendedCategory}</p>
            <p><strong>Rationale</strong> {current.rationale ?? "—"}</p>
          </article>
        </div>
      ) : null}
      <div className="review-actions">
        <button type="button" className="button" disabled={busy || !current} onClick={() => void confirmCurrent()}>
          {busy ? "Confirming…" : "Confirm archive in Gmail"}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy || index >= items.length - 1}
          onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
        >
          Skip for now
        </button>
        <button type="button" className="button" disabled={pending} onClick={refresh}>
          {pending ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </section>
  );
}
