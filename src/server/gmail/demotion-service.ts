/**
 * Pending demotion queue: owner confirms archive filings from audit (ADR-0010).
 * Confirm applies Gmail label change via reconcileCategoryFiling; never auto-archives.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  auditRun,
  messageSnapshot,
  pendingDemotion,
  syncLease,
  triageConfig,
  verdict,
} from "@/db/schema";
import { getServerConfig } from "@/src/config/server";
import { database, type Database } from "@/src/server/db";
import type { Category } from "@/src/server/gmail/corpus";
import type { GmailProvider } from "@/src/server/gmail/contracts";
import { googleProviderForOwner } from "@/src/server/gmail/factory";
import { decryptMessageSnapshotPayload } from "@/src/server/gmail/message-snapshot";
import { truncatePromptBody } from "@/src/server/gmail/judge-prompt";
import { parseGmailMessage, type GmailMessage } from "@/src/server/gmail/message";
import { ensureOwnerBinding as writeOwnerBinding } from "@/src/server/owner-binding";
import { reconcileCategoryFiling } from "@/src/server/gmail/sync";

export const DEFAULT_DEMOTION_PAGE_SIZE = 20;
export const DEMOTION_SNAPSHOT_EXCERPT_CHARS = 500;
const DEMOTION_LEASE_SECONDS = 300;

export class DemotionClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemotionClientError";
  }
}

export type PendingDemotionItem = Readonly<{
  id: number;
  gmailMessageId: string;
  verdictId: number;
  recommendedCategory: Category;
  rationale: string | null;
  subject: string;
  from: string;
  bodyExcerpt: string;
  createdAt: string;
}>;

export type DemotionQueueResponse = Readonly<{
  pendingCount: number;
  items: readonly PendingDemotionItem[];
}>;

export type ConfirmDemotionResult = Readonly<{
  gmailMessageId: string;
  confirmed: boolean;
  alreadyConfirmed: boolean;
}>;

export type DemotionServiceDeps = Readonly<{
  providerForOwner?: (ownerId: string) => Promise<GmailProvider>;
  encryptionKey?: string;
}>;

export class DemotionService {
  private readonly providerForOwner: (ownerId: string) => Promise<GmailProvider>;
  private readonly encryptionKey: string;

  constructor(
    private readonly db: Database = database(),
    deps: DemotionServiceDeps = {},
  ) {
    this.providerForOwner = deps.providerForOwner ?? googleProviderForOwner;
    this.encryptionKey = deps.encryptionKey ?? getServerConfig().tokenEncryptionKeyV1;
  }

  async ensureOwnerBinding(ownerId: string): Promise<void> {
    await writeOwnerBinding(this.db, ownerId);
  }

  async getQueue(
    ownerId: string,
    options: Readonly<{ pageSize?: number; offset?: number }> = {},
  ): Promise<DemotionQueueResponse> {
    await this.ensureOwnerBinding(ownerId);
    const pageSize = options.pageSize ?? DEFAULT_DEMOTION_PAGE_SIZE;
    const offset = options.offset ?? 0;

    const rows = await this.db
      .select({
        id: pendingDemotion.id,
        gmailMessageId: pendingDemotion.gmailMessageId,
        verdictId: pendingDemotion.verdictId,
        createdAt: pendingDemotion.createdAt,
        recommendedCategory: verdict.recommendedCategory,
        rationale: verdict.rationale,
        encryptedPayload: messageSnapshot.encryptedPayload,
        keyVersion: messageSnapshot.keyVersion,
      })
      .from(pendingDemotion)
      .innerJoin(verdict, eq(pendingDemotion.verdictId, verdict.id))
      .innerJoin(auditRun, eq(verdict.auditRunId, auditRun.id))
      .leftJoin(
        messageSnapshot,
        and(
          eq(messageSnapshot.ownerAuthUserId, ownerId),
          eq(messageSnapshot.gmailMessageId, pendingDemotion.gmailMessageId),
          eq(messageSnapshot.runId, auditRun.syncRunId),
        ),
      )
      .where(and(
        eq(pendingDemotion.ownerAuthUserId, ownerId),
        isNull(pendingDemotion.confirmedAt),
      ))
      .orderBy(desc(pendingDemotion.createdAt));

    const pendingCount = rows.length;
    const window = rows.slice(offset, offset + pageSize);
    const items: PendingDemotionItem[] = [];

    for (const row of window) {
      let subject = "";
      let from = "";
      let bodyExcerpt = "";
      if (row.encryptedPayload) {
        try {
          const payload = decryptMessageSnapshotPayload(row.encryptedPayload, this.encryptionKey);
          subject = payload.subject;
          from = payload.from;
          bodyExcerpt = truncatePromptBody(payload.bodyText, DEMOTION_SNAPSHOT_EXCERPT_CHARS);
        } catch {
          // Snapshot decrypt failure — still list the row with empty excerpt.
        }
      }
      const recommended = row.recommendedCategory;
      if (recommended !== "priority" && recommended !== "review" && recommended !== "new" && recommended !== "archive") {
        continue;
      }
      items.push({
        id: row.id,
        gmailMessageId: row.gmailMessageId,
        verdictId: row.verdictId,
        recommendedCategory: recommended,
        rationale: row.rationale,
        subject,
        from,
        bodyExcerpt,
        createdAt: row.createdAt.toISOString(),
      });
    }

    return { pendingCount, items };
  }

  async confirmDemotion(ownerId: string, gmailMessageId: string): Promise<ConfirmDemotionResult> {
    await this.ensureOwnerBinding(ownerId);
    const messageId = gmailMessageId.trim();
    if (!messageId) throw new DemotionClientError("gmailMessageId is required");

    const [pending] = await this.db
      .select({
        id: pendingDemotion.id,
        confirmedAt: pendingDemotion.confirmedAt,
      })
      .from(pendingDemotion)
      .where(and(
        eq(pendingDemotion.ownerAuthUserId, ownerId),
        eq(pendingDemotion.gmailMessageId, messageId),
        isNull(pendingDemotion.confirmedAt),
      ))
      .orderBy(desc(pendingDemotion.createdAt))
      .limit(1);

    if (!pending) {
      const [existing] = await this.db
        .select({ id: pendingDemotion.id })
        .from(pendingDemotion)
        .where(and(
          eq(pendingDemotion.ownerAuthUserId, ownerId),
          eq(pendingDemotion.gmailMessageId, messageId),
        ))
        .limit(1);
      if (existing) {
        return { gmailMessageId: messageId, confirmed: true, alreadyConfirmed: true };
      }
      throw new DemotionClientError("Pending demotion not found");
    }

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
    if (!config) throw new DemotionClientError("Sync configuration missing");

    const labels = {
      sourceLabelId: config.sourceLabelId,
      priorityLabelId: config.priorityLabelId,
      reviewLabelId: config.reviewLabelId,
      newLabelId: config.newLabelId,
      archiveLabelId: config.archiveLabelId,
    };

    const confirmId = randomUUID();
    const [lease] = await this.db
      .insert(syncLease)
      .values({
        ownerAuthUserId: ownerId,
        leaseOwner: confirmId,
        leaseExpiresAt: sql`now() + (${DEMOTION_LEASE_SECONDS} * interval '1 second')`,
      })
      .onConflictDoUpdate({
        target: syncLease.ownerAuthUserId,
        set: {
          leaseOwner: confirmId,
          leaseExpiresAt: sql`now() + (${DEMOTION_LEASE_SECONDS} * interval '1 second')`,
          fenceToken: sql`${syncLease.fenceToken} + 1`,
        },
        setWhere: sql`${syncLease.leaseExpiresAt} <= now()`,
      })
      .returning({ fenceToken: syncLease.fenceToken });
    if (!lease) throw new DemotionClientError("Synchronization already running");

    try {
      const provider = await this.providerForOwner(ownerId);
      const raw = await provider.getMessage(messageId);
      const parsed = parseGmailMessage(raw as GmailMessage);
      const applied = await reconcileCategoryFiling(
        provider,
        parsed,
        "archive",
        labels,
        async () => {
          const [held] = await this.db
            .select({ fenceToken: syncLease.fenceToken })
            .from(syncLease)
            .where(and(
              eq(syncLease.ownerAuthUserId, ownerId),
              eq(syncLease.leaseOwner, confirmId),
              eq(syncLease.fenceToken, lease.fenceToken),
              sql`${syncLease.leaseExpiresAt} > now()`,
            ))
            .limit(1);
          if (!held) throw new DemotionClientError("Demotion lease lost");
        },
      );
      if (!applied) {
        throw new DemotionClientError("Cannot demote a protected or starred message");
      }

      await this.db
        .update(pendingDemotion)
        .set({ confirmedAt: sql`now()` })
        .where(and(
          eq(pendingDemotion.id, pending.id),
          isNull(pendingDemotion.confirmedAt),
        ));

      return { gmailMessageId: messageId, confirmed: true, alreadyConfirmed: false };
    } finally {
      await this.db
        .delete(syncLease)
        .where(and(
          eq(syncLease.ownerAuthUserId, ownerId),
          eq(syncLease.leaseOwner, confirmId),
          eq(syncLease.fenceToken, lease.fenceToken),
        ));
    }
  }
}
