import { describe, expect, test } from "bun:test";
import { GmailReauthorizationRequiredError } from "../server/gmail/connection-health";
import { ContestScanService, resolveContestLabels } from "../server/gmail/contest-scan";
import { ContestLeaseLostError, type ContestContext, type ContestLease, type ContestStore, type StoredContestMessage } from "../server/gmail/contest-store";
import type { ContestCategory, ContestClassification } from "../server/gmail/contest-classify";
import type { ContestLabels, ContestResultRow, ContestRunSummary, ContestSettings } from "../server/gmail/contest-contracts";
import type { GmailProvider, LabelChange } from "../server/gmail/contracts";

const labels: ContestLabels = { winner: "Label_winner", new_contest: "Label_new", entry_confirmation: "Label_entry", notification_update: "Label_update", irrelevant: "Label_irrelevant" };
const context: ContestContext = { ownerId: "owner", googleSubject: "google", sourceLabelId: "Label_source", terms: { priority: ["contest"], review: [], new: [] }, senderWhitelist: ["friend@example.com"], senderBlocklist: ["blocked@example.com"], linkRoot: "https://mail.google.com/mail/u/0/" };
function classification(category: ContestCategory = "winner"): ContestClassification {
  return { category, categoryProbabilities: { winner: category === "winner" ? 1 : 0, new_contest: category === "new_contest" ? 1 : 0, entry_confirmation: category === "entry_confirmation" ? 1 : 0, notification_update: category === "notification_update" ? 1 : 0, irrelevant: category === "irrelevant" ? 1 : 0 }, confidence: 0.9, explicitWinProbability: 0.95, claimActionProbability: 0.8, model: "fixture", promptVersion: "fixture-v1", usage: { inputTokens: 10, outputTokens: 2 } };
}
function row(id: string): ContestResultRow {
  return { gmailMessageId: id, gmailThreadId: `t-${id}`, sender: "prize@example.com", subject: "Contest winner", category: "winner", manualCategory: null, explicitWinProbability: 0.95, claimActionProbability: 0.8, confidence: 0.9, claimDeadline: null, model: "fixture", promptVersion: "fixture-v1", inputTokens: 10, outputTokens: 2, labelStatus: "pending", notificationStatus: null, gmailUrl: "https://mail.google.com/" };
}
class MemoryStore implements ContestStore {
  rows = new Map<string, StoredContestMessage>();
  runs: ContestRunSummary[] = [];
  selected: ContestSettings | null = { labels };
  held = true;
  events: string[] = [];
  async context() { return context; }
  async settings() { return this.selected; }
  async configure(_: ContestContext, resolved: ContestLabels) { this.selected = { labels: resolved }; }
  async acquire(_: ContestContext, leaseOwner: string): Promise<ContestLease | null> { return this.held ? { ownerId: "owner", googleSubject: "google", leaseOwner, fenceToken: 1 } : null; }
  async renew() { return this.held; }
  async assertLease() { if (!this.held) throw new ContestLeaseLostError(); }
  async release() { this.events.push("released"); }
  async recoverable(_: ContestContext, includeNotifications = false) { return [...this.rows.values()].filter(({ row }) => row.labelStatus === "pending" || (includeNotifications && row.labelStatus === "applied" && (row.notificationStatus === null || row.notificationStatus === "failed") && (row.manualCategory ?? row.category) === "winner" && row.explicitWinProbability >= 0.9)).sort((left, right) => Number(left.row.labelStatus !== "pending") - Number(right.row.labelStatus !== "pending")).slice(0, 5); }
  async results(_: ContestContext, messageIds: readonly string[]) { return [...this.rows.values()].filter(({ row }) => messageIds.includes(row.gmailMessageId)); }
  async message(_: ContestContext, id: string) { return this.rows.get(id) ?? null; }
  async save(_: ContestContext, __: ContestLease, result: ContestResultRow, snapshot: ContestLabels) {
    this.events.push("saved");
    const existing = this.rows.get(result.gmailMessageId);
    if (existing) return existing;
    const stored = { row: result, labels: snapshot }; this.rows.set(result.gmailMessageId, stored); return stored;
  }
  async correct(_: ContestContext, __: ContestLease, id: string, category: ContestCategory) {
    const stored = this.rows.get(id)!; this.rows.set(id, { ...stored, row: { ...stored.row, manualCategory: category, labelStatus: "pending" } });
  }
  async labelStatus(_: ContestContext, __: ContestLease, id: string, status: ContestResultRow["labelStatus"]) {
    const stored = this.rows.get(id)!; this.rows.set(id, { ...stored, row: { ...stored.row, labelStatus: status } });
  }
  async latestRun() { return this.runs.at(-1) ?? null; }
  async saveRun(_: ContestContext, run: ContestRunSummary) { this.runs.push({ ...run, progress: run.progress ? { ...run.progress } : null }); }
  async reserveNotification(_: string, __: string, id: string) {
    const stored = this.rows.get(id);
    if (!stored || stored.row.notificationStatus !== null) return false;
    this.rows.set(id, { ...stored, row: { ...stored.row, notificationStatus: "reserved" } }); return true;
  }
  async finishNotification(_: string, __: string, id: string, status: "sent" | "failed" | "uncertain") {
    const stored = this.rows.get(id)!; this.rows.set(id, { ...stored, row: { ...stored.row, notificationStatus: status } });
  }
}
class FakeGmail implements GmailProvider {
  messages = new Map<string, { from: string; subject: string; labelIds: string[] }>();
  changes: LabelChange[] = [];
  failLabel = false;
  nextPageToken: string | undefined;
  requestedMaximum = 0;
  labelLists = 0;
  createdLabels: { id: string; name: string }[] = [];
  async createLabel(name: string) { const label = { id: `Label_created_${this.createdLabels.length}`, name }; this.createdLabels.push(label); return label; }
  constructor(private readonly events: string[]) { this.add("m1"); }
  add(id: string, from = "prize@example.com", subject = "Contest winner", labelIds = ["Label_source", "INBOX", "UNREAD", "Label_unrelated"]) { this.messages.set(id, { from, subject, labelIds }); }
  async listMessages(input: { sourceLabelId: string; pageToken?: string; maxResults: number }) { this.requestedMaximum = input.maxResults; return { messages: [...this.messages.keys()].slice(0, input.maxResults).map((id) => ({ id, threadId: `t-${id}` })), nextPageToken: this.nextPageToken }; }
  async getMessage(id: string) {
    const message = this.messages.get(id)!;
    return { id, threadId: `t-${id}`, labelIds: message.labelIds, payload: { mimeType: "text/plain", headers: [{ name: "From", value: message.from }, { name: "Subject", value: message.subject }], body: { data: Buffer.from("Reply to claim the contest prize").toString("base64url") } } };
  }
  async listLabels() { this.labelLists += 1; return [...Object.values(labels), "Label_source", "Label_other_winner", "Label_contest_archive", "Label_not_contest"].map((id) => ({ id, name: id === "Label_contest_archive" ? "contest-archive" : id === "Label_not_contest" ? "not-contest" : id })); }
  async modifyLabels(change: LabelChange) {
    this.events.push("labels"); if (this.failLabel) throw new Error("SECRET_PROVIDER_FAILURE"); this.changes.push(change);
    const existing = this.messages.get(change.messageId)!;
    existing.labelIds = [...new Set([...existing.labelIds.filter((id) => !change.removeLabelIds.includes(id)), ...change.addLabelIds])];
  }
  async trashMessage() { throw new Error("Forbidden"); }
  async revoke() { throw new Error("Forbidden"); }
}
function setup() {
  const store = new MemoryStore(); const provider = new FakeGmail(store.events); let calls = 0; let notifications = 0;
  const service = new ContestScanService({ store, providerForOwner: async () => provider, disabled: () => false, modelConfigured: () => true, classifier: async () => { calls += 1; return classification(); }, notifications: { configured: () => true, notify: async () => { notifications += 1; } } });
  return { store, provider, service, calls: () => calls, notifications: () => notifications };
}

describe("standalone contest scan", () => {
  test("classifies mail with no configured keyword even when every keyword list is empty", async () => {
    const state = setup();
    state.store.context = async () => ({ ...context, terms: { priority: [], review: [], new: [] } });
    state.provider.messages.get("m1")!.subject = "A special delivery awaits";
    state.provider.getMessage = async id => ({ id, threadId: `t-${id}`, labelIds: ["Label_source", "INBOX", "UNREAD"], payload: { mimeType: "text/plain", headers: [{ name: "From", value: "prize@example.com" }, { name: "Subject", value: "A special delivery awaits" }], body: { data: Buffer.from("Your name was drawn. Please contact us.").toString("base64url") } } });
    const result = await state.service.scan("owner", { trial: false });
    expect(state.calls()).toBe(1);
    expect(result.run).toMatchObject({ candidates: 1, classified: 1, skipped: 0 });
    expect(result.results.map(row => row.gmailMessageId)).toEqual(["m1"]);
    expect(result.results[0]!.category).toBe("winner");
  });

  test("latest batch replaces history, including an empty batch and refresh", async () => {
    const state = setup();
    await state.service.scan("owner", { trial: false });
    state.provider.messages.clear(); state.provider.add("m2");
    const second = await state.service.scan("owner", { trial: false });
    expect(second.results.map(row => row.gmailMessageId)).toEqual(["m2"]);
    expect((await state.service.overview("owner")).results.map(row => row.gmailMessageId)).toEqual(["m2"]);
    expect(state.store.rows.size).toBe(2);
    state.provider.messages.clear();
    expect((await state.service.scan("owner", { trial: false })).results).toEqual([]);
    expect((await state.service.overview("owner")).results).toEqual([]);
    expect(state.store.rows.size).toBe(2);
  });
  test("trial refresh never substitutes saved history for its unsaved batch", async () => {
    const state = setup();
    await state.service.scan("owner", { trial: false });
    state.provider.messages.clear(); state.provider.add("m2");
    expect((await state.service.scan("owner", { trial: true })).results.map(row => row.gmailMessageId)).toEqual(["m2"]);
    expect((await state.service.overview("owner")).results).toEqual([]);
    expect(state.store.rows.size).toBe(1);
  });

  test("trial classifies bounded page without saved messages, labels or notifications", async () => {
    const state = setup(); for (let i = 2; i <= 52; i++) state.provider.add(`m${i}`);
    state.provider.nextPageToken = "page-two";
    const response = await state.service.scan("owner", { trial: true });
    expect(response.run).toMatchObject({ status: "bounded_incomplete", scanned: 50, classified: 50, inputTokens: 500, outputTokens: 100, nextPageToken: "page-two" });
    expect(response.results).toHaveLength(50); expect(state.calls()).toBe(50); expect(state.provider.requestedMaximum).toBe(50);
    expect(state.store.rows.size).toBe(0); expect(state.provider.changes).toEqual([]); expect(state.notifications()).toBe(0);
  });
  test("saves first then archives Winner mail retaining source, unread and unrelated labels", async () => {
    const state = setup(); await state.service.scan("owner", { trial: false });
    expect(state.store.events.slice(0, 2)).toEqual(["saved", "labels"]);
    expect(state.provider.changes).toEqual([{ messageId: "m1", addLabelIds: ["Label_contest_archive", "Label_winner"], removeLabelIds: ["INBOX"] }]);
    expect(state.provider.messages.get("m1")?.labelIds).toContain("Label_source");
    expect(state.provider.messages.get("m1")?.labelIds).toContain("UNREAD");
    expect(state.provider.messages.get("m1")?.labelIds).not.toContain("INBOX");
    expect(state.store.rows.get("m1")?.row.labelStatus).toBe("applied");
  });
  test("whitelist and blocked mail bypass AI, ordinary mail reaches AI, and protected senders remain untouched", async () => {
    const state = setup(); state.provider.messages.clear();
    state.provider.add("starred", "prize@example.com", "contest", ["STARRED", "Label_source"]);
    state.provider.add("whitelist", "friend@example.com"); state.provider.add("blocklist", "blocked@example.com"); state.provider.add("invalid", "broken");
    state.provider.add("ordinary", "someone@example.com", "Hello");
    // No keyword in the ordinary message body either.
    const original = state.provider.getMessage.bind(state.provider);
    state.provider.getMessage = async (id) => id === "ordinary" ? { ...await original(id), payload: { headers: [{ name: "From", value: "someone@example.com" }], mimeType: "text/plain", body: { data: Buffer.from("Hello").toString("base64url") } } } : original(id);
    const response = await state.service.scan("owner", { trial: false });
    expect(response.run).toMatchObject({ skipped: 4, candidates: 1, classified: 1 }); expect(state.calls()).toBe(1); expect(state.store.rows.size).toBe(1);
    expect(state.provider.changes).toEqual([
      { messageId: "whitelist", addLabelIds: ["Label_contest_archive", "Label_not_contest"], removeLabelIds: ["INBOX", "UNREAD"] },
      { messageId: "blocklist", addLabelIds: ["Label_contest_archive", "Label_irrelevant"], removeLabelIds: ["INBOX", "UNREAD"] },
      { messageId: "ordinary", addLabelIds: ["Label_contest_archive", "Label_winner"], removeLabelIds: ["INBOX"] },
    ]);
    expect(state.provider.messages.get("starred")!.labelIds).toContain("STARRED");
    expect(state.provider.messages.get("invalid")!.labelIds).toContain("INBOX");
  });
  test("retries pending labels with saved snapshot, does not repeat AI, and preserves correction", async () => {
    const state = setup(); state.provider.failLabel = true;
    const first = await state.service.scan("owner", { trial: false });
    expect(first.run.status).toBe("partial_failure"); expect(state.store.rows.get("m1")?.row.labelStatus).toBe("pending");
    state.provider.failLabel = false; state.store.selected = { labels: { ...labels, winner: "Label_other_winner" } };
    await state.service.scan("owner", { trial: false });
    expect(state.calls()).toBe(1); expect(state.provider.changes[0]?.addLabelIds).toEqual(["Label_contest_archive", "Label_winner"]);
    await state.service.correct("owner", "m1", "entry_confirmation");
    expect(state.provider.changes.at(-1)).toEqual({ messageId: "m1", addLabelIds: ["Label_irrelevant"], removeLabelIds: ["Label_winner", "UNREAD"] });
    await state.service.scan("owner", { trial: false });
    expect(state.calls()).toBe(1); expect(state.store.rows.get("m1")?.row.manualCategory).toBe("entry_confirmation");
  });
  test("rechecks live star before labels after classification", async () => {
    const state = setup();
    const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => { state.provider.messages.get("m1")!.labelIds.push("STARRED"); return classification(); }, notifications: { configured: () => false, notify: async () => {} } });
    await service.scan("owner", { trial: false });
    expect(state.store.rows.get("m1")?.row.labelStatus).toBe("protected"); expect(state.provider.changes).toEqual([]);
  });
  test("lease loss after classification prevents persistence and mutation", async () => {
    const state = setup(); const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => { state.store.held = false; return classification(); }, notifications: { configured: () => false, notify: async () => {} } });
    const response = await service.scan("owner", { trial: false });
    expect(response.run).toMatchObject({ status: "failed", errorCode: "lease_lost" }); expect(state.store.rows.size).toBe(0); expect(state.provider.changes).toEqual([]);
  });
  test("classification errors remain safe and never mutate labels", async () => {
    const state = setup(); const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => { throw new Error("PRIVATE_EMAIL_AND_SECRET"); }, notifications: { configured: () => false, notify: async () => {} } });
    const response = await service.scan("owner", { trial: false });
    expect(response.run).toMatchObject({ status: "partial_failure", errorCode: "scan_failed" }); expect(JSON.stringify(response)).not.toContain("PRIVATE_EMAIL_AND_SECRET"); expect(state.provider.changes).toEqual([]);
  });
  test("notification failure does not fail labels or the scan", async () => {
    const state = setup(); const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => classification(), notifications: { configured: () => true, notify: async () => { throw new Error("provider failure"); } } });
    const response = await service.scan("owner", { trial: false });
    expect(response.run.status).toBe("completed"); expect(response.results[0]?.labelStatus).toBe("applied");
  });
  test("disabled fixture mode exposes no storage and cannot scan", async () => {
    const state = setup(); const service = new ContestScanService({ store: state.store, disabled: () => true, notifications: { configured: () => false, notify: async () => {} } });
    expect(await service.overview("owner")).toMatchObject({ disabled: true, settings: null, results: [], latestRun: null });
    await expect(service.scan("owner", { trial: false })).rejects.toThrow("contest_disabled");
  });
  test("rejects source overlap, system labels and duplicate destinations", () => {
    const catalog = [...Object.values(labels), "Label_source", "INBOX"].map((id) => ({ id, name: id }));
    expect(() => resolveContestLabels({ ...labels, winner: "Label_source" }, catalog, "Label_source")).toThrow();
    expect(() => resolveContestLabels({ ...labels, winner: "INBOX" }, catalog, "Label_source")).toThrow();
    expect(() => resolveContestLabels({ ...labels, winner: labels.new_contest }, catalog, "Label_source")).toThrow();
  });
  test("disabled notifications recover pending labels first without revisiting saved winners", async () => {
    const state = setup();
    for (let i = 0; i < 6; i++) state.store.rows.set(`winner-${i}`, { row: { ...row(`winner-${i}`), labelStatus: "applied" }, labels });
    state.store.rows.set("pending", { row: row("pending"), labels });
    state.provider.add("pending");
    state.provider.listMessages = async () => ({ messages: [], nextPageToken: undefined });
    const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => { throw new Error("must not classify"); }, notifications: { configured: () => false, notify: async () => { throw new Error("must not notify"); } } });
    const first = await service.scan("owner", { trial: false });
    expect(first.run.status).toBe("completed");
    expect(first.results).toEqual([]);
    expect((await service.overview("owner")).results).toEqual([]);
    expect(state.store.rows.get("pending")?.row.labelStatus).toBe("applied");
    expect(state.provider.changes).toHaveLength(1);
    const second = await service.scan("owner", { trial: false });
    expect(second.results).toEqual([]);
    expect(state.provider.changes).toHaveLength(1);
    // When notifications are enabled, pending labels still precede older winner rows.
    state.store.rows.set("last-pending", { row: row("last-pending"), labels });
    expect((await state.store.recoverable(context, true))[0]?.row.gmailMessageId).toBe("last-pending");
  });
  test("stores the input cursor before work and retains it after a candidate failure", async () => {
    const state = setup(); state.provider.nextPageToken = "current-page";
    await state.service.scan("owner", { trial: false });
    const checkpointStart = state.store.runs.length;
    state.provider.add("m2"); state.provider.nextPageToken = "next-page";
    const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => { throw new Error("failed"); }, notifications: { configured: () => false, notify: async () => {} } });
    const response = await service.scan("owner", { trial: false, pageToken: "current-page" });
    expect(state.store.runs[checkpointStart]).toMatchObject({ status: "running", nextPageToken: "current-page" });
    expect(response.run).toMatchObject({ status: "partial_failure", nextPageToken: "current-page" });
  });
  test("rejects oversized provider pages without skipping unprocessed messages", async () => {
    const state = setup(); state.provider.nextPageToken = "current-page";
    await state.service.scan("owner", { trial: true });
    const callsBefore = state.calls();
    state.provider.listMessages = async () => ({ messages: Array.from({ length: 51 }, (_, i) => ({ id: `m${i}`, threadId: `t${i}` })), nextPageToken: "skip-overflow" });
    const response = await state.service.scan("owner", { trial: true, pageToken: "current-page" });
    expect(response.run).toMatchObject({ status: "failed", errorCode: "oversized_page", nextPageToken: "current-page", classified: 0 });
    expect(state.calls()).toBe(callsBefore); expect(state.provider.changes).toEqual([]);
  });
  test("reports Gmail reauthorization with a stable safe code", async () => {
    const state = setup();
    const service = new ContestScanService({ store: state.store, providerForOwner: async () => { throw new GmailReauthorizationRequiredError(); }, disabled: () => false, modelConfigured: () => true, notifications: { configured: () => false, notify: async () => {} } });
    expect((await service.scan("owner", { trial: true })).run).toMatchObject({ status: "failed", errorCode: "gmail_reauthorization_required" });
  });

  test("persists only an explicitly stated winner claim deadline, never the message body", async () => {
    for (const category of ["winner", "new_contest"] as const) {
      const state = setup(); const original = state.provider.getMessage.bind(state.provider);
      state.provider.getMessage = async (id) => {
        const message = await original(id);
        return { ...message, payload: { ...message.payload, body: { data: Buffer.from("PRIVATE_BODY_MARKER. You won our contest. Claim your prize by 2026-10-31.").toString("base64url") } } };
      };
      const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => classification(category), notifications: { configured: () => false, notify: async () => {} } });
      const response = await service.scan("owner", { trial: false });
      expect(response.results[0]?.claimDeadline).toBe(category === "winner" ? "2026-10-31" : null);
      expect(state.store.rows.get("m1")?.row.claimDeadline).toBe(category === "winner" ? "2026-10-31" : null);
      expect(JSON.stringify(state.store.rows.get("m1"))).not.toContain("PRIVATE_BODY_MARKER");
    }
  });

  test("persists the optional estimate for successful responses while failed request charges stay unknown", async () => {
    const previousInput = process.env.JEV_INPUT_USD_PER_MILLION_TOKENS;
    const previousOutput = process.env.JEV_OUTPUT_USD_PER_MILLION_TOKENS;
    process.env.JEV_INPUT_USD_PER_MILLION_TOKENS = "2.5";
    process.env.JEV_OUTPUT_USD_PER_MILLION_TOKENS = "10";
    try {
      const state = setup(); state.provider.add("m2"); let calls = 0;
      const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => {
        if (++calls === 2) throw new Error("Failed request charges unknown");
        return { ...classification(), usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } };
      }, notifications: { configured: () => false, notify: async () => {} } });
      const response = await service.scan("owner", { trial: false });
      expect(response.run).toMatchObject({ status: "partial_failure", inputTokens: 1_000_000, outputTokens: 1_000_000, estimatedCostUsd: 12.5 });
      expect(state.store.runs.at(-1)?.estimatedCostUsd).toBe(12.5);
    } finally {
      if (previousInput === undefined) delete process.env.JEV_INPUT_USD_PER_MILLION_TOKENS; else process.env.JEV_INPUT_USD_PER_MILLION_TOKENS = previousInput;
      if (previousOutput === undefined) delete process.env.JEV_OUTPUT_USD_PER_MILLION_TOKENS; else process.env.JEV_OUTPUT_USD_PER_MILLION_TOKENS = previousOutput;
    }
  });

  test("rejects invalid injected usage before saving scores or mutating Gmail", async () => {
    const state = setup();
    const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => ({ ...classification(), usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 } }), notifications: { configured: () => false, notify: async () => {} } });
    const response = await service.scan("owner", { trial: false });
    expect(response.run).toMatchObject({ status: "partial_failure", errorCode: "invalid_token_usage", classified: 0, inputTokens: 0, outputTokens: 0 });
    expect(state.store.rows.size).toBe(0); expect(state.provider.changes).toEqual([]);
  });

});


describe("contest nested label references", () => {
  const catalog = Object.entries(labels).map(([category, id]) => ({ id, name: `jev/${category}` }));
  test("resolves slash names and Gmail URL fragments to the same IDs", () => {
    const refs = Object.fromEntries(Object.keys(labels).map(category => [category, `jev/${category}`])) as ContestLabels;
    expect(resolveContestLabels(refs, catalog, "INBOX")).toEqual({ ...labels, entry_confirmation: labels.irrelevant, notification_update: labels.irrelevant });
    expect(resolveContestLabels({ ...refs, winner: "jev%2Fwinner" }, catalog, "INBOX")).toEqual({ ...labels, entry_confirmation: labels.irrelevant, notification_update: labels.irrelevant });
  });
  test("identifies missing categories and rejects malformed URL fragments", () => {
    expect(() => resolveContestLabels({ ...labels, winner: "jev%2Fmissing" }, catalog, "INBOX")).toThrow("label_not_found_winner");
    expect(() => resolveContestLabels({ ...labels, winner: "jev%ZZwinner" }, catalog, "INBOX")).toThrow("label_not_found_winner");
  });
});


describe("low-action contest filing", () => {
  test("entry confirmations and updates use Irrelevant even with older distinct saved destinations", async () => {
    for (const category of ["entry_confirmation", "notification_update"] as const) {
      const state = setup();
      state.provider.messages.get("m1")!.labelIds.push(labels[category]);
      state.store.rows.set("m1", { row: { ...row("m1"), category }, labels });
      const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => classification(category), notifications: { configured: () => false, notify: async () => {} } });
      await service.scan("owner", { trial: false });
      expect(state.provider.messages.get("m1")!.labelIds).toContain(labels.irrelevant);
      expect(state.provider.messages.get("m1")!.labelIds).not.toContain(labels[category]);
      expect(state.store.rows.get("m1")?.row.category).toBe(category);
    }
  });
});


test("live contest scan processes fifty messages and archives them while retaining unread", async () => {
  const state = setup();
  for (let i = 2; i <= 52; i++) state.provider.add(`m${i}`);
  state.provider.nextPageToken = "next-batch";
  const response = await state.service.scan("owner", { trial: false });
  expect(response.run).toMatchObject({ scanned: 50, classified: 50, status: "bounded_incomplete", nextPageToken: "next-batch" });
  expect(state.store.rows.size).toBe(50);
  expect(state.provider.labelLists).toBe(1);
  expect(state.calls()).toBe(50);
  for (const result of response.results) {
    expect(state.provider.messages.get(result.gmailMessageId)?.labelIds).not.toContain("INBOX");
    expect(state.provider.messages.get(result.gmailMessageId)?.labelIds).toContain("UNREAD");
  }
});


describe("contest archive and read policy", () => {
  test("missing filing labels are created once and used for every message in a live batch", async () => {
    const state = setup(); state.provider.add("m2");
    const catalog = state.provider.listLabels.bind(state.provider);
    state.provider.listLabels = async () => [...(await catalog()).filter(label => !["contest-archive", "not-contest"].includes(label.name)), ...state.provider.createdLabels];
    const response = await state.service.scan("owner", { trial: false });
    expect(response.run.status).toBe("completed");
    expect(state.provider.createdLabels.map(label => label.name)).toEqual(["contest-archive", "not-contest"]);
    expect(state.provider.labelLists).toBe(1);
    expect(state.provider.changes).toEqual([
      { messageId: "m1", addLabelIds: ["Label_created_0", "Label_winner"], removeLabelIds: ["INBOX"] },
      { messageId: "m2", addLabelIds: ["Label_created_0", "Label_winner"], removeLabelIds: ["INBOX"] },
    ]);
  });

  test("each scan and standalone correction fetches the current filing catalog", async () => {
    const state = setup();
    const catalog = state.provider.listLabels.bind(state.provider);
    let archiveId = "Label_archive_first";
    state.provider.listLabels = async () => (await catalog()).map(label => label.name === "contest-archive" ? { ...label, id: archiveId } : label);
    await state.service.scan("owner", { trial: false });
    expect(state.provider.labelLists).toBe(1);
    archiveId = "Label_archive_second";
    await state.service.scan("owner", { trial: false });
    expect(state.provider.labelLists).toBe(2);
    expect(state.provider.changes.at(-1)?.addLabelIds).toEqual([archiveId]);
    archiveId = "Label_archive_correction";
    await state.service.correct("owner", "m1", "irrelevant");
    expect(state.provider.labelLists).toBe(3);
    expect(state.provider.changes.at(-1)?.addLabelIds).toEqual([archiveId, labels.irrelevant]);
    archiveId = "Label_archive_next_correction";
    await state.service.correct("owner", "m1", "new_contest");
    expect(state.provider.labelLists).toBe(4);
    expect(state.provider.changes.at(-1)?.addLabelIds).toEqual([archiveId, labels.new_contest]);
  });

  test("a filing creation conflict refreshes the shared catalog for saved snapshots", async () => {
    const state = setup();
    const catalog = state.provider.listLabels.bind(state.provider);
    let raced = false;
    state.provider.listLabels = async () => [
      ...(await catalog()).filter(label => label.name !== "contest-archive"),
      ...(raced ? [{ id: "Label_raced_archive", name: "contest-archive" }, { id: "Label_other_winner", name: "race-winner" }] : []),
    ];
    state.provider.createLabel = async () => { raced = true; throw new Error("Label already exists"); };
    state.store.rows.set("m1", { row: row("m1"), labels: { ...labels, winner: "race-winner" } });
    const response = await state.service.scan("owner", { trial: false });
    expect(response.run.status).toBe("completed");
    expect(state.provider.labelLists).toBe(2);
    expect(state.calls()).toBe(0);
    expect(state.provider.changes).toEqual([
      { messageId: "m1", addLabelIds: ["Label_raced_archive", "Label_other_winner"], removeLabelIds: ["INBOX"] },
    ]);
    expect(state.store.rows.get("m1")?.row.labelStatus).toBe("applied");
  });

  test("trials do not create missing filing labels or file whitelisted and unmatched mail", async () => {
    const state = setup();
    state.provider.messages.clear(); state.provider.add("whitelist", "friend@example.com"); state.provider.add("blocked", "blocked@example.com");
    const catalog = state.provider.listLabels.bind(state.provider);
    state.provider.listLabels = async () => (await catalog()).filter(label => !["contest-archive", "not-contest"].includes(label.name));
    const response = await state.service.scan("owner", { trial: true });
    expect(response.run.status).toBe("completed");
    expect(response.run.skipped).toBe(2);
    expect(state.provider.createdLabels).toEqual([]);
    expect(state.provider.labelLists).toBe(1);
    expect(state.provider.changes).toEqual([]);
    expect(state.calls()).toBe(0);
  });
  test("a newly whitelisted saved winner moves to not-contest without another AI call", async () => {
    const state = setup(); state.provider.messages.get("m1")!.from = "friend@example.com";
    state.provider.messages.get("m1")!.labelIds.push("Label_winner");
    state.store.rows.set("m1", { row: { ...row("m1"), labelStatus: "applied" }, labels });
    await state.service.scan("owner", { trial: false });
    expect(state.provider.messages.get("m1")!.labelIds).toEqual(["Label_source", "Label_unrelated", "Label_contest_archive", "Label_not_contest"]);
    expect(state.calls()).toBe(0);
    expect(state.notifications()).toBe(0);
  });

  test("Winner and New Contest are archived but stay unread, including saved classifications", async () => {
    for (const category of ["winner", "new_contest"] as const) {
      const state = setup();
      state.store.rows.set("m1", { row: { ...row("m1"), category, labelStatus: "applied" }, labels });
      const response = await state.service.scan("owner", { trial: false });
      expect(response.run.classified).toBe(0);
      expect(state.calls()).toBe(0);
      expect(state.provider.messages.get("m1")!.labelIds).toEqual(["Label_source", "UNREAD", "Label_unrelated", "Label_contest_archive", labels[category]]);
      const mutations = state.provider.changes.length;
      await state.service.scan("owner", { trial: false });
      expect(state.provider.changes).toHaveLength(mutations);
    }
  });
  test("a Winner trial never archives mail", async () => {
    const state = setup();
    await state.service.scan("owner", { trial: true });
    expect(state.provider.changes).toEqual([]);
    expect(state.provider.messages.get("m1")!.labelIds).toContain("INBOX");
    expect(state.provider.messages.get("m1")!.labelIds).toContain("UNREAD");
  });
  test("archives and marks read all categories routed to Irrelevant", async () => {
    for (const category of ["irrelevant", "entry_confirmation", "notification_update"] as const) {
      const state = setup();
      const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => classification(category), notifications: { configured: () => false, notify: async () => {} } });
      await service.scan("owner", { trial: false });
      expect(state.provider.messages.get("m1")!.labelIds).toEqual(["Label_source", "Label_unrelated", "Label_contest_archive", "Label_irrelevant"]);
      const mutations = state.provider.changes.length;
      await service.scan("owner", { trial: false });
      expect(state.provider.changes).toHaveLength(mutations);
    }
  });
  test("an Irrelevant trial never changes Inbox or unread state", async () => {
    const state = setup();
    const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => classification("irrelevant"), notifications: { configured: () => false, notify: async () => {} } });
    await service.scan("owner", { trial: true });
    expect(state.provider.changes).toEqual([]);
    expect(state.provider.messages.get("m1")!.labelIds).toContain("INBOX");
    expect(state.provider.messages.get("m1")!.labelIds).toContain("UNREAD");
  });
  test("protected saved Irrelevant mail cannot be archived or marked read", async () => {
    const state = setup();
    state.provider.messages.get("m1")!.labelIds.push("STARRED");
    state.store.rows.set("m1", { row: { ...row("m1"), category: "irrelevant" }, labels });
    await state.service.scan("owner", { trial: false });
    expect(state.provider.changes).toEqual([]);
    expect(state.provider.messages.get("m1")!.labelIds).toContain("INBOX");
    expect(state.provider.messages.get("m1")!.labelIds).toContain("UNREAD");
  });
});

describe("live contest progress", () => {
  test("checkpoints each message with the safe input cursor while results become available", async () => {
    const state = setup(); state.provider.add("m2");
    state.provider.listMessages = async () => ({ messages: [{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t2" }], nextPageToken: "next-batch", resultSizeEstimate: 100 });
    let calls = 0;
    const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => {
      calls += 1;
      if (calls === 2) {
        const overview = await service.overview("owner");
        expect(overview.results.map((result) => result.gmailMessageId)).toEqual(["m1"]);
        expect(overview.latestRun).toMatchObject({ status: "running", scanned: 1, nextPageToken: null, progress: { batchTotal: 2, completedBefore: 0, completedBatchesBefore: 0, totalEstimate: 100, inputPageToken: null } });
        expect(Number.isFinite(Date.parse(overview.latestRun!.progress!.heartbeatAt))).toBe(true);
      }
      return classification();
    }, notifications: { configured: () => false, notify: async () => {} } });
    const response = await service.scan("owner", { trial: false });
    expect(response.run).toMatchObject({ status: "bounded_incomplete", scanned: 2, nextPageToken: "next-batch" });
    const running = state.store.runs.filter((run) => run.status === "running");
    expect(running.map((run) => run.scanned)).toEqual([0, 0, 1, 2]);
    expect(running.every((run) => run.nextPageToken === null)).toBe(true);
  });

  test("carries completed batches and the initial advisory estimate, resets a new scan", async () => {
    const state = setup();
    state.provider.listMessages = async (input) => input.pageToken
      ? { messages: [{ id: "m2", threadId: "t2" }], nextPageToken: undefined, resultSizeEstimate: 60 }
      : { messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "page-two", resultSizeEstimate: 100 };
    state.provider.add("m2");
    const first = await state.service.scan("owner", { trial: true });
    expect(first.run.progress).toMatchObject({ completedBefore: 0, completedBatchesBefore: 0, totalEstimate: 100 });
    const second = await state.service.scan("owner", { trial: true, pageToken: "page-two" });
    expect(second.run).toMatchObject({ scanned: 1, progress: { completedBefore: 1, completedBatchesBefore: 1, totalEstimate: 100 } });
    const fresh = await state.service.scan("owner", { trial: true });
    expect(fresh.run.progress).toMatchObject({ completedBefore: 0, completedBatchesBefore: 0 });
  });

  test("failed partial batches retry without adding attempts to the session baseline twice", async () => {
    const state = setup(); state.provider.add("m2");
    state.provider.listMessages = async (input) => ({ messages: [{ id: input.pageToken ? "m2" : "m1", threadId: "thread" }], nextPageToken: input.pageToken ? "page-three" : "page-two" });
    await state.service.scan("owner", { trial: true });
    let fail = true;
    const service = new ContestScanService({ store: state.store, providerForOwner: async () => state.provider, disabled: () => false, modelConfigured: () => true, classifier: async () => { if (fail) throw new Error("fixture failure"); return classification(); }, notifications: { configured: () => false, notify: async () => {} } });
    const failed = await service.scan("owner", { trial: true, pageToken: "page-two" });
    expect(failed.run).toMatchObject({ status: "partial_failure", nextPageToken: "page-two", progress: { completedBefore: 1, completedBatchesBefore: 1, totalEstimate: null } });
    fail = false;
    const retried = await service.scan("owner", { trial: true, pageToken: "page-two" });
    expect(retried.run).toMatchObject({ scanned: 1, progress: { completedBefore: 1, completedBatchesBefore: 1, totalEstimate: null } });
  });

  test("rejects stale tokens, changed trial mode and changed settings before listing", async () => {
    const state = setup(); state.provider.nextPageToken = "page-two";
    await state.service.scan("owner", { trial: true });
    await expect(state.service.scan("owner", { trial: true, pageToken: "wrong-page" })).rejects.toThrow("invalid_continuation");
    await expect(state.service.scan("owner", { trial: false, pageToken: "page-two" })).rejects.toThrow("invalid_continuation");
    state.store.selected = { labels: { ...labels, winner: "Label_other_winner" } };
    await expect(state.service.scan("owner", { trial: true, pageToken: "page-two" })).rejects.toThrow("invalid_continuation");
    expect(state.calls()).toBe(1);
  });

  test("projects an interrupted stale run without changing its persisted retry cursor", async () => {
    const state = setup(); state.provider.nextPageToken = "page-two";
    await state.service.scan("owner", { trial: true });
    const latest = state.store.runs.at(-1)!;
    const heartbeatAt = new Date(Date.now() - 301_000).toISOString();
    state.store.runs.push({ ...latest, status: "running", finishedAt: null, nextPageToken: "retry-page", progress: { ...latest.progress!, inputPageToken: "retry-page", heartbeatAt } });
    expect((await state.service.overview("owner")).latestRun).toMatchObject({ status: "failed", errorCode: "scan_interrupted", nextPageToken: "retry-page" });
    expect(state.store.runs.at(-1)?.status).toBe("running");
  });
  test("continues a matching legacy cursor without inventing historical progress", async () => {
    const state = setup(); state.provider.nextPageToken = "legacy-next";
    await state.service.scan("owner", { trial: true });
    const old = state.store.runs.at(-1)!;
    state.store.runs.push({ ...old, progress: null, scanned: 50 });
    state.provider.listMessages = async () => ({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "tracked-next", resultSizeEstimate: 75 });
    const response = await state.service.scan("owner", { trial: true, pageToken: "legacy-next" });
    expect(response.run.progress).toMatchObject({ completedBefore: 0, completedBatchesBefore: 0, totalEstimate: 75, trackingStartedMidScan: true });
    const next = await state.service.scan("owner", { trial: true, pageToken: "tracked-next" });
    expect(next.run.progress).toMatchObject({ completedBefore: 1, completedBatchesBefore: 1, totalEstimate: 75, trackingStartedMidScan: true });
  });

});
