import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { CONTEST_CATEGORIES, isHighConfidenceContestWinner, type ContestCategory, type ContestClassifier } from "./contest-classify";
import { CONTEST_DESTINATIONS, type ContestLabels, ContestOverview, ContestResultRow, ContestRunSummary, ContestScanResponse, ContestNotificationHooks, ContestScanProgress } from "./contest-contracts";
import type { GmailLabel, GmailProvider } from "./contracts";
import { parseMailboxAddress } from "./classify";
import { parseGmailMessage, isGmailStarred, type GmailMessage, type ParsedMessage } from "./message";
import { resolveLabelRef } from "./labels";
import { GmailReauthorizationRequiredError } from "./connection-health";
import { googleProviderForOwner } from "./factory";
import { createJevContestClassifier, JevClassificationError } from "./contest-jev";
import { usesFixtureGmailProvider } from "./app-profile";
import { gmailMessageUrl } from "./gmail-url";
import { DatabaseContestStore, ContestLeaseLostError, type ContestStore, type ContestContext, type ContestLease, type StoredContestMessage } from "./contest-store";
import { addContestTokenUsage, MAX_CONTEST_MODEL_CALLS } from "./contest-usage";
import { estimateContestApiCost } from "./contest-cost";
import { extractContestClaimDeadline } from "./contest-deadline";
import { createContestNotifier } from "./contest-notify";

export class ContestClientError extends Error {
  constructor(readonly code: string, readonly status: number = 400) { super(code); }
}
const labelsSchema = z.strictObject({ winner: z.string().trim().min(1).max(200), new_contest: z.string().trim().min(1).max(200), entry_confirmation: z.string().trim().min(1).max(200), notification_update: z.string().trim().min(1).max(200), irrelevant: z.string().trim().min(1).max(200) });
export const contestActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("configure"), labels: labelsSchema }),
  z.strictObject({ action: z.literal("scan"), trial: z.boolean(), pageToken: z.string().trim().min(1).max(2000).optional() }),
]);
export const contestCorrectionSchema = z.strictObject({ category: z.enum(CONTEST_CATEGORIES) });
const MAX_PAGE_MESSAGES = MAX_CONTEST_MODEL_CALLS;

export function resolveContestLabels(labels: ContestLabels, catalog: readonly { id: string; name: string }[], sourceLabelId: string): ContestLabels {
  const pairs = CONTEST_DESTINATIONS.map((category) => {
    let label;
    try { label = resolveLabelRef(labels[category], catalog); }
    catch {
      try { label = resolveLabelRef(decodeURIComponent(labels[category]), catalog); }
      catch { throw new ContestClientError(`label_not_found_${category}`); }
    }
    // Gmail's user-created IDs have this prefix; system labels never do.
    if (!label.id.startsWith("Label_") || label.id === sourceLabelId) throw new ContestClientError("invalid_labels");
    return [category, label.id] as const;
  });
  if (new Set(pairs.map(([, id]) => id)).size !== CONTEST_DESTINATIONS.length) throw new ContestClientError("invalid_labels");
  const destinations = Object.fromEntries(pairs) as Pick<ContestLabels, typeof CONTEST_DESTINATIONS[number]>;
  return { ...destinations, entry_confirmation: destinations.irrelevant, notification_update: destinations.irrelevant };
}
type ContestFilingLabels = Readonly<{ archive: string; notContest: string }>;
type ContestLabelBundle = Readonly<{ catalog: readonly GmailLabel[]; filing: ContestFilingLabels }>;
type ContestMailRoute = "candidate" | "whitelist" | "irrelevant" | "protected";
function contestMailRoute(message: ParsedMessage, context: ContestContext): ContestMailRoute {
  const sender = parseMailboxAddress(message.from);
  if (sender && context.senderWhitelist.some(address => parseMailboxAddress(address) === sender)) return "whitelist";
  if (!sender || isGmailStarred(message.labelIds)) return "protected";
  if (context.senderBlocklist.some(address => parseMailboxAddress(address) === sender)) return "irrelevant";
  return "candidate";
}
function codeFor(error: unknown): string {
  if (error instanceof GmailReauthorizationRequiredError) return "gmail_reauthorization_required";
  if (error instanceof ContestClientError) return error.code;
  if (error instanceof JevClassificationError) return `jev_${error.code}`;
  if (error instanceof ContestLeaseLostError) return "lease_lost";
  return "scan_failed";
}

export class ContestScanService {
  private readonly store: ContestStore;
  private readonly providerForOwner: (ownerId: string) => Promise<GmailProvider>;
  private readonly classifier: ContestClassifier;
  private readonly disabled: () => boolean;
  private readonly modelConfigured: () => boolean;
  private readonly notifications: ContestNotificationHooks;
  constructor(deps: Readonly<{
    store?: ContestStore;
    providerForOwner?: (ownerId: string) => Promise<GmailProvider>;
    classifier?: ContestClassifier;
    disabled?: () => boolean;
    modelConfigured?: () => boolean;
    notifications?: ContestNotificationHooks;
  }> = {}) {
    this.store = deps.store ?? new DatabaseContestStore();
    this.providerForOwner = deps.providerForOwner ?? googleProviderForOwner;
    this.classifier = deps.classifier ?? createJevContestClassifier();
    this.disabled = deps.disabled ?? usesFixtureGmailProvider;
    this.modelConfigured = deps.modelConfigured ?? (() => Boolean(process.env.JEV_API_KEY?.trim()));
    const notifier = deps.notifications ?? createContestNotifier({ store: this.store });
    this.notifications = { configured: () => notifier.configured(), notify: async (...args) => { await notifier.notify(...args); } };
  }
  private async context(ownerId: string) {
    const context = await this.store.context(ownerId);
    if (!context) throw new ContestClientError("gmail_or_configuration_missing");
    return context;
  }
  private checkEnabled() { if (this.disabled()) throw new ContestClientError("contest_disabled", 403); }
  async overview(ownerId: string): Promise<ContestOverview> {
    const base = { modelConfigured: this.modelConfigured(), notificationsConfigured: this.notifications.configured(), disabled: this.disabled() };
    if (base.disabled) return { ...base, settings: null, results: [], latestRun: null };
    const context = await this.store.context(ownerId);
    if (!context) return { ...base, settings: null, results: [], latestRun: null };
    const [settings, latestRun] = await Promise.all([this.store.settings(context), this.store.latestRun(context)]);
    const results = await this.store.results(context, latestRun?.trial ? [] : latestRun?.progress?.resultMessageIds ?? []);
    const heartbeat = Date.parse(latestRun?.progress?.heartbeatAt ?? latestRun?.startedAt ?? "");
    const visibleRun = latestRun?.status === "running" && Number.isFinite(heartbeat) && Date.now() - heartbeat > 300_000
      ? { ...latestRun, status: "failed" as const, errorCode: "scan_interrupted" } : latestRun;
    return { ...base, settings, results: results.map(({ row }) => row), latestRun: visibleRun };
  }
  async configure(ownerId: string, labels: ContestLabels) {
    this.checkEnabled();
    const parsed = labelsSchema.safeParse(labels);
    if (!parsed.success) throw new ContestClientError("invalid_labels");
    const context = await this.context(ownerId);
    const provider = await this.providerForOwner(ownerId);
    const catalog = await provider.listLabels();
    let resolved: ContestLabels;
    let sourceId: string;
    try { sourceId = resolveLabelRef(context.sourceLabelId, catalog).id; }
    catch { throw new ContestClientError("source_label_missing"); }
    resolved = resolveContestLabels(parsed.data, catalog, sourceId);
    const lease = await this.store.acquire(context, randomUUID());
    if (!lease) throw new ContestClientError("already_running", 409);
    try {
      await this.store.assertLease(lease);
      await this.store.configure(context, resolved, lease);
      await this.store.assertLease(lease);
      return { settings: { labels: resolved } };
    } finally { await this.store.release(lease); }
  }
  private async prepareFilingLabels(context: ContestContext, lease: ContestLease, provider: GmailProvider, initialCatalog: readonly GmailLabel[]): Promise<ContestLabelBundle> {
    let catalog = initialCatalog;
    const ids: string[] = [];
    for (const name of ["contest-archive", "not-contest"]) {
      let label = catalog.find(label => label.name === name);
      if (!label) {
        if (!provider.createLabel) throw new ContestClientError("filing_label_missing");
        await this.store.assertLease(lease);
        try {
          label = await provider.createLabel(name);
          catalog = [...catalog, label];
        }
        catch (error) {
          catalog = await provider.listLabels();
          label = catalog.find(label => label.name === name);
          if (!label) throw error;
        }
      }
      if (!label.id.startsWith("Label_") || label.id === resolveLabelRef(context.sourceLabelId, catalog).id) throw new ContestClientError("invalid_filing_labels");
      ids.push(label.id);
    }
    if (ids[0] === ids[1]) throw new ContestClientError("invalid_filing_labels");
    return { catalog, filing: { archive: ids[0]!, notContest: ids[1]! } };
  }
  private async file(context: ContestContext, lease: ContestLease, provider: GmailProvider, message: ParsedMessage, knownLabelIds: readonly string[], filing: ContestFilingLabels, target: string, markRead: boolean): Promise<void> {
    const addLabelIds = [...new Set([filing.archive, target])].filter(id => !message.labelIds.includes(id));
    const competing = [...knownLabelIds, filing.notContest];
    const removeLabelIds = [...new Set(competing)].filter(id => id.startsWith("Label_") && id !== target && id !== filing.archive && id !== context.sourceLabelId && message.labelIds.includes(id));
    for (const id of markRead ? ["INBOX", "UNREAD"] : ["INBOX"]) {
      if (message.labelIds.includes(id)) removeLabelIds.push(id);
    }
    await this.store.assertLease(lease);
    if (addLabelIds.length || removeLabelIds.length) await provider.modifyLabels({ messageId: message.id, addLabelIds, removeLabelIds });
  }
  private async apply(context: ContestContext, lease: ContestLease, provider: GmailProvider, stored: StoredContestMessage, bundle?: ContestLabelBundle): Promise<ContestResultRow> {
    const message = parseGmailMessage(await provider.getMessage(stored.row.gmailMessageId) as GmailMessage);
    const route = contestMailRoute(message, context);
    if (route === "protected") {
      await this.store.labelStatus(context, lease, message.id, "protected");
      return { ...stored.row, labelStatus: "protected" };
    }
    const category = stored.row.manualCategory ?? stored.row.category;
    const { catalog, filing: destinations } = bundle ?? await this.prepareFilingLabels(context, lease, provider, await provider.listLabels());
    const labels = resolveContestLabels(stored.labels, catalog, resolveLabelRef(context.sourceLabelId, catalog).id);
    if (route === "whitelist" || route === "irrelevant") {
      await this.file(context, lease, provider, message, [...Object.values(stored.labels), ...Object.values(labels)], destinations, route === "whitelist" ? destinations.notContest : labels.irrelevant, true);
      await this.store.labelStatus(context, lease, message.id, "protected");
      return { ...stored.row, labelStatus: "protected" };
    }
    const target = labels[category];
    await this.file(context, lease, provider, message, [...Object.values(stored.labels), ...Object.values(labels)], destinations, target, target === labels.irrelevant);
    await this.store.labelStatus(context, lease, message.id, "applied");
    const applied = { ...stored.row, labelStatus: "applied" as const };
    if (isHighConfidenceContestWinner({ category, explicitWinProbability: applied.explicitWinProbability })) {
      await this.store.assertLease(lease);
      try { await this.notifications.notify(context.ownerId, context.googleSubject, applied); }
      catch { /* Notification persistence owns failures; Gmail filing remains successful. */ }
    }
    return (await this.store.message(context, message.id))?.row ?? applied;
  }
  async correct(ownerId: string, messageId: string, category: ContestCategory) {
    this.checkEnabled();
    if (!contestCorrectionSchema.safeParse({ category }).success || !messageId.trim()) throw new ContestClientError("invalid_correction");
    const context = await this.context(ownerId);
    const stored = await this.store.message(context, messageId);
    if (!stored) throw new ContestClientError("message_not_found", 404);
    const lease = await this.store.acquire(context, randomUUID());
    if (!lease) throw new ContestClientError("already_running", 409);
    try {
      await this.store.correct(context, lease, messageId, category);
      const provider = await this.providerForOwner(ownerId);
      const result = await this.apply(context, lease, provider, { ...stored, row: { ...stored.row, manualCategory: category, labelStatus: "pending" } });
      return { result };
    } finally { await this.store.release(lease); }
  }
  async scan(ownerId: string, options: Readonly<{ trial: boolean; pageToken?: string }>): Promise<ContestScanResponse> {
    this.checkEnabled();
    if (!this.modelConfigured()) throw new ContestClientError("model_not_configured");
    const context = await this.context(ownerId);
    const settings = await this.store.settings(context);
    if (!settings) throw new ContestClientError("contest_not_configured");
    const lease = await this.store.acquire(context, randomUUID());
    if (!lease) throw new ContestClientError("already_running", 409);
    const configurationKey = createHash("sha256").update(JSON.stringify({ source: context.sourceLabelId, classificationPolicy: "all-eligible-ai-v1", whitelist: context.senderWhitelist, blocklist: context.senderBlocklist, labels: settings.labels })).digest("hex");
    let previous: ContestRunSummary | null;
    try {
      await this.store.assertLease(lease);
      previous = await this.store.latestRun(context);
      if (options.pageToken && (!previous || previous.nextPageToken !== options.pageToken || previous.trial !== options.trial
        || (previous.progress && (previous.progress.sourceLabelId !== context.sourceLabelId || previous.progress.configurationKey !== configurationKey
          || !Number.isSafeInteger(previous.progress.completedBefore) || previous.progress.completedBefore < 0
          || !Number.isSafeInteger(previous.progress.completedBatchesBefore) || previous.progress.completedBatchesBefore < 0)))) {
        throw new ContestClientError("invalid_continuation");
      }
    } catch (error) { await this.store.release(lease); throw error; }
    const carried = options.pageToken ? previous!.progress ?? null : null;
    const successfulPrevious = Boolean(carried && previous?.status === "bounded_incomplete");
    const progress: ContestScanProgress = {
      resultMessageIds: [],
      batchTotal: null,
      completedBefore: (carried?.completedBefore ?? 0) + (successfulPrevious ? previous!.scanned : 0),
      completedBatchesBefore: (carried?.completedBatchesBefore ?? 0) + (successfulPrevious ? 1 : 0),
      totalEstimate: carried?.totalEstimate ?? null,
      sourceLabelId: context.sourceLabelId, configurationKey, inputPageToken: options.pageToken ?? null,
      heartbeatAt: new Date().toISOString(),
      trackingStartedMidScan: carried?.trackingStartedMidScan ?? Boolean(options.pageToken && !carried),
    };
    const run: { -readonly [K in keyof ContestRunSummary]: ContestRunSummary[K] } & { progress: ContestScanProgress } = { id: lease.leaseOwner, status: "running", trial: options.trial, scanned: 0, candidates: 0, classified: 0, skipped: 0, failed: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: null, progress, nextPageToken: options.pageToken ?? null, startedAt: new Date().toISOString(), finishedAt: null, errorCode: null };
    const results = new Map<string, ContestResultRow>();
    const checkpoint = async () => {
      run.progress = { ...run.progress, resultMessageIds: [...results.keys()], heartbeatAt: new Date().toISOString() };
      run.estimatedCostUsd = estimateContestApiCost(run.inputTokens, run.outputTokens);
      await this.store.assertLease(lease);
      await this.store.saveRun(context, run);
    };
    try {
      await this.store.assertLease(lease);
      await this.store.saveRun(context, run);
      const provider = await this.providerForOwner(ownerId);
      const catalog = await provider.listLabels();
      const sourceLabelId = resolveLabelRef(context.sourceLabelId, catalog).id;
      const labels = resolveContestLabels(settings.labels, catalog, sourceLabelId);
      const bundle = options.trial ? null : await this.prepareFilingLabels(context, lease, provider, catalog);
      if (!options.trial) {
        const saved = await this.store.recoverable(context, this.notifications.configured());
        for (const stored of saved) {
          try {
            if (!await this.store.renew(lease)) throw new ContestLeaseLostError();
            await this.apply(context, lease, provider, stored, bundle ?? undefined);
          }
          catch (error) { if (error instanceof ContestLeaseLostError) throw error; run.failed += 1; run.errorCode = codeFor(error); }
          await checkpoint();
        }
      }
      if (!await this.store.renew(lease)) throw new ContestLeaseLostError();
      const page = await provider.listMessages({ sourceLabelId, pageToken: options.pageToken, maxResults: MAX_PAGE_MESSAGES });
      if (page.messages.length > MAX_PAGE_MESSAGES) throw new ContestClientError("oversized_page");
      const nextPageToken = page.nextPageToken ?? null;
      const initialEstimate = !carried && typeof page.resultSizeEstimate === "number" && Number.isSafeInteger(page.resultSizeEstimate) && page.resultSizeEstimate >= 0
        ? page.resultSizeEstimate : run.progress.totalEstimate;
      run.progress = { ...run.progress, batchTotal: page.messages.length, totalEstimate: initialEstimate };
      await checkpoint();
      for (const ref of page.messages) {
        try {
          if (!await this.store.renew(lease)) throw new ContestLeaseLostError();
          const saved = await this.store.message(context, ref.id);
          if (saved) {
            run.skipped += 1;
            results.set(ref.id, options.trial ? saved.row : await this.apply(context, lease, provider, saved, bundle ?? undefined));
            continue;
          }
          const parsed = parseGmailMessage(await provider.getMessage(ref.id) as GmailMessage);
          const route = contestMailRoute(parsed, context);
          if (route !== "candidate") {
            run.skipped += 1;
            if (bundle && route !== "protected") {
              const current = parseGmailMessage(await provider.getMessage(ref.id) as GmailMessage);
              const currentRoute = contestMailRoute(current, context);
              if (currentRoute === "whitelist" || currentRoute === "irrelevant") {
                await this.file(context, lease, provider, current, Object.values(labels), bundle.filing, currentRoute === "whitelist" ? bundle.filing.notContest : labels.irrelevant, true);
              }
            }
            continue;
          }
          run.candidates += 1;
          const result = await this.classifier(parsed);
          await this.store.assertLease(lease);
          const usage = addContestTokenUsage(run, result.usage);
          if (!usage) throw new ContestClientError("invalid_token_usage");
          run.classified += 1;
          run.inputTokens = usage.inputTokens; run.outputTokens = usage.outputTokens;
          const row: ContestResultRow = { gmailMessageId: parsed.id, gmailThreadId: parsed.threadId, sender: parseMailboxAddress(parsed.from) ?? "", subject: parsed.subject, category: result.category, manualCategory: null, explicitWinProbability: result.explicitWinProbability, claimActionProbability: result.claimActionProbability, confidence: result.confidence, claimDeadline: result.category === "winner" ? extractContestClaimDeadline(parsed.bodyText) : null, model: result.model, promptVersion: result.promptVersion, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, labelStatus: "pending", notificationStatus: null, gmailUrl: gmailMessageUrl({ gmailMessageId: parsed.id, gmailThreadId: parsed.threadId }, context.linkRoot) };
          if (options.trial) results.set(parsed.id, row);
          else {
            const stored = await this.store.save(context, lease, row, labels);
            results.set(parsed.id, stored.row);
            results.set(parsed.id, await this.apply(context, lease, provider, stored, bundle ?? undefined));
          }
        } catch (error) {
          if (error instanceof ContestLeaseLostError) throw error;
          run.failed += 1; run.errorCode = codeFor(error);
        } finally {
          run.scanned += 1;
          await checkpoint();
        }
      }
      run.nextPageToken = run.failed ? options.pageToken ?? null : nextPageToken;
      run.status = run.failed ? "partial_failure" : run.nextPageToken ? "bounded_incomplete" : "completed";
    } catch (error) { run.status = "failed"; run.errorCode = codeFor(error); run.nextPageToken = options.pageToken ?? null; }
    finally {
      run.finishedAt = new Date().toISOString();
      run.progress = { ...run.progress, heartbeatAt: run.finishedAt };
      run.estimatedCostUsd = estimateContestApiCost(run.inputTokens, run.outputTokens);
      try { await this.store.saveRun(context, run); }
      finally { await this.store.release(lease); }
    }
    return { run, results: [...results.values()].sort((left, right) => right.explicitWinProbability - left.explicitWinProbability) };
  }
}
