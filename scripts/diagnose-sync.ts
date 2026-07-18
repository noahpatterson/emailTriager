/**
 * Read-only sync diagnostics: config bounds + Gmail list/listBounded.
 * Does NOT run MessageSyncService (no live label mutations, no sync-run writes).
 * Usage: bun run scripts/diagnose-sync.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { triageConfig } from "../db/schema";
import { decryptSecret } from "../src/server/security/crypto";
import { GoogleGmailProvider } from "../src/server/gmail/google";
import { listBounded } from "../src/server/gmail/sync";

const ownerId = process.env.OWNER_NEON_AUTH_USER_ID;
const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const tokenKey = process.env.TOKEN_ENCRYPTION_KEY_V1;
if (!ownerId || !dbUrl || !clientId || !clientSecret || !tokenKey) {
  throw new Error("Missing env");
}

const sql = neon(dbUrl);
const db = drizzle(sql, { schema });

async function providerForOwner(id: string): Promise<GoogleGmailProvider> {
  const rows = await sql`
    SELECT encrypted_refresh_token
    FROM gmail_connection
    WHERE owner_auth_user_id = ${id} AND disconnected_at IS NULL
    LIMIT 1
  `;
  if (!rows[0]) throw new Error("Gmail not connected");
  const refresh = decryptSecret(String(rows[0].encrypted_refresh_token), tokenKey!);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenResponse.ok) throw new Error(`token refresh failed: ${tokenResponse.status}`);
  const body = (await tokenResponse.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("no access token");
  return new GoogleGmailProvider(body.access_token);
}

const [configRow] = await db
  .select({
    sourceLabelId: triageConfig.sourceLabelId,
    bounds: triageConfig.bounds,
  })
  .from(triageConfig)
  .where(eq(triageConfig.ownerAuthUserId, ownerId))
  .orderBy(desc(triageConfig.version))
  .limit(1);

console.log("CONFIG", JSON.stringify(configRow, null, 2));
const bounds = configRow?.bounds as {
  maxPages: number;
  maxMessagesPerPage: number;
  maxTotalMessages: number;
};
const computed = Math.min(bounds.maxMessagesPerPage, bounds.maxTotalMessages);
console.log("COMPUTED_MAX_RESULTS", computed, typeof computed);

const provider = await providerForOwner(ownerId);
try {
  const page = await provider.listMessages({
    sourceLabelId: configRow!.sourceLabelId,
    maxResults: computed,
  });
  console.log("LIST_OK", page.messages.length, page.nextPageToken ? "hasToken" : "noToken");
} catch (error) {
  console.error("LIST_FAIL", error instanceof Error ? error.message : error);
}

try {
  const bounded = await listBounded(provider, configRow!.sourceLabelId, bounds);
  console.log("BOUNDED_OK", bounded.messageIds.length, bounded.exhausted);
} catch (error) {
  console.error("BOUNDED_FAIL", error instanceof Error ? error.message : error);
}

console.log("SYNC_SKIPPED", "diagnose-sync is read-only; use the dashboard for live or trial sync");
