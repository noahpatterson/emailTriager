import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { messageProcessing, syncLease, syncRun, triageConfig } from "@/db/schema";
import type { Database } from "@/src/server/db";
import type { GmailProvider } from "./contracts";
import { classifyWithReason, type ClassificationOutcome, type ClassificationTerms } from "./classify";
import { resolveLabelRefs } from "./labels";
import { isGmailStarred, parseGmailMessage, type GmailMessage, type ParsedMessage } from "./message";

export type SyncBounds = Readonly<{ maxPages: number; maxMessagesPerPage: number; maxTotalMessages: number }>;
export type SyncResult = Readonly<{ exhausted: boolean; messageIds: readonly string[]; nextPageToken?: string }>;
export type SyncStartOptions = Readonly<{ trial?: boolean; pageToken?: string | null }>;

export type TrialResultRow = Readonly<{
  gmailMessageId: string;
  gmailThreadId: string | null;
  subject: string | null;
  senderAddress: string | null;
  outcome: ClassificationOutcome | "failed";
  reason: string | null;
  proposedLabelId: string | null;
}>;

export type SyncStartResult = Readonly<{
  runId: string;
  status: "completed" | "bounded_incomplete";
  trial: boolean;
  exhausted: boolean;
  nextPageToken: string | null;
  results: readonly TrialResultRow[];
}>;

type LabelConfiguration = Readonly<{
  sourceLabelId: string;
  priorityLabelId: string;
  reviewLabelId: string;
  contestLabelId: string;
  contestArchiveLabelId: string;
}>;

const FORBIDDEN_LABELS = new Set(["TRASH", "SPAM", "UNREAD"]);
const SYNC_LEASE_SECONDS = 300;
const TRIAL_BOUNDS: SyncBounds = { maxPages: 1, maxMessagesPerPage: 10, maxTotalMessages: 10 };

export function destinationFor(outcome: ClassificationOutcome, labels: LabelConfiguration): string | null {
  if (outcome === "priority") return labels.priorityLabelId;
  if (outcome === "review") return labels.reviewLabelId;
  if (outcome === "new_contest") return labels.contestLabelId;
  if (outcome === "blocked" || outcome === "unmatched") return labels.contestArchiveLabelId;
  return null;
}

function validateLabels(labels: LabelConfiguration): void {
  const values = [
    labels.sourceLabelId,
    labels.priorityLabelId,
    labels.reviewLabelId,
    labels.contestLabelId,
    labels.contestArchiveLabelId,
  ];
  if (values.some((label) => !label || FORBIDDEN_LABELS.has(label.toUpperCase())) || new Set(values).size !== values.length) {
    throw new Error("Invalid label configuration");
  }
}

export async function reconcileLabelMovement(
  provider: GmailProvider,
  message: ParsedMessage,
  outcome: ClassificationOutcome,
  labels: LabelConfiguration,
): Promise<void> {
  // Defense in depth: never mutate starred messages even if outcome were wrong.
  if (isGmailStarred(message.labelIds)) return;
  const destination = destinationFor(outcome, labels);
  if (!destination) return;
  let current = message;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentLabels = new Set(current.labelIds);
    if (currentLabels.has(destination) && !currentLabels.has(labels.sourceLabelId)) return;
    try {
      await provider.modifyLabels({
        messageId: message.id,
        addLabelIds: currentLabels.has(destination) ? [] : [destination],
        removeLabelIds: currentLabels.has(labels.sourceLabelId) ? [labels.sourceLabelId] : [],
      });
      return;
    } catch (error) {
      current = parseGmailMessage(await provider.getMessage(message.id) as GmailMessage);
      const refreshedLabels = new Set(current.labelIds);
      if (refreshedLabels.has(destination) && !refreshedLabels.has(labels.sourceLabelId)) return;
      if (attempt === 1) throw error;
    }
  }
}

export async function listBounded(provider: GmailProvider, sourceLabelId: string, bounds: SyncBounds, initialPageToken?: string): Promise<SyncResult> {
  if (bounds.maxPages < 1 || bounds.maxMessagesPerPage < 1 || bounds.maxMessagesPerPage > 500 || bounds.maxTotalMessages < 1) throw new Error("Invalid sync bounds");
  const seen = new Set<string>();
  const messageIds: string[] = [];
  let pageToken = initialPageToken;
  for (let page = 0; page < bounds.maxPages; page += 1) {
    const remaining = bounds.maxTotalMessages - messageIds.length;
    if (remaining <= 0) return { exhausted: false, messageIds, nextPageToken: pageToken };
    if (pageToken && seen.has(pageToken)) throw new Error("Pagination cycle detected");
    if (pageToken) seen.add(pageToken);
    const maxResults = Math.min(bounds.maxMessagesPerPage, remaining);
    const result = await provider.listMessages({ sourceLabelId, pageToken, maxResults });
    for (const message of result.messages) {
      if (messageIds.length === bounds.maxTotalMessages) return { exhausted: false, messageIds, nextPageToken: pageToken };
      messageIds.push(message.id);
    }
    if (!result.nextPageToken) return { exhausted: true, messageIds };
    if (result.nextPageToken === pageToken || seen.has(result.nextPageToken)) throw new Error("Pagination cycle detected");
    pageToken = result.nextPageToken;
    if (messageIds.length >= bounds.maxTotalMessages) return { exhausted: false, messageIds, nextPageToken: pageToken };
  }
  return { exhausted: false, messageIds, nextPageToken: pageToken };
}

export class MessageSyncService {
  constructor(
    private readonly providerForOwner: (ownerId: string) => Promise<GmailProvider>,
    private readonly db: Database,
  ) {}

  async start(ownerId: string, options: SyncStartOptions = {}): Promise<SyncStartResult> {
    const trial = options.trial === true;
    const [config] = await this.db
      .select({
        version: triageConfig.version,
        sourceLabelId: triageConfig.sourceLabelId,
        priorityLabelId: triageConfig.priorityLabelId,
        reviewLabelId: triageConfig.reviewLabelId,
        contestLabelId: triageConfig.contestLabelId,
        contestArchiveLabelId: triageConfig.contestArchiveLabelId,
        terms: triageConfig.terms,
        senderWhitelist: triageConfig.senderWhitelist,
        senderBlocklist: triageConfig.senderBlocklist,
        bounds: triageConfig.bounds,
      })
      .from(triageConfig)
      .where(eq(triageConfig.ownerAuthUserId, ownerId))
      .orderBy(desc(triageConfig.version))
      .limit(1);
    if (!config) throw new Error("Sync configuration missing");
    const bounds = trial ? TRIAL_BOUNDS : config.bounds as SyncBounds;
    const terms = config.terms as ClassificationTerms;
    const senderWhitelist = config.senderWhitelist as readonly string[];
    const senderBlocklist = config.senderBlocklist as readonly string[];
    const runId = randomUUID();
    const [lease] = await this.db
      .insert(syncLease)
      .values({
        ownerAuthUserId: ownerId,
        leaseOwner: runId,
        leaseExpiresAt: sql`now() + (${SYNC_LEASE_SECONDS} * interval '1 second')`,
      })
      .onConflictDoUpdate({
        target: syncLease.ownerAuthUserId,
        set: {
          leaseOwner: runId,
          leaseExpiresAt: sql`now() + (${SYNC_LEASE_SECONDS} * interval '1 second')`,
          fenceToken: sql`${syncLease.fenceToken} + 1`,
        },
        setWhere: sql`${syncLease.leaseExpiresAt} <= now()`,
      })
      .returning({ fenceToken: syncLease.fenceToken });
    if (!lease) throw new Error("Synchronization already running");
    await this.db.insert(syncRun).values({
      id: runId,
      ownerAuthUserId: ownerId,
      configVersion: config.version,
      status: "running",
      trial,
      leaseOwner: runId,
      leaseExpiresAt: sql`now() + (${SYNC_LEASE_SECONDS} * interval '1 second')`,
      fenceToken: lease.fenceToken,
    });
    const results: TrialResultRow[] = [];
    try {
      const provider = await this.providerForOwner(ownerId);
      const labels = resolveLabelRefs({
        sourceLabelId: config.sourceLabelId,
        priorityLabelId: config.priorityLabelId,
        reviewLabelId: config.reviewLabelId,
        contestLabelId: config.contestLabelId,
        contestArchiveLabelId: config.contestArchiveLabelId,
      }, await provider.listLabels());
      validateLabels(labels);
      const initialPageToken = trial && options.pageToken ? options.pageToken : undefined;
      const result = await listBounded(provider, labels.sourceLabelId, bounds, initialPageToken);
      for (const messageId of result.messageIds) {
        const [renewed] = await this.db
          .update(syncLease)
          .set({ leaseExpiresAt: sql`now() + (${SYNC_LEASE_SECONDS} * interval '1 second')` })
          .where(and(
            eq(syncLease.ownerAuthUserId, ownerId),
            eq(syncLease.leaseOwner, runId),
            eq(syncLease.fenceToken, lease.fenceToken),
          ))
          .returning({ fenceToken: syncLease.fenceToken });
        if (!renewed) throw new Error("Synchronization lease lost");
        let parsed: ParsedMessage | null = null;
        try {
          parsed = parseGmailMessage(await provider.getMessage(messageId) as GmailMessage);
          const { outcome, reason } = classifyWithReason(parsed, terms, senderWhitelist, senderBlocklist);
          const proposedLabelId = destinationFor(outcome, labels);
          // neon-http has no transaction support — keep this a single statement.
          await this.db
            .insert(messageProcessing)
            .values({
              runId,
              gmailMessageId: parsed.id,
              gmailThreadId: parsed.threadId,
              internalDate: parsed.internalDate,
              senderAddress: parsed.from,
              subject: parsed.subject,
              labelIds: parsed.labelIds,
              outcome,
              outcomeReason: reason,
            })
            .onConflictDoNothing();
          if (!trial) {
            await reconcileLabelMovement(provider, parsed, outcome, labels);
          }
          await this.db
            .update(messageProcessing)
            .set({ processedAt: sql`now()` })
            .where(and(eq(messageProcessing.runId, runId), eq(messageProcessing.gmailMessageId, parsed.id)));
          results.push({
            gmailMessageId: parsed.id,
            gmailThreadId: parsed.threadId,
            subject: parsed.subject,
            senderAddress: parsed.from,
            outcome,
            reason,
            proposedLabelId,
          });
        } catch (error) {
          console.error("Message processing failed", messageId, error instanceof Error ? error.message : error);
          const failReason = parsed ? "Message processing failed" : "Message could not be parsed";
          await this.db
            .insert(messageProcessing)
            .values({
              runId,
              gmailMessageId: messageId,
              gmailThreadId: parsed?.threadId,
              internalDate: parsed?.internalDate,
              senderAddress: parsed?.from,
              subject: parsed?.subject,
              labelIds: parsed?.labelIds,
              outcome: "failed",
              outcomeReason: failReason,
              errorCode: parsed ? "MESSAGE_PROCESSING_FAILED" : "MESSAGE_PARSE_FAILED",
              processedAt: sql`now()`,
            })
            .onConflictDoNothing();
          results.push({
            gmailMessageId: messageId,
            gmailThreadId: parsed?.threadId ?? null,
            subject: parsed?.subject ?? null,
            senderAddress: parsed?.from ?? null,
            outcome: "failed",
            reason: failReason,
            proposedLabelId: null,
          });
        }
      }
      const status = result.exhausted ? "completed" : "bounded_incomplete";
      const nextPageToken = result.nextPageToken ?? null;
      await this.db
        .update(syncRun)
        .set({
          status,
          nextPageToken,
          finishedAt: sql`now()`,
        })
        .where(eq(syncRun.id, runId));
      return { runId, status, trial, exhausted: result.exhausted, nextPageToken, results };
    } catch (error) {
      console.error("Synchronization failed", runId, error instanceof Error ? error.message : error, error);
      await this.db
        .update(syncRun)
        .set({
          status: "failed",
          errorSummary: "Synchronization failed",
          finishedAt: sql`now()`,
        })
        .where(eq(syncRun.id, runId));
      throw new Error("Synchronization failed");
    } finally {
      await this.db
        .delete(syncLease)
        .where(and(
          eq(syncLease.ownerAuthUserId, ownerId),
          eq(syncLease.leaseOwner, runId),
          eq(syncLease.fenceToken, lease.fenceToken),
        ));
    }
  }
}
