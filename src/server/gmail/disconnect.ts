import "server-only";
import { eq, sql } from "drizzle-orm";
import { gmailConnection, syncLease } from "@/db/schema";
import { getServerConfig } from "@/src/config/server";
import { database, type Database } from "@/src/server/db";
import { decryptSecret } from "@/src/server/security/crypto";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class DisconnectService {
  constructor(
    private readonly db: Database = database(),
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async disconnect(ownerId: string): Promise<void> {
    // Fence first: workers must fail their immediate pre-mutation lease check.
    await this.db.delete(syncLease).where(eq(syncLease.ownerAuthUserId, ownerId));
    const [row] = await this.db
      .update(gmailConnection)
      .set({
        disconnectedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(gmailConnection.ownerAuthUserId, ownerId))
      .returning({ encryptedRefreshToken: gmailConnection.encryptedRefreshToken });
    if (!row) return;
    try {
      const token = decryptSecret(row.encryptedRefreshToken, getServerConfig().tokenEncryptionKeyV1);
      await this.fetcher("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
    } catch {
      // Local credential removal is mandatory even when Google is unavailable.
    } finally {
      await this.db.delete(gmailConnection).where(eq(gmailConnection.ownerAuthUserId, ownerId));
    }
  }
}
