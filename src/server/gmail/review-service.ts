/**
 * Review Queue service: stratified pending items from the last Audit Run,
 * Owner Label → Golden Set (holdout) and re-file in Gmail (ADR-0004).
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  auditRun,
  goldenSetMessage,
  messageProcessing,
  messageSnapshot,
  pendingDemotion,
  syncLease,
  syncRun,
  triageConfig,
  verdict,
} from "@/db/schema";
import { getServerConfig } from "@/src/config/server";
import { OwnerPreferencesService } from "@/src/server/config/owner-preferences";
import {
  asCategoryIntent,
  asTerms,
  type CategoryIntent,
} from "@/src/server/config/triage-validate";
import { database, type Database } from "@/src/server/db";
import type { GmailProvider } from "@/src/server/gmail/contracts";
import {
  findClassificationMatch,
  type ClassificationOutcome,
} from "@/src/server/gmail/classify";
import type { Category } from "@/src/server/gmail/corpus";
import { googleProviderForOwner } from "@/src/server/gmail/factory";
import {
  decryptMessageSnapshotPayload,
} from "@/src/server/gmail/message-snapshot";
import { truncatePromptBody } from "@/src/server/gmail/judge-prompt";
import { gmailMessageUrl } from "@/src/server/gmail/gmail-url";
import { parseGmailMessage, type GmailMessage } from "@/src/server/gmail/message";
import { ensureOwnerBinding as writeOwnerBinding } from "@/src/server/owner-binding";
import { AUDITABLE_SYNC_RUN_STATUSES } from "@/src/server/gmail/audit-run";
import { reconcileCategoryFiling } from "@/src/server/gmail/sync";
import {
  DEFAULT_AGREEMENT_SAMPLE_RATE,
  DEFAULT_REVIEW_PAGE_SIZE,
  parseOwnerLabel,
  parseReviewQueueMode,
  ReviewClientError,
  selectReviewQueueItems,
  takeReviewSitting,
  type ReviewQueueCandidate,
  type ReviewQueueMode,
} from "@/src/server/gmail/review-queue";

export {
  parseOwnerLabel,
  parseReviewQueueMode,
  ReviewClientError,
} from "@/src/server/gmail/review-queue";

export const REVIEW_SNAPSHOT_EXCERPT_CHARS = 500;
const REVIEW_LEASE_SECONDS = 300;
export const DEFAULT_AUDITABLE_SYNC_RUN_LIMIT = 20;

export type AuditableSyncRun = Readonly<{
  id: string;
  status: string;
  trial: boolean;
  startedAt: string;
  finishedAt: string | null;
}>;

export type ReviewQueueResponse = Readonly<{
  auditRunId: string | null;
  syncRunId: string | null;
  /** Verdict rows written for the latest Audit Run. */
  verdictCount: number;
  /** Verdicts with decryptable snapshots + sync outcomes (eligible for review UI). */
  candidateCount: number;
  /** Unlabeled, non-malformed candidates before stratified sampling. */
  unlabeledCount: number;
  /** Full stratified pending count before the sitting window. */
  pendingCount: number;
  /** One sitting of the stratified queue (default 20). */
  items: readonly ReviewQueueCandidate[];
  categoryIntent: CategoryIntent | null;
  /** Queue selection mode used for this response. */
  mode: ReviewQueueMode;
  /** Completed sync runs eligible to start an audit from the review page. */
  syncRuns: readonly AuditableSyncRun[];
}>;

export type SubmitOwnerLabelResult = Readonly<{
  gmailMessageId: string;
  ownerLabel: Category;
  goldenSetId: number;
  partition: "holdout";
  created: boolean;
  /** false when Gmail was skipped (e.g. starred/protected). */
  gmailApplied: boolean;
}>;

type CompletedAuditRun = Readonly<{ id: string; syncRunId: string }>;

export type ReviewServiceDeps = Readonly<{
  providerForOwner?: (ownerId: string) => Promise<GmailProvider>;
  encryptionKey?: string;
}>;

export class ReviewService {
  private readonly providerForOwner: (ownerId: string) => Promise<GmailProvider>;
  private readonly encryptionKey: string;

  constructor(
    private readonly db: Database = database(),
    deps: ReviewServiceDeps = {},
  ) {
    this.providerForOwner = deps.providerForOwner ?? googleProviderForOwner;
    this.encryptionKey = deps.encryptionKey ?? getServerConfig().tokenEncryptionKeyV1;
  }

  async ensureOwnerBinding(ownerId: string): Promise<void> {
    await writeOwnerBinding(this.db, ownerId);
  }

  /**
   * Stratified (or all) pending items from the owner's most recent finished Audit Run.
   * Full pending pool is computed first; `items` is one sitting window over that pool.
   */
  async getQueue(
    ownerId: string,
    options: Readonly<{
      pageSize?: number;
      offset?: number;
      agreementSampleRate?: number;
      mode?: ReviewQueueMode;
      random?: () => number;
    }> = {},
  ): Promise<ReviewQueueResponse> {
    await this.ensureOwnerBinding(ownerId);
    const mode = options.mode ?? "stratified";
    const syncRuns = await this.listAuditableSyncRuns(ownerId);

    const latest = await this.latestCompletedAuditRun(ownerId);
    if (!latest) {
      return {
        auditRunId: null,
        syncRunId: null,
        verdictCount: 0,
        candidateCount: 0,
        unlabeledCount: 0,
        pendingCount: 0,
        items: [],
        categoryIntent: null,
        mode,
        syncRuns,
      };
    }

    const linkRoot = await new OwnerPreferencesService(this.db).getGmailMessageLinkRoot(ownerId);

    const [config] = await this.db
      .select({
        categoryIntent: triageConfig.categoryIntent,
        terms: triageConfig.terms,
      })
      .from(triageConfig)
      .where(eq(triageConfig.ownerAuthUserId, ownerId))
      .orderBy(desc(triageConfig.version))
      .limit(1);

    const categoryIntent = config
      ? asCategoryIntent(config.categoryIntent)
      : null;
    const terms = config ? asTerms(config.terms) : null;

    const verdictRows = await this.db
      .select({
        id: verdict.id,
        gmailMessageId: verdict.gmailMessageId,
        agreesWithFiling: verdict.agreesWithFiling,
        recommendedCategory: verdict.recommendedCategory,
        rationale: verdict.rationale,
        malformed: verdict.malformed,
      })
      .from(verdict)
      .where(eq(verdict.auditRunId, latest.id));

    if (verdictRows.length === 0) {
      return {
        auditRunId: latest.id,
        syncRunId: latest.syncRunId,
        verdictCount: 0,
        candidateCount: 0,
        unlabeledCount: 0,
        pendingCount: 0,
        items: [],
        categoryIntent,
        mode,
        syncRuns,
      };
    }

    const messageIds = verdictRows.map((row) => row.gmailMessageId);

    const [snapshots, outcomes, labeled] = await Promise.all([
      this.db
        .select({
          gmailMessageId: messageSnapshot.gmailMessageId,
          encryptedPayload: messageSnapshot.encryptedPayload,
        })
        .from(messageSnapshot)
        .where(
          and(
            eq(messageSnapshot.ownerAuthUserId, ownerId),
            eq(messageSnapshot.runId, latest.syncRunId),
            inArray(messageSnapshot.gmailMessageId, messageIds),
          ),
        ),
      this.db
        .select({
          gmailMessageId: messageProcessing.gmailMessageId,
          gmailThreadId: messageProcessing.gmailThreadId,
          outcome: messageProcessing.outcome,
          outcomeReason: messageProcessing.outcomeReason,
        })
        .from(messageProcessing)
        .where(
          and(
            eq(messageProcessing.runId, latest.syncRunId),
            inArray(messageProcessing.gmailMessageId, messageIds),
          ),
        ),
      this.db
        .select({
          sourceGmailMessageId: goldenSetMessage.sourceGmailMessageId,
        })
        .from(goldenSetMessage)
        .where(
          and(
            eq(goldenSetMessage.ownerAuthUserId, ownerId),
            isNotNull(goldenSetMessage.sourceGmailMessageId),
            inArray(goldenSetMessage.sourceGmailMessageId, messageIds),
          ),
        ),
    ]);

    const snapshotById = new Map(
      snapshots.map((row) => [row.gmailMessageId, row.encryptedPayload] as const),
    );
    const outcomeById = new Map(
      outcomes.map((row) => [row.gmailMessageId, row] as const),
    );
    const alreadyLabeledIds = new Set(
      labeled
        .map((row) => row.sourceGmailMessageId)
        .filter((id): id is string => typeof id === "string"),
    );

    const candidates: ReviewQueueCandidate[] = [];
    for (const row of verdictRows) {
      const ciphertext = snapshotById.get(row.gmailMessageId);
      const processing = outcomeById.get(row.gmailMessageId);
      if (!ciphertext || !processing?.outcome) continue;
      let plaintext;
      try {
        plaintext = decryptMessageSnapshotPayload(ciphertext, this.encryptionKey);
      } catch {
        continue;
      }
      const threadId = processing.gmailThreadId?.trim() || null;
      const match = terms
        ? findClassificationMatch(
          {
            from: plaintext.from,
            replyTo: plaintext.replyTo,
            subject: plaintext.subject,
            bodyText: plaintext.bodyText,
          },
          terms,
        )
        : null;
      candidates.push({
        verdictId: row.id,
        gmailMessageId: row.gmailMessageId,
        gmailThreadId: threadId,
        gmailUrl: gmailMessageUrl(
          { gmailMessageId: row.gmailMessageId, gmailThreadId: threadId },
          linkRoot,
        ),
        agreesWithFiling: row.agreesWithFiling,
        deterministicOutcome: processing.outcome as ClassificationOutcome | "failed",
        outcomeReason: processing.outcomeReason?.trim() || null,
        matchedTerm: match?.term ?? null,
        classifierMatchSnippet: match?.excerpt ?? null,
        recommendedCategory: (row.recommendedCategory as Category | null) ?? null,
        rationale: row.rationale,
        malformed: row.malformed,
        subject: plaintext.subject,
        from: plaintext.from,
        messageSnapshotExcerpt: truncatePromptBody(
          plaintext.bodyText,
          REVIEW_SNAPSHOT_EXCERPT_CHARS,
        ),
      });
    }

    const unlabeledCount = candidates.filter(
      (item) =>
        !item.malformed
        && !alreadyLabeledIds.has(item.gmailMessageId)
        && item.agreesWithFiling !== null,
    ).length;

    const stratified = selectReviewQueueItems(candidates, {
      agreementSampleRate: options.agreementSampleRate ?? DEFAULT_AGREEMENT_SAMPLE_RATE,
      alreadyLabeledIds,
      mode,
      random: options.random,
    });
    const items = takeReviewSitting(
      stratified,
      options.pageSize ?? DEFAULT_REVIEW_PAGE_SIZE,
      options.offset ?? 0,
    );

    return {
      auditRunId: latest.id,
      syncRunId: latest.syncRunId,
      verdictCount: verdictRows.length,
      candidateCount: candidates.length,
      unlabeledCount,
      pendingCount: stratified.length,
      items,
      categoryIntent,
      mode,
      syncRuns,
    };
  }

  /** Finished sync runs the owner can pick when starting an audit from /review. */
  async listAuditableSyncRuns(
    ownerId: string,
    limit: number = DEFAULT_AUDITABLE_SYNC_RUN_LIMIT,
  ): Promise<readonly AuditableSyncRun[]> {
    const rows = await this.db
      .select({
        id: syncRun.id,
        status: syncRun.status,
        trial: syncRun.trial,
        startedAt: syncRun.startedAt,
        finishedAt: syncRun.finishedAt,
      })
      .from(syncRun)
      .where(and(
        eq(syncRun.ownerAuthUserId, ownerId),
        inArray(syncRun.status, [...AUDITABLE_SYNC_RUN_STATUSES]),
        eq(syncRun.trial, false),
      ))
      .orderBy(desc(syncRun.startedAt))
      .limit(Math.max(1, Math.min(limit, 50)));

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      trial: row.trial,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Persist Owner Label, copy frozen snapshot text into Golden Set (holdout),
   * and re-file the live Gmail message onto that category label.
   * Starred/protected mail keeps the golden-set write but skips Gmail mutation.
   */
  async submitOwnerLabel(
    ownerId: string,
    gmailMessageId: string,
    ownerLabelInput: unknown,
  ): Promise<SubmitOwnerLabelResult> {
    const ownerLabel = parseOwnerLabel(ownerLabelInput);
    const messageId = gmailMessageId.trim();
    if (!messageId) {
      throw new ReviewClientError("messageId is required.");
    }
    await this.ensureOwnerBinding(ownerId);

    const [config] = await this.db
      .select({
        sourceLabelId: triageConfig.sourceLabelId,
        priorityLabelId: triageConfig.priorityLabelId,
        reviewLabelId: triageConfig.reviewLabelId,
        newLabelId: triageConfig.newLabelId,
        archiveLabelId: triageConfig.archiveLabelId,
      })
      .from(triageConfig)
      .where(eq(triageConfig.ownerAuthUserId, ownerId))
      .orderBy(desc(triageConfig.version))
      .limit(1);
    if (!config) throw new ReviewClientError("Sync configuration missing");

    const labels = {
      sourceLabelId: config.sourceLabelId,
      priorityLabelId: config.priorityLabelId,
      reviewLabelId: config.reviewLabelId,
      newLabelId: config.newLabelId,
      archiveLabelId: config.archiveLabelId,
    };

    const leaseId = randomUUID();
    const [lease] = await this.db
      .insert(syncLease)
      .values({
        ownerAuthUserId: ownerId,
        leaseOwner: leaseId,
        leaseExpiresAt: sql`now() + (${REVIEW_LEASE_SECONDS} * interval '1 second')`,
      })
      .onConflictDoUpdate({
        target: syncLease.ownerAuthUserId,
        set: {
          leaseOwner: leaseId,
          leaseExpiresAt: sql`now() + (${REVIEW_LEASE_SECONDS} * interval '1 second')`,
          fenceToken: sql`${syncLease.fenceToken} + 1`,
        },
        setWhere: sql`${syncLease.leaseExpiresAt} <= now()`,
      })
      .returning({ fenceToken: syncLease.fenceToken });
    if (!lease) throw new ReviewClientError("Synchronization already running");

    let gmailApplied = false;
    try {
      const provider = await this.providerForOwner(ownerId);
      const raw = await provider.getMessage(messageId);
      const parsed = parseGmailMessage(raw as GmailMessage);
      gmailApplied = await reconcileCategoryFiling(
        provider,
        parsed,
        ownerLabel,
        labels,
        async () => {
          const [held] = await this.db
            .select({ fenceToken: syncLease.fenceToken })
            .from(syncLease)
            .where(and(
              eq(syncLease.ownerAuthUserId, ownerId),
              eq(syncLease.leaseOwner, leaseId),
              eq(syncLease.fenceToken, lease.fenceToken),
              sql`${syncLease.leaseExpiresAt} > now()`,
            ))
            .limit(1);
          if (!held) throw new ReviewClientError("Review lease lost");
        },
      );

      // Human already filed — clear any open demotion for this message.
      await this.db
        .update(pendingDemotion)
        .set({ cancelledAt: sql`now()` })
        .where(and(
          eq(pendingDemotion.ownerAuthUserId, ownerId),
          eq(pendingDemotion.gmailMessageId, messageId),
          isNull(pendingDemotion.confirmedAt),
          isNull(pendingDemotion.cancelledAt),
        ));

      const [existing] = await this.db
        .select({
          id: goldenSetMessage.id,
          ownerLabel: goldenSetMessage.ownerLabel,
        })
        .from(goldenSetMessage)
        .where(
          and(
            eq(goldenSetMessage.ownerAuthUserId, ownerId),
            eq(goldenSetMessage.sourceGmailMessageId, messageId),
          ),
        )
        .limit(1);

      if (existing) {
        if (existing.ownerLabel !== ownerLabel) {
          await this.db
            .update(goldenSetMessage)
            .set({ ownerLabel })
            .where(eq(goldenSetMessage.id, existing.id));
        }
        return {
          gmailMessageId: messageId,
          ownerLabel,
          goldenSetId: existing.id,
          partition: "holdout",
          created: false,
          gmailApplied,
        };
      }

      const latest = await this.latestCompletedAuditRun(ownerId);
      if (!latest) {
        throw new ReviewClientError("No Audit Run found for review.");
      }

      const [snapshot] = await this.db
        .select({
          encryptedPayload: messageSnapshot.encryptedPayload,
        })
        .from(messageSnapshot)
        .where(
          and(
            eq(messageSnapshot.ownerAuthUserId, ownerId),
            eq(messageSnapshot.runId, latest.syncRunId),
            eq(messageSnapshot.gmailMessageId, messageId),
          ),
        )
        .limit(1);

      if (!snapshot) {
        throw new ReviewClientError("Message Snapshot not found for review.");
      }

      let plaintext;
      try {
        plaintext = decryptMessageSnapshotPayload(snapshot.encryptedPayload, this.encryptionKey);
      } catch {
        throw new ReviewClientError("Message Snapshot could not be decrypted.");
      }

      const inserted = await this.db
        .insert(goldenSetMessage)
        .values({
          ownerAuthUserId: ownerId,
          sourceGmailMessageId: messageId,
          fixtureId: null,
          fromAddress: plaintext.from,
          subject: plaintext.subject,
          bodyText: plaintext.bodyText,
          ownerLabel,
          partition: "holdout",
        })
        .returning({ id: goldenSetMessage.id });

      const row = inserted[0];
      if (!row) {
        throw new ReviewClientError("Failed to persist Owner Label.");
      }

      return {
        gmailMessageId: messageId,
        ownerLabel,
        goldenSetId: row.id,
        partition: "holdout",
        created: true,
        gmailApplied,
      };
    } finally {
      await this.db
        .delete(syncLease)
        .where(and(
          eq(syncLease.ownerAuthUserId, ownerId),
          eq(syncLease.leaseOwner, leaseId),
          eq(syncLease.fenceToken, lease.fenceToken),
        ));
    }
  }

  private async latestCompletedAuditRun(ownerId: string): Promise<CompletedAuditRun | null> {
    const [latest] = await this.db
      .select({
        id: auditRun.id,
        syncRunId: auditRun.syncRunId,
      })
      .from(auditRun)
      .where(and(
        eq(auditRun.ownerAuthUserId, ownerId),
        sql`${auditRun.status} IN ('completed', 'partial_failure', 'bounded_incomplete')`,
      ))
      .orderBy(desc(auditRun.startedAt))
      .limit(1);
    return latest ?? null;
  }
}
