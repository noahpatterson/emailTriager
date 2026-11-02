"use client";

import Link from "next/link";
import { useState } from "react";
import { RunResultsList } from "@/app/run-results";
import type { SyncStartResult } from "@/src/server/gmail/sync";

export function PersonalTrial({ connected, configured, gmailMessageLinkRoot, onRunningChange }: {
  connected: boolean;
  configured: boolean;
  gmailMessageLinkRoot: string;
  onRunningChange: (running: boolean) => void;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncStartResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(pageToken?: string): Promise<void> {
    setRunning(true);
    onRunningChange(true);
    setError(null);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        redirect: "error",
        body: JSON.stringify({ trial: true, ...(pageToken ? { pageToken } : {}) }),
      });
      if (!response.ok) throw new Error();
      setResult(await response.json() as SyncStartResult);
    } catch {
      setError("The trial could not finish. Check your Gmail connection and configuration, then try again.");
    } finally {
      setRunning(false);
      onRunningChange(false);
    }
  }

  const disabled = running || !connected || !configured;
  return <section className="card" aria-labelledby="personal-trial-heading" aria-busy={running}>
    <p className="step">02 · READONLY TRIAL</p>
    <h2 id="personal-trial-heading">Preview your rules</h2>
    <p>Read at most five messages from your source label per batch. Your configured sender and keyword rules produce the preview. This trial makes no Gmail changes and sends no messages to external AI.</p>
    {!connected && <p>Connect Gmail before running a trial.</p>}
    {!configured && <p>Save your source label and destination labels in <Link href="/configuration">Configuration</Link> before running a trial.</p>}
    <div className="contest-actions">
      <button type="button" className="button" disabled={disabled} onClick={() => { void run(); }}>{running ? "Running trial…" : "Run trial"}</button>
      {result?.nextPageToken && <button type="button" className="button secondary" disabled={disabled} onClick={() => { void run(result.nextPageToken ?? undefined); }}>Continue trial batch</button>}
    </div>
    <div aria-live="polite">
      {running && <p>Trial in progress. Keep this page open.</p>}
      {error && <p role="alert">{error}</p>}
      {result && <p>{result.results.length} messages in the latest batch. {result.status === "partial_failure" ? "Some messages could not be processed." : result.exhausted ? "The source label is exhausted." : "More messages may remain."}</p>}
    </div>
    {result && <RunResultsList results={result.results} emptyTitle="No messages in this batch" emptyDescription="Check the configured source label in Gmail." gmailMessageLinkRoot={gmailMessageLinkRoot} />}
  </section>;
}
