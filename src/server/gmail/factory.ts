import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { gmailConnection } from "@/db/schema";
import { getServerConfig } from "@/src/config/server";
import { database } from "@/src/server/db";
import { decryptSecret } from "@/src/server/security/crypto";
import { fetchWithRetry } from "@/src/server/http/fetch-with-retry";
import { usesFixtureGmailProvider } from "@/src/server/gmail/app-profile";
import type { GmailProvider } from "@/src/server/gmail/contracts";
import { seedGmailFakeFromCorpus } from "@/src/server/gmail/corpus-seed";
import { GoogleGmailProvider } from "./google";

export async function googleProviderForOwner(ownerId: string): Promise<GmailProvider> {
  if (usesFixtureGmailProvider()) {
    return seedGmailFakeFromCorpus();
  }

  const [row] = await database()
    .select({ encryptedRefreshToken: gmailConnection.encryptedRefreshToken })
    .from(gmailConnection)
    .where(and(eq(gmailConnection.ownerAuthUserId, ownerId), isNull(gmailConnection.disconnectedAt)))
    .limit(1);
  if (!row) throw new Error("Gmail is not connected");
  const config = getServerConfig();
  const response = await fetchWithRetry(fetch, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: decryptSecret(row.encryptedRefreshToken, config.tokenEncryptionKeyV1),
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error("Token refresh failed");
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Token refresh failed");
  return new GoogleGmailProvider(body.access_token);
}
