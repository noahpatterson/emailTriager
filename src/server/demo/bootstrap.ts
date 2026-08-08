import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { gmailConnection, ownerBinding, triageConfig } from "@/db/schema";
import { demoSession } from "@/db/schema-demo";
import { getServerConfig } from "@/src/config/server";
import { EMPTY_CATEGORY_INTENT } from "@/src/server/config/triage-validate";
import { pgDatabase, withOwnerTransaction, withPgClient } from "@/src/server/db";
import {
  DEMO_SESSION_TTL_MS,
  hashDemoSessionToken,
  mintDemoSessionToken,
  mintFakeGoogleSubject,
  mintSyntheticOwnerId,
} from "@/src/server/demo/session-token";
import {
  DEMO_CORPUS_LABELS,
  DEMO_CORPUS_SOURCE_LABEL_ID,
  DEMO_CORPUS_TERMS,
} from "@/src/server/gmail/corpus";
import { encryptSecret } from "@/src/server/security/crypto";

export type DemoSessionRecord = Readonly<{
  token: string;
  ownerId: string;
  expiresAt: Date;
}>;

function labelId(name: string): string {
  const found = DEMO_CORPUS_LABELS.find((label) => label.name === name);
  if (!found) throw new Error(`Missing demo corpus label: ${name}`);
  return found.id;
}

/** Insert owner binding + fake Gmail connection + corpus triage config under RLS. */
export async function bootstrapDemoOwner(ownerId: string, googleSubject: string): Promise<void> {
  const config = getServerConfig();
  await withOwnerTransaction(ownerId, async (db, client) => {
    // Raw SQL: after demo migration, singleton column is gone; drizzle schema still describes prod.
    await client.query(
      `INSERT INTO owner_binding (auth_user_id) VALUES ($1)
       ON CONFLICT (auth_user_id) DO NOTHING`,
      [ownerId],
    );

    await db
      .insert(gmailConnection)
      .values({
        ownerAuthUserId: ownerId,
        googleSubject,
        encryptedRefreshToken: encryptSecret(`demo-refresh:${ownerId}`, config.tokenEncryptionKeyV1),
        keyVersion: 1,
        disconnectedAt: null,
      })
      .onConflictDoNothing();

    const [existingConfig] = await db
      .select({ id: triageConfig.id })
      .from(triageConfig)
      .where(eq(triageConfig.ownerAuthUserId, ownerId))
      .limit(1);
    if (!existingConfig) {
      await db.insert(triageConfig).values({
        ownerAuthUserId: ownerId,
        version: 1,
        sourceLabelId: DEMO_CORPUS_SOURCE_LABEL_ID,
        priorityLabelId: labelId("Triage/Priority"),
        reviewLabelId: labelId("Triage/Review"),
        newLabelId: labelId("Triage/New"),
        archiveLabelId: labelId("Triage/Archive"),
        terms: {
          priority: [...DEMO_CORPUS_TERMS.priority],
          review: [...DEMO_CORPUS_TERMS.review],
          new: [...DEMO_CORPUS_TERMS.new],
        },
        senderWhitelist: [],
        senderBlocklist: [],
        categoryIntent: {
          ...EMPTY_CATEGORY_INTENT,
          priority: "Urgent owner-facing work the demo corpus treats as priority.",
          review: "Needs a human decision; demo corpus review terms.",
          new: "First-contact style mail; demo corpus new terms.",
          archive: "Everything else that should leave the source label.",
        },
        autoApplyPromotions: false,
        bounds: { maxPages: 3, maxMessagesPerPage: 50, maxTotalMessages: 100 },
      });
    }
  });
}

export async function mintDemoSession(): Promise<DemoSessionRecord> {
  const token = mintDemoSessionToken();
  const tokenHash = hashDemoSessionToken(token);
  const ownerId = mintSyntheticOwnerId();
  const googleSubject = mintFakeGoogleSubject();
  const expiresAt = new Date(Date.now() + DEMO_SESSION_TTL_MS);

  await bootstrapDemoOwner(ownerId, googleSubject);

  const db = pgDatabase();
  await db.insert(demoSession).values({
    tokenHash,
    ownerAuthUserId: ownerId,
    expiresAt,
  });

  return { token, ownerId, expiresAt };
}

export async function resolveDemoSessionOwner(token: string): Promise<string | null> {
  const tokenHash = hashDemoSessionToken(token);
  const db = pgDatabase();
  const now = new Date();
  const [row] = await db
    .select({
      ownerAuthUserId: demoSession.ownerAuthUserId,
      expiresAt: demoSession.expiresAt,
    })
    .from(demoSession)
    .where(and(eq(demoSession.tokenHash, tokenHash), gt(demoSession.expiresAt, now)))
    .limit(1);
  return row?.ownerAuthUserId ?? null;
}

export async function clearDemoSessionData(ownerId: string, token: string): Promise<void> {
  const tokenHash = hashDemoSessionToken(token);
  await wipeDemoOwnerData(ownerId, { onlyTokenHash: tokenHash });
}

/** Delete all tenant rows for a synthetic demo owner (RLS-scoped). */
export async function wipeDemoOwnerData(
  ownerId: string,
  options?: { onlyTokenHash?: string },
): Promise<void> {
  const {
    syncRun,
    syncLease,
    goldenSetMessage,
    evalRun,
    auditRun,
    pendingDemotion,
    oauthState,
    messageSnapshot,
  } = await import("@/db/schema");

  await withOwnerTransaction(ownerId, async (db, client) => {
    if (options?.onlyTokenHash) {
      await db.delete(demoSession).where(eq(demoSession.tokenHash, options.onlyTokenHash));
    } else {
      await db.delete(demoSession).where(eq(demoSession.ownerAuthUserId, ownerId));
    }
    await db.delete(pendingDemotion).where(eq(pendingDemotion.ownerAuthUserId, ownerId));
    await client.query(
      `DELETE FROM verdict WHERE audit_run_id IN (SELECT id FROM audit_run WHERE owner_auth_user_id = $1)`,
      [ownerId],
    );
    await db.delete(auditRun).where(eq(auditRun.ownerAuthUserId, ownerId));
    await db.delete(evalRun).where(eq(evalRun.ownerAuthUserId, ownerId));
    await db.delete(goldenSetMessage).where(eq(goldenSetMessage.ownerAuthUserId, ownerId));
    await client.query(
      `DELETE FROM message_processing WHERE run_id IN (SELECT id FROM sync_run WHERE owner_auth_user_id = $1)`,
      [ownerId],
    );
    await db.delete(messageSnapshot).where(eq(messageSnapshot.ownerAuthUserId, ownerId));
    await db.delete(oauthState).where(eq(oauthState.ownerAuthUserId, ownerId));
    await db.delete(syncLease).where(eq(syncLease.ownerAuthUserId, ownerId));
    await db.delete(syncRun).where(eq(syncRun.ownerAuthUserId, ownerId));
    await client.query(
      `DELETE FROM gmail_message_state WHERE google_subject IN (
         SELECT google_subject FROM gmail_connection WHERE owner_auth_user_id = $1
       )`,
      [ownerId],
    );
    await db.delete(gmailConnection).where(eq(gmailConnection.ownerAuthUserId, ownerId));
    await db.delete(triageConfig).where(eq(triageConfig.ownerAuthUserId, ownerId));
    await client.query(`DELETE FROM owner_binding WHERE auth_user_id = $1`, [ownerId]);
  });
}

/**
 * Remove expired demo sessions and wipe their tenant rows.
 * Prefer running via `bun run demo:cleanup` with the Neon **owner** (migrate) URL so
 * orphan cleanup is not blocked if app-role RLS quirks appear; SET LOCAL still works
 * as emailtriager_app when the session rows are visible.
 */
export async function cleanupExpiredDemoTenants(
  now: Date = new Date(),
): Promise<{ sessionsDeleted: number; ownersCleared: number }> {
  const expired = await withPgClient(async (client) => {
    const { rows } = await client.query<{ owner_auth_user_id: string }>(
      `SELECT DISTINCT owner_auth_user_id FROM demo_session WHERE expires_at < $1`,
      [now.toISOString()],
    );
    return rows.map((row) => row.owner_auth_user_id);
  });

  let ownersCleared = 0;
  for (const ownerId of expired) {
    await wipeDemoOwnerData(ownerId);
    ownersCleared += 1;
  }

  // Prune old rate-limit hits (best-effort; table may be empty on fresh DBs).
  await withPgClient(async (client) => {
    await client.query(
      `DELETE FROM demo_rate_limit_hit WHERE hit_at < $1`,
      [new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()],
    );
  }).catch(() => {
    // Table missing before demo migrate — ignore.
  });

  return { sessionsDeleted: expired.length, ownersCleared };
}

/** @deprecated Prefer cleanupExpiredDemoTenants — session-only delete orphans tenant data. */
export async function deleteExpiredDemoSessions(now: Date = new Date()): Promise<number> {
  const result = await cleanupExpiredDemoTenants(now);
  return result.sessionsDeleted;
}

/** How many gmail_connection rows the given owner can see under RLS. */
export async function countVisibleConnectionsAs(ownerId: string): Promise<number> {
  return withOwnerTransaction(ownerId, async (db) => {
    const rows = await db.select({ ownerAuthUserId: gmailConnection.ownerAuthUserId }).from(gmailConnection);
    return rows.length;
  });
}

void ownerBinding;
