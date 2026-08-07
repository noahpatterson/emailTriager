/**
 * Review Queue service: stratified pending items from the last Audit Run,
 * Owner Label → Golden Set (holdout). Never mutates Gmail (ADR-0004).
 */
import "server-only";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  auditRun,
  goldenSetMessage,
  messageProcessing,
  messageSnapshot,
  triageConfig,
  verdict,
} from "@/db/schema";
import { getServerConfig } from "@/src/config/server";
import {
  asCategoryIntent,
  type CategoryIntent,
} from "@/src/server/config/triage-validate";
import { database, type Database } from "@/src/server/db";
import type { ClassificationOutcome } from "@/src/server/gmail/classify";
import type { Category } from "@/src/server/gmail/corpus";
import {
  decryptMessageSnapshotPayload,
} from "@/src/server/gmail/message-snapshot";
import { truncatePromptBody } from "@/src/server/gmail/judge-prompt";
import { ensureOwnerBinding as writeOwnerBinding } from "@/src/server/owner-binding";
import {
  DEFAULT_AGREEMENT_SAMPLE_RATE,
  DEFAULT_REVIEW_PAGE_SIZE,
  parseOwnerLabel,
  ReviewClientError,
  selectReviewQueueItems,
  takeReviewSitting,
  type ReviewQueueCandidate,
} from "@/src/server/gmail/review-queue";

export { parseOwnerLabel, ReviewClientError } from "@/src/server/gmail/review-queue";

export const REVIEW_SNAPSHOT_EXCERPT_CHARS = 500;

export type ReviewQueueResponse = Readonly<{
  auditRunId: string | null;
  syncRunId: string | null;
  /** Full stratified pending count before the sitting window. */
  pendingCount: number;
  /** One sitting of the stratified queue (default 20). */
  items: readonly ReviewQueueCandidate[];
  categoryIntent: CategoryIntent | null;
}>;

export type SubmitOwnerLabelResult = Readonly<{
  gmailMessageId: string;
  ownerLabel: Category;
  goldenSetId: number;
  partition: "holdout";
  created: boolean;
}>;

type CompletedAuditRun = Readonly<{ id: string; syncRunId: string }>;

export class ReviewService {
  constructor(
    private readonly db: Database = database(),
    private readonly encryptionKey: string = getServerConfig().tokenEncryptionKeyV1,
  ) {}

  async ensureOwnerBinding(ownerId: string): Promise<void> {
    await writeOwnerBinding(this.db, ownerId);
  }

  /**
   * Stratified pending items from the owner's most recent finished Audit Run.
   * Full stratified pool is computed first (all disagreements + ~10% agreements);
   * `items` is one sitting window over that pool.
   */
  async getQueue(
    ownerId: string,
    options: Readonly<{
      pageSize?: number;
      offset?: number;
      agreementSampleRate?: number;
      random?: () => number;
    }> = {},
  ): Promise<ReviewQueueResponse> {
    await this.ensureOwnerBinding(ownerId);

    const latest = await this.latestCompletedAuditRun(ownerId);
    if (!latest) {
      return {
        auditRunId: null,
        syncRunId: null,
        pendingCount: 0,
        items: [],
        categoryIntent: null,
      };
    }

    const [config] = await this.db
      .select({ categoryIntent: triageConfig.categoryIntent })
      .from(triageConfig)
      .where(eq(triageConfig.ownerAuthUserId, ownerId))
      .orderBy(desc(triageConfig.version))
      .limit(1);

    const categoryIntent = config
      ? asCategoryIntent(config.categoryIntent)
      : null;

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
        pendingCount: 0,
        items: [],
        categoryIntent,
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
          outcome: messageProcessing.outcome,
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
      outcomes.map((row) => [row.gmailMessageId, row.outcome] as const),
    );
    const alreadyLabeledIds = new Set(
      labeled
        .map((row) => row.sourceGmailMessageId)
        .filter((id): id is string => typeof id === "string"),
    );

    const candidates: ReviewQueueCandidate[] = [];
    for (const row of verdictRows) {
      const ciphertext = snapshotById.get(row.gmailMessageId);
      const outcome = outcomeById.get(row.gmailMessageId);
      if (!ciphertext || !outcome) continue;
      let plaintext;
      try {
        plaintext = decryptMessageSnapshotPayload(ciphertext, this.encryptionKey);
      } catch {
        continue;
      }
      candidates.push({
        verdictId: row.id,
        gmailMessageId: row.gmailMessageId,
        agreesWithFiling: row.agreesWithFiling,
        deterministicOutcome: outcome as ClassificationOutcome | "failed",
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

    const stratified = selectReviewQueueItems(candidates, {
      agreementSampleRate: options.agreementSampleRate ?? DEFAULT_AGREEMENT_SAMPLE_RATE,
      alreadyLabeledIds,
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
      pendingCount: stratified.length,
      items,
      categoryIntent,
    };
  }

  /**
   * Persist Owner Label and copy frozen snapshot text into Golden Set (holdout).
   * Updates the label when a golden-set row already exists. Never calls Gmail.
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
    };
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
