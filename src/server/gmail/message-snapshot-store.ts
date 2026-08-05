import "server-only";
import { messageSnapshot } from "@/db/schema";
import type { Database } from "@/src/server/db";
import type { MessageSnapshotInsert, MessageSnapshotStore } from "./message-snapshot";

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
}
