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
import { GmailReauthorizationRequiredError } from "@/src/server/gmail/connection-health";
import { GoogleGmailProvider } from "./google";

type GoogleRefreshCredentials = Readonly<{
  clientId: string;
  clientSecret: string;
}>;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function refreshGoogleAccessToken(
  refreshToken: string,
  credentials: GoogleRefreshCredentials,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const response = await fetchWithRetry(fetcher, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json().catch(() => null) as {
    access_token?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok) {
    if (response.status === 400 && body?.error === "invalid_grant") {
      throw new GmailReauthorizationRequiredError();
    }
    throw new Error("Token refresh failed");
  }
  if (typeof body?.access_token !== "string" || !body.access_token) {
    throw new Error("Token refresh failed");
  }
  return body.access_token;
}

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
  const accessToken = await refreshGoogleAccessToken(
    decryptSecret(row.encryptedRefreshToken, config.tokenEncryptionKeyV1),
    {
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
    },
  );
  return new GoogleGmailProvider(accessToken);
}
