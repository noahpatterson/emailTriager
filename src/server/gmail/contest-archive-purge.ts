import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { syncLease, triageConfig } from "@/db/schema";
import { database, type Database } from "@/src/server/db";
import type { GmailProvider } from "./contracts";
import { CONTEST_ARCHIVE_PURGE_CONFIRM } from "./contest-archive-purge-confirm";
import { trashListedContestArchiveMessages } from "./contest-archive-trash-messages";
import { resolveLabelRef } from "./labels";
import { listBounded, type SyncBounds } from "./sync";

export { CONTEST_ARCHIVE_PURGE_CONFIRM } from "./contest-archive-purge-confirm";
export { trashListedContestArchiveMessages } from "./contest-archive-trash-messages";

const PURGE_BOUNDS: SyncBounds = { maxPages: 1, maxMessagesPerPage: 50, maxTotalMessages: 50 };
const PURGE_LEASE_SECONDS = 300;

export type ContestArchivePurgeResult = Readonly<{
  trashedCount: number;
  skippedStarredCount: number;
  exhausted: boolean;
  nextPageToken: string | null;
  archiveLabelName: string;
}>;

export class ContestArchivePurgeService {
  constructor(
    private readonly providerForOwner: (ownerId: string) => Promise<GmailProvider>,
    private readonly db: Database = database(),
  ) {}

  async purge(
    ownerId: string,
    options: Readonly<{ confirm: string; pageToken?: string | null }> = { confirm: "" },
  ): Promise<ContestArchivePurgeResult> {
    if (options.confirm !== CONTEST_ARCHIVE_PURGE_CONFIRM) {
      throw new Error("Confirmation required");
    }

    const purgeId = randomUUID();
    const [lease] = await this.db
      .insert(syncLease)
      .values({
        ownerAuthUserId: ownerId,
        leaseOwner: purgeId,
        leaseExpiresAt: sql`now() + (${PURGE_LEASE_SECONDS} * interval '1 second')`,
      })
      .onConflictDoUpdate({
        target: syncLease.ownerAuthUserId,
        set: {
          leaseOwner: purgeId,
          leaseExpiresAt: sql`now() + (${PURGE_LEASE_SECONDS} * interval '1 second')`,
          fenceToken: sql`${syncLease.fenceToken} + 1`,
        },
        setWhere: sql`${syncLease.leaseExpiresAt} <= now()`,
      })
      .returning({ fenceToken: syncLease.fenceToken });
    if (!lease) throw new Error("Synchronization already running");

    try {
      const [config] = await this.db
        .select({
          contestArchiveLabelId: triageConfig.contestArchiveLabelId,
        })
        .from(triageConfig)
        .where(eq(triageConfig.ownerAuthUserId, ownerId))
        .orderBy(desc(triageConfig.version))
        .limit(1);
      if (!config?.contestArchiveLabelId) throw new Error("Contest archive label is not configured");

      const provider = await this.providerForOwner(ownerId);
      const catalog = await provider.listLabels();
      const archive = resolveLabelRef(config.contestArchiveLabelId, catalog);
      const listed = await listBounded(
        provider,
        archive.id,
        PURGE_BOUNDS,
        options.pageToken ?? undefined,
      );

      const { trashedCount, skippedStarredCount } = await trashListedContestArchiveMessages(
        provider,
        listed.messageIds,
        archive.id,
        async () => {
          const [renewed] = await this.db
            .update(syncLease)
            .set({
              leaseExpiresAt: sql`now() + (${PURGE_LEASE_SECONDS} * interval '1 second')`,
            })
            .where(and(
              eq(syncLease.ownerAuthUserId, ownerId),
              eq(syncLease.leaseOwner, purgeId),
              eq(syncLease.fenceToken, lease.fenceToken),
            ))
            .returning({ fenceToken: syncLease.fenceToken });
          if (!renewed) throw new Error("Purge lease lost");
        },
      );

      return {
        trashedCount,
        skippedStarredCount,
        exhausted: listed.exhausted,
        nextPageToken: listed.nextPageToken ?? null,
        archiveLabelName: archive.name,
      };
    } finally {
      await this.db
        .delete(syncLease)
        .where(and(
          eq(syncLease.ownerAuthUserId, ownerId),
          eq(syncLease.leaseOwner, purgeId),
          eq(syncLease.fenceToken, lease.fenceToken),
        ));
    }
  }
}
