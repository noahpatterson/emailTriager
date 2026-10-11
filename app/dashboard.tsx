"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { BrandLogo } from "@/app/brand-logo";
import { GmailLabelJumpLinks } from "@/app/gmail-label-jumps";
import { OwnerNav } from "@/app/owner-nav";
import type { OwnerUser } from "@/app/owner-user";
import { UserMenu } from "@/app/user-menu";
import { DEMO_RESET_COPY } from "@/src/server/demo/session-token";
import type { GmailLabelJump } from "@/src/server/gmail/gmail-url";
import { ContestClient, ContestRunActivity, preferContestRun } from "@/app/contests/contest-client";
import type { ContestRunSummary } from "@/src/server/gmail/contest-contracts";

export type { RunStatus } from "@/app/run-status";
export { formatRunTime, runMessage } from "@/app/run-status";

export type DashboardState = Readonly<{
  connected: boolean;
  reconnectRequired: boolean;
  configured: boolean;
  gmailMessageLinkRoot: string;
  gmailLabelJumps: readonly GmailLabelJump[];
  runs: readonly ContestRunSummary[];
}>;
export type DashboardUser = OwnerUser;

type ActionState = "idle" | "connecting" | "disconnecting";

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    redirect: "manual",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function Dashboard({
  initialState,
  user,
  demoProfile = false,
}: {
  initialState: DashboardState;
  user: DashboardUser;
  demoProfile?: boolean;
}) {
  const [state, setState] = useState(initialState);
  const [action, setAction] = useState<ActionState>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [contestBusy, setContestBusy] = useState(false);
  const updateContestRun = useCallback((run: ContestRunSummary | null) => {
    if (!run) return;
    setState(current => ({
      ...current,
      runs: [preferContestRun(current.runs.find(saved => saved.id === run.id) ?? null, run) ?? run,
        ...current.runs.filter(saved => saved.id !== run.id)]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 30),
    }));
  }, []);

  async function connect(): Promise<void> {
    if (demoProfile) {
      setNotice("The demo mailbox is already connected to the fixture corpus.");
      return;
    }
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

  async function disconnect(): Promise<void> {
    if (demoProfile) {
      setNotice("Demo sessions keep the fixture mailbox. Use Clear my demo data to wipe this visitor.");
      return;
    }
    if (!window.confirm("Disconnect Gmail? Saved configuration and sanitized run history will be kept.")) return;
    setAction("disconnecting"); setError(null); setNotice(null);
    try {
      const response = await post("/api/disconnect");
      if (!response.ok) throw new Error();
      setState((current) => ({ ...current, connected: false, reconnectRequired: false }));
      setNotice("Gmail disconnected. Local token material was removed.");
    } catch { setError("Gmail could not be disconnected. Please try again."); }
    finally { setAction("idle"); }
  }

  async function resetDemo(): Promise<void> {
    if (!window.confirm(DEMO_RESET_COPY)) return;
    setResetting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await post("/api/demo/reset");
      if (!response.ok) throw new Error();
      window.location.assign("/auth/sign-in");
    } catch {
      setError("Demo data could not be cleared. Please try again.");
      setResetting(false);
    }
  }

  const busy = action !== "idle" || contestBusy;

  return <main className="shell" aria-busy={busy}>
    <header className="hero">
      <div className="brand-heading">
        <BrandLogo size="lg" />
        <div className="brand-heading-copy">
          <p className="eyebrow">{demoProfile ? "PUBLIC DEMO" : "OWNER CONSOLE"}</p>
          <h1>Email Triage</h1>
          <p className="lede">
            {demoProfile
              ? "Explore fixture mail. Review and demotion use seeded mock verdicts."
              : "Classify bounded batches of Gmail messages with TypeSafe Jev."}
          </p>
          <OwnerNav active="home" />
        </div>
      </div>
      <div className="hero-aside">
        <span className={`connection ${state.connected ? "online" : "offline"}`}>
          <i />
          {demoProfile
            ? (state.connected ? "Fixture mailbox ready" : "Fixture mailbox missing")
            : (state.connected
              ? "Gmail connected"
              : state.reconnectRequired ? "Gmail reconnect required" : "Gmail disconnected")}
        </span>
        <UserMenu
          user={user}
          demoProfile={demoProfile}
          onResetDemo={() => void resetDemo()}
          resetting={resetting}
        />
      </div>
    </header>

    <div className="announcements" aria-live="polite" aria-atomic="true">
      {error && <div className="alert error" role="alert"><strong>Action needed</strong><span>{error}</span></div>}
      {notice && <div className="alert success" role="status"><strong>Update</strong><span>{notice}</span></div>}
    </div>

    <section className="grid dashboard-controls" aria-label="Email triage controls">
      <article className="card primary-card">
        <p className="step">01 · CONNECTION</p>
        <h2>
          {demoProfile
            ? (state.connected ? "Fixture mailbox is ready" : "Demo mailbox missing")
            : (state.connected
              ? "Your Gmail account is ready"
              : state.reconnectRequired ? "Reconnect your Gmail account" : "Connect your Gmail account")}
        </h2>
        <p>
          {demoProfile
            ? "This session uses a fixture mailbox. Jev scans are available in the owner console."
            : (state.connected
              ? "Only the configured source label is read. Email bodies, attachments, and OAuth tokens are never shown here."
              : state.reconnectRequired
                ? "Google no longer accepts the saved authorization. Reconnect Gmail to restore access. Your configuration and run history will be kept."
                : "Authorize read and label access for the owner account. Jev scans classify your source label and file messages in Gmail.")}
        </p>
        {demoProfile ? (
          <p className="field-help">Open Review for five seeded disagreements, or Demotions for one pending archive confirm. Live model audits stay off.</p>
        ) : state.connected ? (
          <button className="button secondary" type="button" disabled={busy} onClick={disconnect}>{action === "disconnecting" ? "Disconnecting…" : "Disconnect Gmail"}</button>
        ) : (
          <button className="button" type="button" disabled={busy} onClick={connect}>
            {action === "connecting" ? "Opening Google…" : state.reconnectRequired ? "Reconnect Gmail" : "Connect Gmail"}
          </button>
        )}
      </article>

    </section>

    {demoProfile ? (
      <section className="card" aria-label="Jev scan">
        <p className="step">02 · BOUNDED SYNC</p>
        <h2>Jev scans are owner-only</h2>
        <p>The public demo uses a fixture mailbox. Jev scans are available in the owner console.</p>
      </section>
    ) : <ContestClient connected={state.connected && action !== "disconnecting"} configured={state.configured} onRunChange={updateContestRun} onScanningChange={setContestBusy} />}

    {state.gmailLabelJumps.length > 0 ? (
      <section className="card gmail-label-jumps-card" aria-label="Gmail label shortcuts">
        <p className="step">GMAIL LABELS</p>
        <h2>Jump to a label</h2>
        <p>Open each triage label in Gmail to manually review what’s filed there.</p>
        <GmailLabelJumpLinks
          links={state.gmailLabelJumps}
          heading="Jump to a label"
          showHeading={false}
        />
      </section>
    ) : null}

    <section className="history">
      <div className="section-heading">
        <div>
          <p className="step">RECENT ACTIVITY</p>
          <h2>Sync runs</h2>
        </div>
        <p>Open a run to review subjects, senders, and outcomes. Message bodies are never shown.</p>
      </div>
      {state.runs.length === 0 ? (
        <div className="empty">
          <span aria-hidden="true">◎</span>
          <h3>No Jev runs yet</h3>
          <p>Connect Gmail and run your first Jev batch. Results will appear here.</p>
        </div>
      ) : <div className="run-list">
        {state.runs.map(run => <ContestRunActivity key={run.id} run={run} />)}
      </div>}
    </section>

    <footer><strong>Safety by design</strong><span>Bounded Jev batches · No message bodies shown · Starred mail stays protected</span></footer>
  </main>;
}
