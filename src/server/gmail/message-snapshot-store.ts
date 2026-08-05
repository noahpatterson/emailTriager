import "server-only";
import { and, eq } from "drizzle-orm";
import { messageSnapshot } from "@/db/schema";
import type { Database } from "@/src/server/db";
import type { MessageSnapshotInsert, MessageSnapshotStore } from "./message-snapshot";

export type MessageSnapshotListRow = Readonly<{
  gmailMessageId: string;
  encryptedPayload: string;
  keyVersion: number;
}>;

export class DatabaseMessageSnapshotStore implements MessageSnapshotStore {
  constructor(private readonly db: Database) {}

  async insertSnapshot(row: MessageSnapshotInsert): Promise<void> {
    await this.db
      .insert(messageSnapshot)
      .values({
        ownerAuthUserId: row.ownerAuthUserId,
        runId: row.runId,
        gmailMessageId: row.gmailMessageId,
        encryptedPayload: row.encryptedPayload,
        keyVersion: row.keyVersion,
      })
      .onConflictDoNothing();
  }

  async listByRunId(
    ownerId: string,
    runId: string,
  ): Promise<readonly MessageSnapshotListRow[]> {
    return this.db
      .select({
        gmailMessageId: messageSnapshot.gmailMessageId,
        encryptedPayload: messageSnapshot.encryptedPayload,
        keyVersion: messageSnapshot.keyVersion,
      })
      .from(messageSnapshot)
      .where(
        and(
          eq(messageSnapshot.ownerAuthUserId, ownerId),
          eq(messageSnapshot.runId, runId),
        ),
      );
  }
}
