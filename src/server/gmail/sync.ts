import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  gmailConnection,
  gmailMessageState,
  messageProcessing,
  syncLease,
  syncRun,
  triageConfig,
} from "@/db/schema";
import type { Database } from "@/src/server/db";
import type { GmailProvider } from "./contracts";
import {
  classifyWithReason,
  parseMailboxAddress,
  type ClassificationOutcome,
  type ClassificationTerms,
} from "./classify";
import { displayLabelName, resolveLabelRefs } from "./labels";
import { isGmailStarred, parseGmailMessage, type GmailMessage, type ParsedMessage } from "./message";
import {
  persistMessageSnapshotIfEligible,
  type MessageSnapshotStore,
} from "./message-snapshot";
import { DatabaseMessageSnapshotStore } from "./message-snapshot-store";
import { getServerConfig } from "@/src/config/server";

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
  status: "completed" | "bounded_incomplete" | "partial_failure";
  trial: boolean;
  exhausted: boolean;
  nextPageToken: string | null;
  results: readonly TrialResultRow[];
}>;

type LabelConfiguration = Readonly<{
  sourceLabelId: string;
  priorityLabelId: string;
  reviewLabelId: string;
  newLabelId: string;
  archiveLabelId: string;
}>;

const FORBIDDEN_LABELS = new Set(["TRASH", "SPAM", "UNREAD"]);
const CLASSIFICATION_OUTCOMES = new Set<ClassificationOutcome>([
  "priority",
  "review",
  "new",
  "unmatched",
  "protected",
  "blocked",
]);
const SYNC_LEASE_SECONDS = 300;
const TRIAL_BOUNDS: SyncBounds = { maxPages: 1, maxMessagesPerPage: 10, maxTotalMessages: 10 };

export function syncStatusFor(
  exhausted: boolean,
  failureCount: number,
): SyncStartResult["status"] {
  if (failureCount > 0) return "partial_failure";
  return exhausted ? "completed" : "bounded_incomplete";
}

export function messageStateAction(
  processingStatus: string | null | undefined,
): "process" | "recover" | "skip" {
  if (processingStatus === "pending") return "recover";
  if (processingStatus === "processed" || processingStatus === "failed") {
    return "skip";
  }
  return "process";
}

export function remainingMessageBudget(
  maximum: number,
  alreadyProcessed: number,
): number {
  return Math.max(0, maximum - alreadyProcessed);
}

export function destinationFor(outcome: ClassificationOutcome, labels: LabelConfiguration): string | null {
  if (outcome === "priority") return labels.priorityLabelId;
  if (outcome === "review") return labels.reviewLabelId;
  if (outcome === "new") return labels.newLabelId;
  if (outcome === "blocked" || outcome === "unmatched") return labels.archiveLabelId;
  return null;
}

function validateLabels(labels: LabelConfiguration): void {
  const values = [
    labels.sourceLabelId,
    labels.priorityLabelId,
    labels.reviewLabelId,
    labels.newLabelId,
    labels.archiveLabelId,
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
  assertMutationAllowed: () => Promise<void> = async () => {},
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
      await assertMutationAllowed();
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
  private readonly snapshots: MessageSnapshotStore;
  private readonly encryptionKey: string;

  constructor(
    private readonly providerForOwner: (ownerId: string) => Promise<GmailProvider>,
    private readonly db: Database,
    snapshots?: MessageSnapshotStore,
    encryptionKey?: string,
  ) {
    this.snapshots = snapshots ?? new DatabaseMessageSnapshotStore(db);
    this.encryptionKey = encryptionKey ?? getServerConfig().tokenEncryptionKeyV1;
  }

  async start(ownerId: string, options: SyncStartOptions = {}): Promise<SyncStartResult> {
    const trial = options.trial === true;
    const [config] = await this.db
      .select({
        version: triageConfig.version,
        sourceLabelId: triageConfig.sourceLabelId,
        priorityLabelId: triageConfig.priorityLabelId,
        reviewLabelId: triageConfig.reviewLabelId,
        newLabelId: triageConfig.newLabelId,
        archiveLabelId: triageConfig.archiveLabelId,
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
    const [connection] = await this.db
      .select({ googleSubject: gmailConnection.googleSubject })
      .from(gmailConnection)
      .where(and(
        eq(gmailConnection.ownerAuthUserId, ownerId),
        isNull(gmailConnection.disconnectedAt),
      ))
      .limit(1);
    if (!connection) throw new Error("Gmail is not connected");
    let bounds = trial ? TRIAL_BOUNDS : config.bounds as SyncBounds;
    const terms = config.terms as ClassificationTerms;
    const senderWhitelist = config.senderWhitelist as readonly string[];
    const senderBlocklist = config.senderBlocklist as readonly string[];
    const requestedPageToken = options.pageToken?.trim() || null;
    let initialPageToken = requestedPageToken;
    if (requestedPageToken) {
      const [checkpoint] = await this.db
        .select({ id: syncRun.id })
        .from(syncRun)
        .where(and(
          eq(syncRun.ownerAuthUserId, ownerId),
          eq(syncRun.trial, trial),
          eq(syncRun.nextPageToken, requestedPageToken),
          sql`${syncRun.status} IN ('bounded_incomplete', 'partial_failure')`,
        ))
        .orderBy(desc(syncRun.startedAt))
        .limit(1);
      if (!checkpoint) throw new Error("Invalid synchronization checkpoint");
    } else if (!trial) {
      const [checkpoint] = await this.db
        .select({
          nextPageToken: syncRun.nextPageToken,
          status: syncRun.status,
        })
        .from(syncRun)
        .where(and(
          eq(syncRun.ownerAuthUserId, ownerId),
          eq(syncRun.trial, false),
        ))
        .orderBy(desc(syncRun.startedAt))
        .limit(1);
      initialPageToken =
        checkpoint
        && (checkpoint.status === "bounded_incomplete"
          || checkpoint.status === "partial_failure")
          ? checkpoint.nextPageToken
          : null;
    }
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
    let failureCount = 0;
    try {
      const provider = await this.providerForOwner(ownerId);
      const catalog = await provider.listLabels();
      const labels = resolveLabelRefs({
        sourceLabelId: config.sourceLabelId,
        priorityLabelId: config.priorityLabelId,
        reviewLabelId: config.reviewLabelId,
        newLabelId: config.newLabelId,
        archiveLabelId: config.archiveLabelId,
      }, catalog);
      validateLabels(labels);
      const assertMutationAllowed = async (): Promise<void> => {
        const [allowed] = await this.db
          .select({ fenceToken: syncLease.fenceToken })
          .from(syncLease)
          .where(and(
            eq(syncLease.ownerAuthUserId, ownerId),
            eq(syncLease.leaseOwner, runId),
            eq(syncLease.fenceToken, lease.fenceToken),
            sql`${syncLease.leaseExpiresAt} > now()`,
            sql`EXISTS (
              SELECT 1 FROM gmail_connection
              WHERE owner_auth_user_id = ${ownerId}
                AND disconnected_at IS NULL
            )`,
          ))
          .limit(1);
        if (!allowed) throw new Error("Synchronization lease lost");
      };

      if (!trial) {
        const recoverable = await this.db
          .select({
            gmailMessageId: gmailMessageState.gmailMessageId,
            configVersion: gmailMessageState.configVersion,
            outcome: gmailMessageState.outcome,
            processingStatus: gmailMessageState.processingStatus,
          })
          .from(gmailMessageState)
          .where(and(
            eq(gmailMessageState.googleSubject, connection.googleSubject),
            eq(gmailMessageState.processingStatus, "pending"),
          ))
          .limit(bounds.maxTotalMessages);
        const recoveryCount = recoverable.length;

        for (const state of recoverable) {
          let parsed: ParsedMessage | null = null;
          try {
            const [snapshot] = await this.db
              .select({
                sourceLabelId: triageConfig.sourceLabelId,
                priorityLabelId: triageConfig.priorityLabelId,
                reviewLabelId: triageConfig.reviewLabelId,
                newLabelId: triageConfig.newLabelId,
                archiveLabelId: triageConfig.archiveLabelId,
                terms: triageConfig.terms,
                senderWhitelist: triageConfig.senderWhitelist,
                senderBlocklist: triageConfig.senderBlocklist,
              })
              .from(triageConfig)
              .where(and(
                eq(triageConfig.ownerAuthUserId, ownerId),
                eq(triageConfig.version, state.configVersion),
              ))
              .limit(1);
            if (!snapshot) throw new Error("Recovery configuration missing");
            const recoveryLabels = resolveLabelRefs(snapshot, catalog);
            validateLabels(recoveryLabels);
            parsed = parseGmailMessage(
              await provider.getMessage(state.gmailMessageId) as GmailMessage,
            );
            const storedOutcome = CLASSIFICATION_OUTCOMES.has(
              state.outcome as ClassificationOutcome,
            )
              ? state.outcome as ClassificationOutcome
              : null;
            const classification =
              state.processingStatus === "pending" && storedOutcome
                ? { outcome: storedOutcome, reason: "Recovered pending mutation" }
                : classifyWithReason(
                    parsed,
                    snapshot.terms as ClassificationTerms,
                    snapshot.senderWhitelist as readonly string[],
                    snapshot.senderBlocklist as readonly string[],
                  );
            const [claimed] = await this.db
              .update(gmailMessageState)
              .set({
                latestRunId: runId,
                outcome: classification.outcome,
                processingStatus: "pending",
                processedAt: null,
                updatedAt: sql`now()`,
              })
              .where(and(
                eq(gmailMessageState.googleSubject, connection.googleSubject),
                eq(gmailMessageState.gmailMessageId, state.gmailMessageId),
                eq(gmailMessageState.processingStatus, "pending"),
              ))
              .returning({ gmailMessageId: gmailMessageState.gmailMessageId });
            if (!claimed) continue;
            await reconcileLabelMovement(
              provider,
              parsed,
              classification.outcome,
              recoveryLabels,
              assertMutationAllowed,
            );
            await persistMessageSnapshotIfEligible({
              outcome: classification.outcome,
              parsed,
              ownerAuthUserId: ownerId,
              runId,
              encryptionKey: this.encryptionKey,
              store: this.snapshots,
            });
            await this.db
              .update(gmailMessageState)
              .set({
                processingStatus: "processed",
                processedAt: sql`now()`,
                updatedAt: sql`now()`,
              })
              .where(and(
                eq(gmailMessageState.googleSubject, connection.googleSubject),
                eq(gmailMessageState.gmailMessageId, state.gmailMessageId),
                eq(gmailMessageState.processingStatus, "pending"),
              ));
            results.push({
              gmailMessageId: parsed.id,
              gmailThreadId: parsed.threadId,
              subject: parsed.subject,
              senderAddress: parsed.from,
              outcome: classification.outcome,
              reason: classification.reason,
              proposedLabelId: displayLabelName(
                destinationFor(classification.outcome, recoveryLabels),
                catalog,
              ),
            });
          } catch (error) {
            failureCount += 1;
            console.error(
              "Message recovery failed",
              state.gmailMessageId,
              error instanceof Error ? error.message : error,
            );
            await this.db
              .update(gmailMessageState)
              .set({
                outcome: "failed",
                processingStatus: "failed",
                processedAt: sql`now()`,
                updatedAt: sql`now()`,
              })
              .where(and(
                eq(gmailMessageState.googleSubject, connection.googleSubject),
                eq(gmailMessageState.gmailMessageId, state.gmailMessageId),
                eq(gmailMessageState.latestRunId, runId),
                eq(gmailMessageState.processingStatus, "pending"),
              ));
            results.push({
              gmailMessageId: state.gmailMessageId,
              gmailThreadId: parsed?.threadId ?? null,
              subject: parsed?.subject ?? null,
              senderAddress: parsed?.from ?? null,
              outcome: "failed",
              reason: "Message recovery failed",
              proposedLabelId: null,
            });
          }
        }

        if (remainingMessageBudget(bounds.maxTotalMessages, recoveryCount) === 0) {
          const status = "bounded_incomplete" as const;
          await this.db
            .update(syncRun)
            .set({
              status,
              nextPageToken: initialPageToken,
              finishedAt: sql`now()`,
            })
            .where(eq(syncRun.id, runId));
          return {
            runId,
            status,
            trial,
            exhausted: false,
            nextPageToken: initialPageToken,
            results,
          };
        }
        bounds = {
          ...bounds,
          maxTotalMessages: remainingMessageBudget(
            bounds.maxTotalMessages,
            recoveryCount,
          ),
        };
      }

      const result = await listBounded(
        provider,
        labels.sourceLabelId,
        bounds,
        initialPageToken ?? undefined,
      );
      for (const messageId of result.messageIds) {
        const [renewed] = await this.db
          .update(syncLease)
          .set({ leaseExpiresAt: sql`now() + (${SYNC_LEASE_SECONDS} * interval '1 second')` })
          .where(and(
            eq(syncLease.ownerAuthUserId, ownerId),
            eq(syncLease.leaseOwner, runId),
            eq(syncLease.fenceToken, lease.fenceToken),
            sql`${syncLease.leaseExpiresAt} > now()`,
          ))
          .returning({ fenceToken: syncLease.fenceToken });
        if (!renewed) throw new Error("Synchronization lease lost");
        if (!trial) {
          const [existingState] = await this.db
            .select({ processingStatus: gmailMessageState.processingStatus })
            .from(gmailMessageState)
            .where(and(
              eq(gmailMessageState.googleSubject, connection.googleSubject),
              eq(gmailMessageState.gmailMessageId, messageId),
            ))
            .limit(1);
          if (messageStateAction(existingState?.processingStatus) === "skip") {
            continue;
          }
        }
        let parsed: ParsedMessage | null = null;
        let durablePendingRecorded = false;
        try {
          parsed = parseGmailMessage(await provider.getMessage(messageId) as GmailMessage);
          const { outcome, reason } = classifyWithReason(parsed, terms, senderWhitelist, senderBlocklist);
          const proposedLabelId = displayLabelName(
            destinationFor(outcome, labels),
            catalog,
          );
          // neon-http has no transaction support — keep this a single statement.
          await this.db
            .insert(messageProcessing)
            .values({
              runId,
              gmailMessageId: parsed.id,
              gmailThreadId: parsed.threadId,
              internalDate: parsed.internalDate,
              senderAddress: parseMailboxAddress(parsed.from),
              subject: parsed.subject,
              outcome,
              outcomeReason: reason,
            })
            .onConflictDoNothing();
          if (!trial) {
            const inserted = await this.db
              .insert(gmailMessageState)
              .values({
                googleSubject: connection.googleSubject,
                gmailMessageId: parsed.id,
                latestRunId: runId,
                configVersion: config.version,
                outcome,
                processingStatus: "pending",
                processedAt: null,
                updatedAt: sql`now()`,
              })
              .onConflictDoNothing()
              .returning({ gmailMessageId: gmailMessageState.gmailMessageId });
            if (inserted.length === 0) {
              const [claimed] = await this.db
                .update(gmailMessageState)
                .set({
                  latestRunId: runId,
                  configVersion: config.version,
                  outcome,
                  processingStatus: "pending",
                  processedAt: null,
                  updatedAt: sql`now()`,
                })
                .where(and(
                  eq(gmailMessageState.googleSubject, connection.googleSubject),
                  eq(gmailMessageState.gmailMessageId, parsed.id),
                  eq(gmailMessageState.processingStatus, "failed"),
                ))
                .returning({ gmailMessageId: gmailMessageState.gmailMessageId });
              if (!claimed) throw new Error("Message state requires recovery");
            }
            durablePendingRecorded = true;
            await reconcileLabelMovement(
              provider,
              parsed,
              outcome,
              labels,
              assertMutationAllowed,
            );
          }
          await this.db
            .update(messageProcessing)
            .set({ processedAt: sql`now()` })
            .where(and(eq(messageProcessing.runId, runId), eq(messageProcessing.gmailMessageId, parsed.id)));
          await persistMessageSnapshotIfEligible({
            outcome,
            parsed,
            ownerAuthUserId: ownerId,
            runId,
            encryptionKey: this.encryptionKey,
            store: this.snapshots,
          });
          if (!trial && durablePendingRecorded) {
            await this.db
              .update(gmailMessageState)
              .set({
                processingStatus: "processed",
                processedAt: sql`now()`,
                updatedAt: sql`now()`,
              })
              .where(and(
                eq(gmailMessageState.googleSubject, connection.googleSubject),
                eq(gmailMessageState.gmailMessageId, parsed.id),
                eq(gmailMessageState.latestRunId, runId),
              ));
          }
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
          failureCount += 1;
          console.error("Message processing failed", messageId, error instanceof Error ? error.message : error);
          const failReason = parsed ? "Message processing failed" : "Message could not be parsed";
          await this.db
            .insert(messageProcessing)
            .values({
              runId,
              gmailMessageId: messageId,
              gmailThreadId: parsed?.threadId,
              internalDate: parsed?.internalDate,
              senderAddress: parsed ? parseMailboxAddress(parsed.from) : null,
              subject: parsed?.subject ?? null,
              outcome: "failed",
              outcomeReason: failReason,
              errorCode: parsed ? "MESSAGE_PROCESSING_FAILED" : "MESSAGE_PARSE_FAILED",
              processedAt: sql`now()`,
            })
            .onConflictDoNothing();
          if (!trial) {
            await this.db
              .insert(gmailMessageState)
              .values({
                googleSubject: connection.googleSubject,
                gmailMessageId: messageId,
                latestRunId: runId,
                configVersion: config.version,
                outcome: "failed",
                processingStatus: "failed",
                processedAt: sql`now()`,
                updatedAt: sql`now()`,
              })
              .onConflictDoNothing();
          }
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
      const status = syncStatusFor(result.exhausted, failureCount);
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
