import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { oauthState } from "@/db/schema";

export const PROCESSING_LEASE_MS = 2 * 60 * 1000;

type OAuthStateDatabase = Pick<import("@/src/server/db").Database, "update">;

export async function claimOAuthState(
  db: OAuthStateDatabase,
  ownerId: string,
  stateHash: string,
  processingToken: string,
  now = new Date(),
): Promise<string | null> {
  const rows = await db
    .update(oauthState)
    .set({
      processingToken,
      processingExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
    })
    .where(
      and(
        eq(oauthState.stateHash, stateHash),
        eq(oauthState.ownerAuthUserId, ownerId),
        isNull(oauthState.consumedAt),
        gt(oauthState.expiresAt, now),
        or(
          isNull(oauthState.processingToken),
          isNull(oauthState.processingExpiresAt),
          lt(oauthState.processingExpiresAt, now),
        ),
      ),
    )
    .returning({ pkceVerifierCiphertext: oauthState.pkceVerifierCiphertext });
  return rows.length === 1 ? (rows[0].pkceVerifierCiphertext ?? null) : null;
}

export async function consumeOAuthState(
  db: OAuthStateDatabase,
  stateHash: string,
  processingToken: string,
): Promise<boolean> {
  const rows = await db
    .update(oauthState)
    .set({
      consumedAt: sql`now()`,
      processingToken: null,
      processingExpiresAt: null,
    })
    .where(
      and(
        eq(oauthState.stateHash, stateHash),
        eq(oauthState.processingToken, processingToken),
        isNull(oauthState.consumedAt),
      ),
    )
    .returning({ stateHash: oauthState.stateHash });
  return rows.length === 1;
}

export async function releaseOAuthState(
  db: OAuthStateDatabase,
  stateHash: string,
  processingToken: string,
): Promise<void> {
  await db
    .update(oauthState)
    .set({ processingToken: null, processingExpiresAt: null })
    .where(
      and(
        eq(oauthState.stateHash, stateHash),
        eq(oauthState.processingToken, processingToken),
        isNull(oauthState.consumedAt),
      ),
    );
}
