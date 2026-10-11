"use client";

import Link from "next/link";
import { MAX_CONTEST_MODEL_CALLS } from "@/src/server/gmail/contest-usage";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ContestCategory } from "@/src/server/gmail/contest-classify";
import { CONTEST_DESTINATIONS, type ContestCorrectionResponse, ContestLabels, ContestOverview, ContestResultRow, ContestRunSummary, ContestScanResponse, ContestSettings } from "@/src/server/gmail/contest-contracts";

const CATEGORIES: readonly ContestCategory[] = ["winner", "new_contest", "entry_confirmation", "notification_update", "irrelevant"];
const CATEGORY_NAMES: Record<ContestCategory, string> = {
  winner: "Winner", new_contest: "New contest", entry_confirmation: "Entry confirmation",
  notification_update: "Notification or update", irrelevant: "Irrelevant",
};
const EMPTY_LABELS: ContestLabels = {
  winner: "", new_contest: "", entry_confirmation: "", notification_update: "", irrelevant: "",
};

export function formatContestProbability(value: number): string {
  return Number.isFinite(value) && value >= 0 && value <= 1
    ? `${Math.round(value * 100)}%` : "Unavailable";
}

export function formatContestCost(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `Estimated cost: $${value.toFixed(6)}` : "Cost estimate unavailable";
}

/** Restore persisted unfinished batches after a refresh or interrupted request. */
export function contestResumeCursor(run: ContestRunSummary | null): { token: string; trial: boolean } | null {
  return run && run.status !== "completed" && run.nextPageToken
    ? { token: run.nextPageToken, trial: run.trial } : null;
}

export function preferContestRun(current: ContestRunSummary | null, incoming: ContestRunSummary | null): ContestRunSummary | null {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming.startedAt < current.startedAt) return current;
  if (incoming.id === current.id && current.status !== "running" && incoming.status === "running") return current;
  return incoming;
}

export function ContestProgress({ run }: { run: ContestRunSummary }) {
  const progress = run.progress;
  if (!progress) return <p>{run.scanned} emails checked in this batch. Total progress will be available for newly started batches.</p>;
  const checked = progress.completedBefore + run.scanned;
  const finished = run.status === "completed" || run.status === "bounded_incomplete";
  const batches = progress.completedBatchesBefore + Number(finished && (progress.batchTotal ?? 0) > 0);
  const estimatedTotal = progress.totalEstimate === null ? null : Math.max(progress.totalEstimate, checked);
  const estimatedBatches = estimatedTotal === null ? null : Math.max(batches, Math.ceil(estimatedTotal / MAX_CONTEST_MODEL_CALLS));
  return <div>
    <p><strong>{checked} / {estimatedTotal === null ? "unknown total" : `about ${estimatedTotal}`} emails checked</strong></p>
    <p>{batches} / {estimatedBatches === null ? "unknown total" : `about ${estimatedBatches}`} batches finished. Current batch: {run.scanned} / {progress.batchTotal ?? "waiting for Gmail"} checked.</p>
    {progress.batchTotal !== null && progress.batchTotal > 0 && <progress aria-label="Current batch progress" value={Math.min(run.scanned, progress.batchTotal)} max={progress.batchTotal} />}
    {progress.trackingStartedMidScan && <p>Progress tracking started with this continued batch. Earlier batches are not included in these counts.</p>}
    <p className="contest-muted">The total is an advisory Gmail estimate captured when progress tracking began. New mail and archiving can change the mailbox. Checked counts include skipped and failed messages; failures are listed below.</p>
    {run.status === "completed" && <p>Source scan finished.</p>}
  </div>;
}

export function ContestResults({ results, trial, busy, onCorrect }: {
  results: readonly ContestResultRow[];
  trial: boolean;
  busy: boolean;
  onCorrect: (messageId: string, category: ContestCategory) => Promise<void>;
}) {
  const sorted = [...results].sort((a, b) => b.explicitWinProbability - a.explicitWinProbability);
  if (!sorted.length) return <p>No contest results in this {trial ? "trial batch" : "view"}.</p>;
  return <ol className="contest-results">
    {sorted.map((result) => <li key={result.gmailMessageId}>
      <ContestResult key={`${result.gmailMessageId}:${result.manualCategory}`} result={result} trial={trial} busy={busy} onCorrect={onCorrect} />
    </li>)}
  </ol>;
}

function ContestResult({ result, trial, busy, onCorrect }: {
  result: ContestResultRow; trial: boolean; busy: boolean;
  onCorrect: (messageId: string, category: ContestCategory) => Promise<void>;
}) {
  const effectiveCategory = result.manualCategory ?? result.category;
  const [category, setCategory] = useState<ContestCategory>(effectiveCategory);
  const protectedMessage = result.labelStatus === "protected";
  async function correct(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await onCorrect(result.gmailMessageId, category);
  }
  return <article className="contest-result">
    <div className="contest-result-heading">
      <div><h3>{result.subject || "No subject"}</h3><p className="contest-sender">{result.sender}</p></div>
      <a className="button secondary-ink" href={result.gmailUrl} target="_blank" rel="noreferrer">Open in Gmail</a>
    </div>
    <dl className="contest-scores">
      <div><dt>Win probability</dt><dd>{formatContestProbability(result.explicitWinProbability)}</dd></div>
      <div><dt>Claim action probability</dt><dd>{formatContestProbability(result.claimActionProbability)}</dd></div>
      <div><dt>Classification confidence</dt><dd>{formatContestProbability(result.confidence)}</dd></div>
    </dl>
    <p>Model category: <strong>{CATEGORY_NAMES[result.category]}</strong>{result.manualCategory && <> · Your correction: <strong>{CATEGORY_NAMES[result.manualCategory]}</strong></>}</p>
    <p>Claim deadline: {result.claimDeadline || "Unknown"}</p>
    <p className="contest-muted">{trial ? "Trial preview. No Gmail labels or notifications were sent." : `Gmail labels: ${result.labelStatus}. Notification: ${result.notificationStatus ?? "not sent"}.`}</p>
    {!trial && <form className="contest-correction" onSubmit={(event) => { void correct(event); }}>
      <label>Correct category for {result.subject || "this message"}
        <select value={category} disabled={busy || protectedMessage} onChange={(event) => setCategory(event.target.value as ContestCategory)}>
          {CATEGORIES.map((value) => <option key={value} value={value}>{CATEGORY_NAMES[value]}</option>)}
        </select>
      </label>
      <button className="button secondary-ink" type="submit" disabled={busy || protectedMessage || category === effectiveCategory}>Apply correction</button>
      {protectedMessage && <p>Protected message. Gmail labels cannot be changed here.</p>}
    </form>}
  </article>;
}

export function contestRequestError(code: string): string {
  if (code.startsWith("label_not_found_")) {
    const category = code.slice("label_not_found_".length) as ContestCategory;
    if (CATEGORIES.includes(category)) return `${CATEGORY_NAMES[category]} label was not found in Gmail. Use its exact name, such as jev/winner.`;
  }
  const messages: Record<string, string> = {
    invalid_labels: "Choose three distinct existing Gmail user labels, different from your source label.",
    source_label_missing: "Your source label was not found in Gmail. Update the source label in Configuration.",
    gmail_or_configuration_missing: "Connect Gmail and save your source label in Configuration first.",
    gmail_reauthorization_required: "Gmail authorization expired. Reconnect Gmail from the dashboard.",
    already_running: "Another scan is running. Wait for it to finish, then try again.",
    contest_disabled: "Contest scanning is disabled in this app profile.",
    invalid_continuation: "That batch cursor belongs to an older scan or configuration. Refresh results to continue the current scan, or start a new scan.",
  };
  return messages[code] ?? "Contest request failed. Refresh and try again.";
}

export function contestScanBlocker(overview: ContestOverview | null): string | null {
  if (!overview) return "Load contest settings before scanning. Use Refresh results to retry.";
  if (overview.disabled) return "Contest scanning is disabled in this app profile.";
  if (!overview.settings) return "Save Winner, New Contest, and Irrelevant destination labels to enable scanning.";
  if (!overview.modelConfigured) return "Set JEV_API_KEY in the server environment, then restart the app and refresh results to enable scanning.";
  return null;
}

async function requestJson<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method, credentials: "same-origin", redirect: "error", signal,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const value = await response.json().catch(() => null) as { error?: unknown } | null;
    const code = typeof value?.error === "string" ? value.error : "request_failed";
    throw new Error(contestRequestError(code));
  }
  return await response.json() as T;
}

export function ContestClient() {
  const [overview, setOverview] = useState<ContestOverview | null>(null);
  const [labels, setLabels] = useState<ContestLabels>(EMPTY_LABELS);
  const [busy, setBusy] = useState(true);
  const [scanning, setScanning] = useState(false);
  const pollVersion = useRef(0);
  const scanController = useRef<AbortController | null>(null);
  const precedingRunId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<readonly ContestResultRow[] | null>(null);
  const [run, setRun] = useState<ContestRunSummary | null>(null);
  const [cursor, setCursor] = useState<{ token: string; trial: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void requestJson<ContestOverview>("/api/contest", "GET", undefined, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setOverview(value); setLabels(value.settings?.labels ?? EMPTY_LABELS); setRun(value.latestRun);
        setCursor(contestResumeCursor(value.latestRun));
      }).catch(() => {
        if (!controller.signal.aborted) setError("Contest settings could not be loaded. Try refreshing.");
      }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);

  const shouldPoll = scanning || run?.status === "running";
  useEffect(() => {
    if (!shouldPoll) return;
    const controller = new AbortController();
    const version = pollVersion.current;
    let timer: ReturnType<typeof setTimeout>;
    async function poll(): Promise<void> {
      try {
        const value = await requestJson<ContestOverview>("/api/contest", "GET", undefined, controller.signal);
        if (controller.signal.aborted || version !== pollVersion.current) return;
        if (scanning && value.latestRun?.id === precedingRunId.current) return;
        setRun(current => preferContestRun(current, value.latestRun));
        if (value.latestRun?.errorCode === "scan_interrupted") scanController.current?.abort();
        if (value.latestRun?.status !== "running") setCursor(contestResumeCursor(value.latestRun));
        setOverview(current => preferContestRun(current?.latestRun ?? null, value.latestRun) === value.latestRun ? value : current);
      } catch {
        if (!controller.signal.aborted && version === pollVersion.current) setNotice("Waiting for scan progress. The scan may still be running.");
      } finally {
        if (!controller.signal.aborted && version === pollVersion.current) timer = setTimeout(() => { void poll(); }, 2000);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [shouldPoll, scanning]);

  async function refresh(): Promise<void> {
    setBusy(true); setError(null); setNotice(null);
    try {
      const value = await requestJson<ContestOverview>("/api/contest");
      setOverview(value); setLabels(value.settings?.labels ?? EMPTY_LABELS);
      setRun(value.latestRun); setPreview(null); setCursor(contestResumeCursor(value.latestRun));
    } catch { setError("Results could not be refreshed. Your current view has been kept."); }
    finally { setBusy(false); }
  }

  async function configure(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try {
      const value = await requestJson<{ settings: ContestSettings }>("/api/contest", "POST", { action: "configure", labels: { ...labels, entry_confirmation: labels.irrelevant, notification_update: labels.irrelevant } });
      setOverview((current) => current && { ...current, settings: value.settings });
      setLabels(value.settings.labels); setNotice("Contest labels saved.");
      const updated = await requestJson<ContestOverview>("/api/contest");
      setOverview(updated);
    } catch (error) { setError(error instanceof Error ? error.message : "Labels could not be saved. Try again."); }
    finally { setBusy(false); }
  }

  async function scan(trial: boolean, pageToken?: string): Promise<void> {
    pollVersion.current += 1;
    const controller = new AbortController();
    scanController.current = controller;
    precedingRunId.current = run?.id ?? null;
    setScanning(true);
    setOverview(current => current && { ...current, results: [] });
    setPreview(trial ? [] : null);
    setBusy(true); setError(null); setNotice(trial ? "Trial in progress. Keep this page open." : "Scan in progress. Keep this page open.");
    try {
      const value = await requestJson<ContestScanResponse>("/api/contest", "POST", { action: "scan", trial, ...(pageToken ? { pageToken } : {}) }, controller.signal);
      setRun(value.run);
      if (value.run.trial) setPreview(value.results);
      else {
        setPreview(null);
        setOverview((current) => {
          if (!current) return current;
          return { ...current, latestRun: value.run, results: value.results };
        });
      }
      setCursor(contestResumeCursor(value.run));
      const failed = value.run.status === "failed" || value.run.status === "partial_failure";
      setNotice(failed ? "Batch ended with errors. Results and progress updated; check the status below." : value.run.trial ? "Trial batch complete. Preview updated; Gmail labels were not changed." : `Batch complete. Results updated. ${value.run.classified} classified, ${value.run.skipped} skipped, ${value.run.failed} failed.`);
    } catch (error) { setError(error instanceof Error ? error.message : "Scan could not be completed. Refresh results before retrying."); setNotice(null); }
    finally { scanController.current = null; pollVersion.current += 1; setScanning(false); setBusy(false); }
  }

  async function correct(messageId: string, category: ContestCategory): Promise<void> {
    setBusy(true); setError(null); setNotice(null);
    try {
      const value = await requestJson<ContestCorrectionResponse>(`/api/contest/${encodeURIComponent(messageId)}`, "PATCH", { category });
      setOverview((current) => current && { ...current, results: current.results.map((row) => row.gmailMessageId === messageId ? value.result : row) });
      setNotice("Category correction saved.");
    } catch { setError("Correction could not be saved. The previous result has been kept."); }
    finally { setBusy(false); }
  }

  const disabled = busy || run?.status === "running" || !overview || overview.disabled;
  const scanBlocker = contestScanBlocker(overview);
  const scanDisabled = disabled || scanBlocker !== null;
  const visibleResults = preview ?? overview?.results ?? [];
  return <div className="contest-content" aria-busy={busy}>
    {error && <p className="alert error" role="alert">{error}</p>}
    {notice && <p className="alert" role="status">{notice}</p>}
    {!overview && busy && <p role="status">Loading contest settings…</p>}
    {overview?.disabled && <p className="alert">Contest scanning is disabled in this app profile.</p>}
    <section className="card contest-controls" aria-labelledby="contest-scan-heading">
      <h2 id="contest-scan-heading">Scan contest mail</h2>
      <p>Uses your existing <Link href="/configuration">source label and sender configuration</Link>. Each scan or trial classifies a new batch of at most {MAX_CONTEST_MODEL_CALLS} messages. A live scan may also retry saved label or notification work. Every eligible unprocessed message sends a bounded body to TypeSafe Jev for classification when you start a scan or trial. Contest scans do not require a keyword match.</p>
      <p>Model: {overview ? overview.modelConfigured ? "Configured" : "Not configured" : "Checking"}. Notifications: {overview ? overview.notificationsConfigured ? "Configured and opted in" : "Disabled until configured and opted in" : "Checking"}.</p>
      <p className="contest-muted">Winner notifications require an explicit win probability of at least 90%. Trial previews never send notifications.</p>
      {!busy && scanBlocker && <p className="alert" role="status">{scanBlocker}</p>}
      <div className="contest-actions">
        <button className="button" disabled={scanDisabled} onClick={() => { void scan(false); }}>Run scan</button>
        <button className="button secondary-ink" disabled={scanDisabled} onClick={() => { void scan(true); }}>Run trial</button>
        {cursor && <button className="button secondary-ink" disabled={scanDisabled} onClick={() => { void scan(cursor.trial, cursor.token); }}>Continue {cursor.trial ? "trial" : "scan"} batch</button>}
        <button className="button secondary-ink" disabled={busy} onClick={() => { void refresh(); }}>Refresh results</button>
      </div>
      <p className="contest-muted">A trial previews classifications without changing Gmail labels. A live scan applies the configured contest labels. Filed mail moves out of Inbox and gets contest-archive. Winner and New Contest keep their unread status under their Jev labels. Whitelist mail goes to not-contest and is marked read. AI-classified Irrelevant and blocklisted mail goes to the Irrelevant label and is marked read. Starred and invalid-sender mail stay protected. Reused classifications retain their saved category; failed requests remain retryable. Missing filing labels are created only during live scans.</p>
      {run && <div className="contest-run" role="status">
        <h3>{run.trial ? "Latest trial" : "Latest scan"}: {run.status.replaceAll("_", " ")}</h3>
        <ContestProgress run={run} />
        <p>{run.scanned} scanned · {run.candidates} candidates · {run.classified} classified · {run.skipped} skipped · {run.failed} failed</p>
        <p>{run.inputTokens} input tokens · {run.outputTokens} output tokens · {formatContestCost(run.estimatedCostUsd)}</p>
        <p className="contest-muted">Token counts cover successful model responses. Failed-request charges are unknown.</p>
        {run.status === "bounded_incomplete" && <p>The safety limit was reached. Continue the batch when ready.</p>}
        {(run.status === "failed" || run.status === "partial_failure") && <p>Some work failed. Refresh results before starting another scan.</p>}
        {run.errorCode === "scan_interrupted" && <p>The scan stopped reporting progress. Its unfinished batch can be retried after the lease expires.</p>}
        {run.errorCode === "gmail_reauthorization_required" && <p><Link href="/">Reconnect Gmail from the dashboard</Link> before retrying.</p>}
      </div>}
    </section>
    <section className="card" aria-labelledby="contest-labels-heading">
      <h2 id="contest-labels-heading">Contest destination labels</h2>
      <p>Enter three distinct existing Gmail label names or IDs. Entry confirmations and notifications or updates always use the Irrelevant destination. Nested labels use a slash, for example jev/winner. A Gmail URL fragment such as jev%2Fwinner is also accepted. These destinations belong to contest scans; the existing deterministic sync keeps its configured categories.</p>
      <form className="contest-label-form" onSubmit={(event) => { void configure(event); }}>
        <div className="contest-label-fields">
          {CONTEST_DESTINATIONS.map((category) => <label key={category}>{CATEGORY_NAMES[category]}
            <input required maxLength={200} disabled={disabled} value={labels[category]} onChange={(event) => setLabels((current) => ({ ...current, [category]: event.target.value }))} />
          </label>)}
        </div>
        <button type="submit" className="button secondary-ink" disabled={disabled}>Save contest labels</button>
      </form>
    </section>
    <section className="history" aria-labelledby="contest-results-heading">
      <div className="section-heading"><h2 id="contest-results-heading">{preview ? "Trial preview" : "Contest results"}</h2><p>{visibleResults.length} results · highest win probability first · {scanning ? preview !== null ? "progress updates during trial; preview updates after each batch" : "results updating during scan" : "latest batch only"}</p></div>
      {run && run.classified === 0 && run.status !== "running" && <p>No new classifications in the latest batch. {run.skipped} messages were skipped or reused. Only classified items reviewed in this batch appear below.</p>}
      {preview && <p className="alert">These results are not saved. Refresh results to clear this preview. Category corrections are available after a live scan.</p>}
      <ContestResults results={visibleResults} trial={preview !== null} busy={disabled} onCorrect={correct} />
    </section>
  </div>;
}
