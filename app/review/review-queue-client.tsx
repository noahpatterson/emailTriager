"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { ClassificationOutcome } from "@/src/server/gmail/classify";
import type { Category } from "@/src/server/gmail/corpus";
import type { ReviewQueueMode } from "@/src/server/gmail/review-queue";

/** Mirrors DEFAULT_REVIEW_PAGE_SIZE — sitting window over stratified pending. */
const REVIEW_SITTING_SIZE = 20;
/** Mirrors DEFAULT_AUDIT_MAX_MESSAGES. */
const AUDIT_MAX_MESSAGES_CAP = 100;
const DEFAULT_JUDGE_COUNT = 10;

export type ReviewItem = Readonly<{
  verdictId: number;
  gmailMessageId: string;
  gmailThreadId: string | null;
  gmailUrl: string | null;
  agreesWithFiling: boolean | null;
  deterministicOutcome: ClassificationOutcome | "failed";
  outcomeReason: string | null;
  matchedTerm: string | null;
  classifierMatchSnippet: string | null;
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

export type AuditableSyncRunView = Readonly<{
  id: string;
  status: string;
  trial: boolean;
  startedAt: string;
  finishedAt: string | null;
}>;

export type ReviewQueuePayload = Readonly<{
  auditRunId: string | null;
  syncRunId: string | null;
  verdictCount: number;
  candidateCount: number;
  unlabeledCount: number;
  pendingCount: number;
  items: readonly ReviewItem[];
  categoryIntent: CategoryIntentView | null;
  mode: ReviewQueueMode;
  syncRuns: readonly AuditableSyncRunView[];
}>;

const CATEGORY_KEYS: ReadonlyArray<{ key: string; category: Category; label: string }> = [
  { key: "1", category: "priority", label: "1 Priority" },
  { key: "2", category: "review", label: "2 Review" },
  { key: "3", category: "new", label: "3 New" },
  { key: "4", category: "archive", label: "4 Archive" },
];

async function loadQueue(mode: ReviewQueueMode): Promise<ReviewQueuePayload> {
  const response = await fetch(`/api/review/queue?mode=${encodeURIComponent(mode)}`, {
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

async function startAudit(input: Readonly<{
  syncRunId: string;
  maxMessages: number;
}>): Promise<Readonly<{
  id: string;
  status: string;
  processedCount: number;
  totalEligible: number;
}>> {
  const response = await fetch("/api/audit", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      syncRunId: input.syncRunId,
      maxMessages: input.maxMessages,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not start audit");
  }
  return response.json() as Promise<{
    id: string;
    status: string;
    processedCount: number;
    totalEligible: number;
  }>;
}

function formatSyncRunLabel(run: AuditableSyncRunView): string {
  const when = new Date(run.startedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const statusLabel =
    run.status === "bounded_incomplete"
      ? "bounded"
      : run.status === "partial_failure"
        ? "partial"
        : run.status === "completed"
          ? "completed"
          : run.status;
  return `${when} · ${statusLabel} · ${run.id.slice(0, 8)}`;
}

function emptyQueueMessage(queue: ReviewQueuePayload): string {
  if (queue.pendingCount > 0) {
    return `Sitting complete — ${queue.pendingCount} pending remain. Refresh for the next sitting.`;
  }
  if (queue.verdictCount === 0) {
    return "This audit has no verdicts yet. Run an audit above.";
  }
  if (queue.candidateCount === 0) {
    return "Judged messages are missing snapshots for this sync run, so nothing can be reviewed.";
  }
  if (queue.unlabeledCount === 0) {
    return "Queue empty — every reviewed candidate already has an Owner Label.";
  }
  if (queue.mode === "stratified") {
    return `Stratified sample is empty (${queue.unlabeledCount} unlabeled remain). Switch to “Show all judged messages”.`;
  }
  return "Queue empty for the latest Audit Run.";
}

function queueMetaLine(queue: ReviewQueuePayload, index: number, sittingSize: number): string {
  const items = queue.items;
  const pendingBeyondSitting = Math.max(0, queue.pendingCount - items.length);
  const sitting =
    items.length === 0
      ? "Sitting empty"
      : `Sitting ${index + 1} of ${items.length}`;
  const parts = [
    sitting,
    queue.pendingCount > items.length
      ? `${queue.pendingCount} pending (sitting size ${sittingSize})`
      : null,
    pendingBeyondSitting > 0 ? `+${pendingBeyondSitting} after this sitting` : null,
    queue.auditRunId ? `audit ${queue.auditRunId.slice(0, 8)}` : null,
    queue.mode === "all" ? "all" : "stratified",
  ];
  return parts.filter(Boolean).join(" · ");
}

export function ReviewQueueClient({
  initialQueue,
}: {
  initialQueue: ReviewQueuePayload;
}) {
  const [queue, setQueue] = useState(initialQueue);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<ReviewQueueMode>(initialQueue.mode ?? "stratified");
  const [maxMessages, setMaxMessages] = useState(DEFAULT_JUDGE_COUNT);
  const [syncRunId, setSyncRunId] = useState(
    initialQueue.syncRuns[0]?.id ?? initialQueue.syncRunId ?? "",
  );
  // Prefer an explicit selection; fall back when queue refresh brings runs in later.
  const effectiveSyncRunId =
    (syncRunId && queue.syncRuns.some((run) => run.id === syncRunId) ? syncRunId : null)
    ?? queue.syncRuns[0]?.id
    ?? "";

  const refresh = useCallback((nextMode: ReviewQueueMode = mode) => {
    setError(null);
    startTransition(async () => {
      try {
        const next = await loadQueue(nextMode);
        setQueue(next);
        setIndex(0);
        setSyncRunId((current) => {
          if (current && next.syncRuns.some((run) => run.id === current)) return current;
          return next.syncRuns[0]?.id ?? "";
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load review queue");
      }
    });
  }, [mode]);

  const selectMode = useCallback((nextMode: ReviewQueueMode) => {
    setMode(nextMode);
    refresh(nextMode);
  }, [refresh]);

  const runAudit = useCallback(async () => {
    if (!effectiveSyncRunId || auditing || busy || pending) return;
    const count = Math.max(1, Math.min(AUDIT_MAX_MESSAGES_CAP, Math.trunc(maxMessages) || 1));
    setAuditing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await startAudit({ syncRunId: effectiveSyncRunId, maxMessages: count });
      setNotice(
        `Audit ${result.status}: judged ${result.processedCount} of ${result.totalEligible} eligible.`,
      );
      refresh(mode);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start audit");
    } finally {
      setAuditing(false);
    }
  }, [auditing, busy, effectiveSyncRunId, maxMessages, mode, pending, refresh]);

  const items = queue.items;
  const current = items[index] ?? null;
  const intent = queue.categoryIntent;
  const blocked = busy || pending || auditing;

  const labelCurrent = useCallback(async (ownerLabel: Category) => {
    if (!current || busy || auditing) return;
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
          unlabeledCount: Math.max(0, prev.unlabeledCount - 1),
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
  }, [auditing, busy, current, items.length]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
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

  return (
    <>
      <details className="card review-audit-panel" open>
        <summary className="review-audit-summary">Run audit</summary>
        <div className="review-audit-body">
          <label className="review-audit-field" htmlFor="review-sync-run">
            Sync run
            <select
              id="review-sync-run"
              value={effectiveSyncRunId}
              disabled={blocked || queue.syncRuns.length === 0}
              onChange={(event) => setSyncRunId(event.target.value)}
            >
              {queue.syncRuns.length === 0 ? (
                <option value="">No finished sync runs</option>
              ) : (
                queue.syncRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {formatSyncRunLabel(run)}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="review-audit-field" htmlFor="review-max-messages">
            How many to judge
            <input
              id="review-max-messages"
              type="number"
              min={1}
              max={AUDIT_MAX_MESSAGES_CAP}
              step={1}
              value={maxMessages}
              disabled={blocked}
              onChange={(event) => setMaxMessages(Number(event.target.value))}
            />
            <span className="review-audit-hint">Caps API spend. Max {AUDIT_MAX_MESSAGES_CAP}.</span>
          </label>
          <fieldset className="review-audit-fieldset" disabled={blocked}>
            <legend>What to show in the queue</legend>
            <label className="review-audit-radio">
              <input
                type="radio"
                name="review-queue-mode"
                checked={mode === "stratified"}
                onChange={() => selectMode("stratified")}
              />
              Disagreements + ~10% of agreements
            </label>
            <label className="review-audit-radio">
              <input
                type="radio"
                name="review-queue-mode"
                checked={mode === "all"}
                onChange={() => selectMode("all")}
              />
              All judged messages still unlabeled
            </label>
          </fieldset>
          <div className="review-audit-actions">
            <button
              type="button"
              className="button"
              disabled={blocked || !effectiveSyncRunId}
              onClick={() => void runAudit()}
            >
              {auditing ? "Auditing…" : "Run audit"}
            </button>
          </div>
          <p className="review-action-notes">
            Audit judges priority/review/new filings only — not archive, blocked, or whitelisted senders. Changing the queue option refreshes the list below.
          </p>
        </div>
      </details>

      <section className="card review-queue">
        <div className="review-queue-meta">
          {queue.auditRunId ? (
            <p>{queueMetaLine(queue, index, REVIEW_SITTING_SIZE)}</p>
          ) : (
            <p>No Audit Run yet. Expand “Run audit” above to start one.</p>
          )}
          <p className="review-queue-keys">Keys: j/k navigate · 1–4 label</p>
        </div>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        {notice ? <p className="review-audit-notice" role="status">{notice}</p> : null}

        {!queue.auditRunId ? null : items.length === 0 ? (
          <p>{emptyQueueMessage(queue)}</p>
        ) : current ? (
          <div className="review-panels">
            <article className="review-panel">
              <h2>Message Snapshot</h2>
              <p><strong>From</strong> {current.from}</p>
              <p><strong>Subject</strong> {current.subject}</p>
              <pre className="review-excerpt">{current.messageSnapshotExcerpt}</pre>
              {current.gmailUrl ? (
                <p>
                  <a
                    className="review-gmail-link"
                    href={current.gmailUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open full message in Gmail
                  </a>
                </p>
              ) : (
                <p className="review-gmail-missing">No Gmail thread link for this snapshot.</p>
              )}
            </article>
            <article className="review-panel">
              <h2>Filing vs Verdict</h2>
              <p><strong>Deterministic</strong> {current.deterministicOutcome}</p>
              <p>
                <strong>Matched term</strong>{" "}
                {current.matchedTerm ? `“${current.matchedTerm}”` : "— (no keyword match)"}
              </p>
              <div>
                <p><strong>Judge match snippet</strong></p>
                {current.classifierMatchSnippet ? (
                  <pre className="review-excerpt">{current.classifierMatchSnippet}</pre>
                ) : (
                  <p className="review-gmail-missing">No classifier snippet sent to the judge.</p>
                )}
              </div>
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

        {queue.auditRunId ? (
          <>
            <div className="review-actions">
              {CATEGORY_KEYS.map((entry) => (
                <button
                  key={entry.category}
                  type="button"
                  className="button"
                  disabled={blocked || !current}
                  onClick={() => void labelCurrent(entry.category)}
                >
                  {entry.label}
                </button>
              ))}
              <button type="button" className="button" disabled={blocked} onClick={() => refresh(mode)}>
                {pending ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            <p className="review-action-notes">
              1–4 save your Owner Label to the golden set and apply that category label in Gmail.
              j/k move within this sitting. Refresh loads the next sitting of pending items.
              Starred messages keep the golden-set write but skip the Gmail change.
            </p>
          </>
        ) : (
          <div className="review-actions">
            <button type="button" className="button" disabled={blocked} onClick={() => refresh(mode)}>
              {pending ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
