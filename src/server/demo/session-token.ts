import { createHash, randomBytes } from "node:crypto";

export const DEMO_SESSION_COOKIE = "et_demo_session";

/** Opaque cookie value length in bytes before hex encoding. */
export const DEMO_SESSION_TOKEN_BYTES = 32;

export function mintDemoSessionToken(): string {
  return randomBytes(DEMO_SESSION_TOKEN_BYTES).toString("hex");
}

/** Store only the hash; never persist the raw cookie value. */
export function hashDemoSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function mintSyntheticOwnerId(): string {
  return `demo_${randomBytes(16).toString("hex")}`;
}

export function mintFakeGoogleSubject(): string {
  return `demo-google-sub_${randomBytes(16).toString("hex")}`;
}

export const DEMO_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const DEMO_RESET_COPY =
  "Clear my demo data removes everything associated with your session. Other visitors cannot see your messages. This cannot be undone.";
