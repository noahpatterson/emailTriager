import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContestResults, ContestProgress, ContestRunActivity, preferContestRun, contestScanBlocker, contestRequestError, contestResumeCursor, formatContestCost, formatContestProbability } from "../../app/contests/contest-client";
import type { ContestResultRow, ContestRunSummary } from "../../src/server/gmail/contest-contracts";

const base: ContestResultRow = {
  gmailMessageId: "one", gmailThreadId: "thread", sender: "sender@example.test",
  subject: "Possible winner", category: "winner", manualCategory: null,
  explicitWinProbability: 0.93, claimActionProbability: 0.31, confidence: 0.87,
  claimDeadline: null, model: "test", promptVersion: "v1", inputTokens: 1,
  outputTokens: 1, labelStatus: "applied", notificationStatus: null,
  gmailUrl: "https://mail.google.com/mail/u/0/#all/thread",
};
const onCorrect = async (): Promise<void> => {};
function render(results: readonly ContestResultRow[], trial = false): string {
  return renderToStaticMarkup(createElement(ContestResults, { results, trial, busy: false, onCorrect }));
}

describe("contest result presentation", () => {
  it("orders mail by win probability and keeps claim action distinct", () => {
    const html = render([{ ...base, gmailMessageId: "low", subject: "Lower score", explicitWinProbability: 0.1 }, base]);
    expect(html.indexOf("Possible winner")).toBeLessThan(html.indexOf("Lower score"));
    expect(html).toContain("Win probability</dt><dd>93%");
    expect(html).toContain("Claim action probability</dt><dd>31%");
    expect(html).toContain("Classification confidence</dt><dd>87%");
    expect(html).toContain("Claim deadline: Unknown");
  });

  it("offers no corrections for unsaved trial rows", () => {
    const html = render([base], true);
    expect(html).toContain("Trial preview");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Apply correction");
    expect(html).toContain(base.gmailUrl);
  });

  it("shows saved Jev details without mutation controls when reviewing a historical run", () => {
    const html = renderToStaticMarkup(createElement(ContestResults, { results: [base], trial: false, busy: false }));
    expect(html).toContain("Model: test");
    expect(html).toContain("Prompt: v1");
    expect(html).toContain("input tokens");
    expect(html).not.toContain("Apply correction");
  });

  it("shows model and manual categories while protecting Gmail labels", () => {
    const html = render([{ ...base, manualCategory: "entry_confirmation", labelStatus: "protected", subject: "<unsafe>" }]);
    expect(html).toContain("Model category: <strong>Winner</strong>");
    expect(html).toContain("Your correction: <strong>Entry confirmation</strong>");
    expect(html).toContain("Protected message");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("&lt;unsafe&gt;");
  });

  it("does not display invalid model probabilities as real scores", () => {
    for (const value of [NaN, Infinity, -0.1, 1.1]) expect(formatContestProbability(value)).toBe("Unavailable");
    expect(formatContestProbability(0)).toBe("0%");
    expect(formatContestProbability(1)).toBe("100%");
  });

  it("distinguishes an unavailable cost from a valid zero-cost estimate", () => {
    for (const value of [undefined, null, NaN, Infinity, -1]) {
      expect(formatContestCost(value)).toBe("Cost estimate unavailable");
    }
    expect(formatContestCost(0)).not.toContain("unavailable");
    expect(formatContestCost(0.000001)).toContain("$0.000001");
  });
});

describe("contest batch recovery", () => {
  const run: ContestRunSummary = {
    id: "batch", status: "running", trial: false, scanned: 0, candidates: 0,
    classified: 0, skipped: 0, failed: 0, inputTokens: 0, outputTokens: 0,
    nextPageToken: "opaque-page-token", startedAt: "2026-10-10T12:00:00Z",
    finishedAt: null, errorCode: null,
  };

  it("links activity to Jev run details and explains bounded completion on the detail view", () => {
    const activity = renderToStaticMarkup(createElement(ContestRunActivity, { run }));
    expect(activity).toContain('href="/runs/batch"');
    const detail = renderToStaticMarkup(createElement(ContestRunActivity, { run: { ...run, status: "bounded_incomplete" }, showDetails: true }));
    expect(detail).toContain("Continue from the dashboard");
    expect(detail).toContain("Failed-request charges are unknown");
  });

  it("restores an interrupted batch without converting a trial to a live scan", () => {
    for (const status of ["running", "bounded_incomplete", "partial_failure", "failed"] as const) {
      const saved = { ...run, status, trial: true };
      expect(contestResumeCursor(saved)).toEqual({ token: "opaque-page-token", trial: true });
      expect(contestResumeCursor({ ...saved, trial: false })?.trial).toBe(false);
    }
  });

  it("does not resume completed or exhausted work", () => {
    expect(contestResumeCursor({ ...run, status: "completed" })).toBeNull();
    expect(contestResumeCursor({ ...run, nextPageToken: null })).toBeNull();
    expect(contestResumeCursor(null)).toBeNull();
  });
});


describe("contest setup feedback", () => {
  const overview = { settings: null, results: [], latestRun: null, disabled: false, modelConfigured: true, notificationsConfigured: false };
  it("keeps scans disabled with an explanation until settings exist", () => {
    expect(contestScanBlocker(overview)).toContain("Winner, New Contest, and Irrelevant");
    const settings = { labels: { winner: "Label_w", new_contest: "Label_n", entry_confirmation: "Label_e", notification_update: "Label_u", irrelevant: "Label_i" } };
    expect(contestScanBlocker({ ...overview, settings })).toBeNull();
    expect(contestScanBlocker({ ...overview, settings, modelConfigured: false })).toContain("JEV_API_KEY");
    expect(contestScanBlocker(null)).toContain("Refresh");
  });
  it("explains sanitized save failures without showing arbitrary server content", () => {
    expect(contestRequestError("label_not_found_winner")).toContain("Winner label was not found");
    expect(contestRequestError("source_label_missing")).toContain("Configuration");
    expect(contestRequestError("PRIVATE_PROVIDER_RESPONSE")).not.toContain("PRIVATE");
  });
});


describe("contest batch visibility", () => {
  const run: ContestRunSummary = {
    id: "live-batch", status: "running", trial: false, scanned: 12, candidates: 3, classified: 2, skipped: 9, failed: 1,
    inputTokens: 10, outputTokens: 2, nextPageToken: "retry-page", startedAt: "2026-10-10T12:00:00Z", finishedAt: null, errorCode: null,
    progress: { batchTotal: 50, completedBefore: 100, completedBatchesBefore: 2, totalEstimate: 523, sourceLabelId: "INBOX", configurationKey: "fixture", inputPageToken: "retry-page", heartbeatAt: "2026-10-10T12:00:01Z" },
  };
  it("shows cumulative approximate totals and exact current batch progress", () => {
    const html = renderToStaticMarkup(createElement(ContestProgress, { run }));
    expect(html).toContain("112 / about 523 emails checked");
    expect(html).toContain("2 / about 11 batches finished");
    expect(html).toContain('value="12" max="50"');
    expect(html).toContain("skipped and failed");
    const finished = renderToStaticMarkup(createElement(ContestProgress, { run: { ...run, status: "bounded_incomplete", scanned: 50 } }));
    expect(finished).toContain("150 / about 523 emails checked");
    expect(finished).toContain("3 / about 11 batches finished");
  });
  it("does not invent a total when Gmail or historical progress is unavailable", () => {
    const unknown = renderToStaticMarkup(createElement(ContestProgress, { run: { ...run, progress: { ...run.progress!, totalEstimate: null } } }));
    expect(unknown).toContain("unknown total");
    const historical = renderToStaticMarkup(createElement(ContestProgress, { run: { ...run, progress: undefined } }));
    expect(historical).toContain("12 emails checked in this batch");
    const legacy = renderToStaticMarkup(createElement(ContestProgress, { run: { ...run, progress: { ...run.progress!, trackingStartedMidScan: true } } }));
    expect(legacy).toContain("Earlier batches are not included");
    expect(legacy).toContain("when progress tracking began");
    expect(legacy).not.toContain("at the start of this scan session");
  });
  it("ignores stale running snapshots after final results arrive", () => {
    const done = { ...run, status: "bounded_incomplete" as const, scanned: 50 };
    expect(preferContestRun(done, run)).toBe(done);
    expect(preferContestRun(done, { ...run, id: "old", startedAt: "2026-10-10T11:00:00Z" })).toBe(done);
    expect(preferContestRun(run, done)).toBe(done);
  });
});
