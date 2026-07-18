"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandLogo } from "@/app/brand-logo";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { DeleteRunButton } from "@/app/delete-run-button";
import { RunResultsList, type RunResultRow } from "@/app/run-results";
import { formatRunTime, runMessage, type RunStatus } from "@/app/run-status";

export type { RunStatus } from "@/app/run-status";
export { formatRunTime, runMessage } from "@/app/run-status";

export type DashboardRun = Readonly<{
  id: string;
  status: RunStatus;
  trial: boolean;
  startedAt: string;
  finishedAt: string | null;
  errorSummary: string | null;
  nextPageToken: string | null;
}>;
export type DashboardState = Readonly<{
  connected: boolean;
  configured: boolean;
  runs: readonly DashboardRun[];
}>;
export type DashboardUser = Readonly<{ name: string; email: string }>;

export type TrialResultRow = RunResultRow;

type ActionState = "idle" | "connecting" | "syncing" | "disconnecting";

const statusText: Record<RunStatus, string> = {
  running: "Syncing",
  bounded_incomplete: "Complete for this bounded run",
  completed: "Completed",
  partial_failure: "Completed with some failures",
  failed: "Failed",
};

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    redirect: "manual",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function UserMenu({ user }: { user: DashboardUser }) {
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
        <Link className="user-menu-link" href="/settings" role="menuitem">Settings</Link>
        <SignOutButton className="user-menu-sign-out" />
      </div>
    </details>
  );
}

export function Dashboard({ initialState, user }: { initialState: DashboardState; user: DashboardUser }) {
  const [state, setState] = useState(initialState);
  const [trialMode, setTrialMode] = useState(false);
  const [trialResults, setTrialResults] = useState<readonly TrialResultRow[]>([]);
  const [trialNextPageToken, setTrialNextPageToken] = useState<string | null>(null);
  const [trialExhausted, setTrialExhausted] = useState(false);
  const [action, setAction] = useState<ActionState>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect(): Promise<void> {
    setAction("connecting"); setError(null); setNotice(null);
    try {
      const response = await post("/api/oauth/google/start");
      if (response.status === 0 || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        throw new Error("redirect");
      }
      if (!response.ok) throw new Error();
      const body = await response.json() as { authorizationUrl?: string };
      if (!body.authorizationUrl) throw new Error();
      window.location.assign(body.authorizationUrl);
    } catch { setError("Google connection could not be started. Please try again."); setAction("idle"); }
  }

  async function runSync(options: { trial: boolean; pageToken?: string | null }): Promise<void> {
    setAction("syncing");
    setError(null);
    setNotice(options.trial
      ? "Trial started. Classifying up to 10 messages without applying labels."
      : "Sync started. Keep this page open while the bounded run completes.");
    try {
      const response = await post("/api/sync", {
        trial: options.trial,
        ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as {
        runId: string;
        status: RunStatus;
        trial: boolean;
        exhausted: boolean;
        nextPageToken: string | null;
        results: TrialResultRow[];
      };
      const now = new Date().toISOString();
      setState((current) => ({
        ...current,
        runs: [{
          id: result.runId,
          status: result.status,
          trial: result.trial,
          startedAt: now,
          finishedAt: now,
          errorSummary: null,
          nextPageToken: result.nextPageToken,
        }, ...current.runs],
      }));
      if (result.trial) {
        setTrialResults(result.results);
        setTrialNextPageToken(result.nextPageToken);
        setTrialExhausted(result.exhausted);
        setNotice(result.exhausted
          ? "Trial finished. Source label exhausted. No Gmail labels were changed."
          : `Trial batch ready (${result.results.length}). Review proposed labels, then Trial more for the next 10.`);
      } else {
        setTrialResults([]);
        setTrialNextPageToken(null);
        setTrialExhausted(false);
        setNotice(result.status === "bounded_incomplete"
          ? "Safety limit reached. Run again when ready to continue."
          : "Sync completed successfully.");
      }
    } catch {
      setError(options.trial
        ? "Trial could not be completed. No Gmail labels were changed."
        : "Sync could not be completed. Gmail and message content remain protected; try again or reconnect.");
      setNotice(null);
    } finally {
      setAction("idle");
    }
  }

  async function disconnect(): Promise<void> {
    if (!window.confirm("Disconnect Gmail? Saved configuration and sanitized run history will be kept.")) return;
    setAction("disconnecting"); setError(null); setNotice(null);
    try {
      const response = await post("/api/disconnect");
      if (!response.ok) throw new Error();
      setState((current) => ({ ...current, connected: false }));
      setNotice("Gmail disconnected. Local token material was removed.");
    } catch { setError("Gmail could not be disconnected. Please try again."); }
    finally { setAction("idle"); }
  }

  const busy = action !== "idle";
  const canTrialMore = trialMode && Boolean(trialNextPageToken) && !trialExhausted;
  const liveNextPageToken =
    state.runs.find((run) => !run.trial)?.nextPageToken ?? null;

  return <main className="shell" aria-busy={busy}>
    <header className="hero">
      <div className="brand-heading">
        <BrandLogo size="lg" />
        <div className="brand-heading-copy">
          <p className="eyebrow">OWNER CONSOLE</p>
          <h1>Email Triage</h1>
          <p className="lede">Sort a bounded set of Gmail messages with deterministic, local rules.</p>
        </div>
      </div>
      <div className="hero-aside">
        <span className={`connection ${state.connected ? "online" : "offline"}`}><i />{state.connected ? "Gmail connected" : "Gmail disconnected"}</span>
        <UserMenu user={user} />
      </div>
    </header>

    <div className="announcements" aria-live="polite" aria-atomic="true">
      {error && <div className="alert error" role="alert"><strong>Action needed</strong><span>{error}</span></div>}
      {notice && <div className="alert success" role="status"><strong>Update</strong><span>{notice}</span></div>}
    </div>

    <section className="grid" aria-label="Email triage controls">
      <article className="card primary-card">
        <p className="step">01 · CONNECTION</p>
        <h2>{state.connected ? "Your Gmail account is ready" : "Connect your Gmail account"}</h2>
        <p>{state.connected ? "Only the configured source label is read. Email bodies, attachments, and OAuth tokens are never shown here." : "Authorize read and label access for the single owner account. Email is never sent, permanently deleted, or marked read."}</p>
        {state.connected ? <button className="button secondary" type="button" disabled={busy} onClick={disconnect}>{action === "disconnecting" ? "Disconnecting…" : "Disconnect Gmail"}</button> : <button className="button" type="button" disabled={busy} onClick={connect}>{action === "connecting" ? "Opening Google…" : "Connect Gmail"}</button>}
      </article>

      <article className={`card ${!state.configured ? "" : trialMode ? "trial-card" : ""}`}>
        {!state.configured ? (
          <>
            <p className="step">02 · CONFIGURATION</p>
            <h2>Set labels and classification rules</h2>
            <p>
              Create your Gmail labels, then configure source and destination labels, terms, whitelist, and bounds.
              Open Settings for how triage behaves in Gmail.
            </p>
            <div className="sync-actions">
              <Link className="button" href="/configuration">Open configuration</Link>
              <Link className="button secondary-ink" href="/settings">How it works</Link>
            </div>
          </>
        ) : (
          <>
            <p className="step">02 · BOUNDED SYNC</p>
            <h2>{trialMode ? "Trial classification" : "Classify the next batch"}</h2>
            <p>{trialMode
              ? "Trial mode classifies up to 10 messages and shows the labels that would be applied. Gmail is never mutated."
              : "Priority, review, and new-contest terms are matched locally. A bounded run can stop before the source label is exhausted."}</p>

            <label className="trial-toggle" htmlFor="trialMode">
              <input
                id="trialMode"
                type="checkbox"
                checked={trialMode}
                disabled={busy || !state.connected}
                onChange={(event) => {
                  setTrialMode(event.target.checked);
                  if (!event.target.checked) {
                    setTrialResults([]);
                    setTrialNextPageToken(null);
                    setTrialExhausted(false);
                  }
                }}
              />
              <span>
                <strong>Trial mode</strong>
                <small>Dry-run 10 messages at a time — no label changes</small>
              </span>
            </label>

            <div className="sync-actions">
              {trialMode ? (
                <>
                  <button
                    className="button"
                    type="button"
                    disabled={busy || !state.connected || !state.configured}
                    onClick={() => void runSync({ trial: true })}
                  >
                    {action === "syncing" ? <><span className="spinner" aria-hidden="true" />Trial running…</> : "Run trial"}
                  </button>
                  {canTrialMore && (
                    <button
                      className="button secondary-ink"
                      type="button"
                      disabled={busy}
                      onClick={() => void runSync({ trial: true, pageToken: trialNextPageToken })}
                    >
                      Trial more
                    </button>
                  )}
                </>
              ) : (
                <button
                  className="button"
                  type="button"
                  disabled={busy || !state.connected || !state.configured}
                  onClick={() => void runSync({
                    trial: false,
                    pageToken: liveNextPageToken,
                  })}
                >
                  {action === "syncing"
                    ? <><span className="spinner" aria-hidden="true" />Syncing safely…</>
                    : liveNextPageToken ? "Continue sync" : "Run sync"}
                </button>
              )}
            </div>
          </>
        )}
      </article>
    </section>

    {trialMode && (
      <section className="history trial-results" aria-label="Trial results">
        <div className="section-heading">
          <div>
            <p className="step">TRIAL RESULTS</p>
            <h2>Proposed label changes</h2>
          </div>
          <p>No Gmail labels are applied in trial mode. Blocked and unmatched propose contest-archive. Subjects and senders only — no message bodies.</p>
        </div>
        <RunResultsList
          results={trialResults}
          emptyTitle="No trial batch yet"
          emptyDescription="Run a trial to preview how the next 10 messages would be labeled."
        />
      </section>
    )}

    <section className="history">
      <div className="section-heading">
        <div>
          <p className="step">RECENT ACTIVITY</p>
          <h2>Sync runs</h2>
        </div>
        <p>Open a run to review message links, normalized senders, and outcomes. Message subjects and bodies are not retained.</p>
      </div>
      {state.runs.length === 0 ? (
        <div className="empty">
          <span aria-hidden="true">◎</span>
          <h3>No sync runs yet</h3>
          <p>Connect Gmail and run your first bounded sync. Results will appear here.</p>
        </div>
      ) : (
        <div className="run-list">
          {state.runs.map((run) => (
            <div className="run" key={run.id}>
              <Link className="run-main" href={`/runs/${run.id}`}>
                <span className={`status-dot ${run.status}`} aria-hidden="true" />
                <div className="run-copy">
                  <div>
                    <strong>{statusText[run.status]}</strong>
                    {run.trial && <span className="trial-badge">Trial</span>}
                    <time dateTime={run.startedAt}>{formatRunTime(run.startedAt)}</time>
                  </div>
                  <p>{run.errorSummary ?? runMessage(run.status, run.trial)}</p>
                </div>
                <code>{run.id.slice(0, 8)}</code>
              </Link>
              <DeleteRunButton
                runId={run.id}
                trial={run.trial}
                onDeleted={(id) => {
                  setState((current) => ({
                    ...current,
                    runs: current.runs.filter((entry) => entry.id !== id),
                  }));
                  setNotice("Run deleted from the database. Gmail was not changed.");
                  setError(null);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </section>

    <footer><strong>Safety by design</strong><span>No Gmail search · No message bodies · Label moves + optional Trash for contest-archive</span></footer>
  </main>;
}
