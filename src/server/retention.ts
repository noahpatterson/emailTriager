import "server-only";
import { and, isNotNull, lt, lte } from "drizzle-orm";
import { gmailMessageState, oauthState, syncRun } from "@/db/schema";
import { getServerConfig } from "@/src/config/server";
import { database, type Database } from "@/src/server/db";

export type RetentionResult = Readonly<{
  oauthStatesDeleted: number;
  messageStatesDeleted: number;
  runsDeleted: number;
}>;

export interface RetentionStore {
  deleteExpiredOAuthState(cutoff: Date): Promise<number>;
  deleteExpiredMessageState(cutoff: Date): Promise<number>;
  deleteExpiredRuns(cutoff: Date): Promise<number>;
}

class DatabaseRetentionStore implements RetentionStore {
  constructor(private readonly db: Database) {}

  async deleteExpiredOAuthState(cutoff: Date): Promise<number> {
    const rows = await this.db
      .delete(oauthState)
      .where(lte(oauthState.expiresAt, cutoff))
      .returning({ stateHash: oauthState.stateHash });
    return rows.length;
  }

  async deleteExpiredMessageState(cutoff: Date): Promise<number> {
    const rows = await this.db
      .delete(gmailMessageState)
      .where(lt(gmailMessageState.updatedAt, cutoff))
      .returning({ gmailMessageId: gmailMessageState.gmailMessageId });
    return rows.length;
  }

  async deleteExpiredRuns(cutoff: Date): Promise<number> {
    const rows = await this.db
      .delete(syncRun)
      .where(and(isNotNull(syncRun.finishedAt), lt(syncRun.finishedAt, cutoff)))
      .returning({ id: syncRun.id });
    return rows.length;
  }
}

export class RetentionService {
  constructor(
    private readonly store: RetentionStore = new DatabaseRetentionStore(database()),
    private readonly retentionDays = getServerConfig().retentionDays,
  ) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Error("Retention days must be a positive integer");
    }
  }

  async run(now = new Date()): Promise<RetentionResult> {
    const historyCutoff = new Date(
      now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000,
    );
    const oauthStatesDeleted = await this.store.deleteExpiredOAuthState(now);
    const messageStatesDeleted =
      await this.store.deleteExpiredMessageState(historyCutoff);
    const runsDeleted = await this.store.deleteExpiredRuns(historyCutoff);
    return { oauthStatesDeleted, messageStatesDeleted, runsDeleted };
  }
}
