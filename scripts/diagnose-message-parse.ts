/**
 * One-shot: fetch a failed Gmail message and report parse errors.
 * Usage: bun run scripts/diagnose-message-parse.ts [messageId]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { parseGmailMessage, type GmailMessage } from "../src/server/gmail/message";
import { GoogleGmailProvider } from "../src/server/gmail/google";
import { decryptSecret } from "../src/server/security/crypto";

const ownerId = process.env.OWNER_NEON_AUTH_USER_ID;
const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const tokenKey = process.env.TOKEN_ENCRYPTION_KEY_V1;
if (!ownerId || !dbUrl || !clientId || !clientSecret || !tokenKey) {
  throw new Error("Missing env for diagnose script");
}

const sql = neon(dbUrl);
const rows = await sql`
  SELECT encrypted_refresh_token
  FROM gmail_connection
  WHERE owner_auth_user_id = ${ownerId} AND disconnected_at IS NULL
  LIMIT 1
`;
if (!rows[0]) throw new Error("Gmail not connected");

const refreshToken = decryptSecret(String(rows[0].encrypted_refresh_token), tokenKey);
const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }),
});
if (!tokenResponse.ok) throw new Error(`token refresh failed: ${tokenResponse.status}`);
const tokenBody = await tokenResponse.json() as { access_token?: string };
if (!tokenBody.access_token) throw new Error("no access token");

const messageId = process.argv[2] ?? "19f75ed8021cea36";
const provider = new GoogleGmailProvider(tokenBody.access_token);
const raw = await provider.getMessage(messageId) as GmailMessage;
console.log(JSON.stringify({
  id: raw.id,
  threadId: raw.threadId,
  hasPayload: Boolean(raw.payload),
  mimeType: raw.payload?.mimeType,
  headerNames: (raw.payload?.headers ?? []).map((h) => h.name),
  partCount: raw.payload?.parts?.length ?? 0,
  topBodyDataLen: raw.payload?.body?.data?.length ?? 0,
  topBodyDataSample: raw.payload?.body?.data?.slice(0, 80) ?? null,
}, null, 2));

try {
  const parsed = parseGmailMessage(raw);
  console.log("PARSE_OK", {
    from: parsed.from,
    subject: parsed.subject,
    bodyLen: parsed.bodyText.length,
    labelIds: parsed.labelIds,
  });
} catch (error) {
  console.error("PARSE_FAIL", error instanceof Error ? error.message : error);
  const bad: string[] = [];
  const visit = (part: NonNullable<GmailMessage["payload"]>, path: string): void => {
    if (part.body?.data) {
      const data = part.body.data;
      if (!/^[A-Za-z0-9_-]*={0,2}$/.test(data)) {
        bad.push(`${path} mime=${part.mimeType} len=${data.length} sample=${JSON.stringify(data.slice(0, 80))}`);
      }
    }
    (part.parts ?? []).forEach((child, i) => visit(child, `${path}.${i}`));
  };
  if (raw.payload) visit(raw.payload, "payload");
  console.error("BAD_BASE64_PARTS", bad.slice(0, 15));
}
