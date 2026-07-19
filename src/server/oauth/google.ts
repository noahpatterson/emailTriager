import "server-only";
import { eq, sql } from "drizzle-orm";
import { gmailConnection, oauthState, ownerBinding } from "@/db/schema";
import { getServerConfig } from "@/src/config/server";
import { database, type Database } from "@/src/server/db";
import {
  encryptSecret,
  randomBase64Url,
  sha256Base64Url,
} from "@/src/server/security/crypto";
import {
  claimOAuthState,
  consumeOAuthState,
  releaseOAuthState,
} from "@/src/server/oauth/state-lease";
import { fetchWithRetry } from "@/src/server/http/fetch-with-retry";

const SCOPE = "openid https://www.googleapis.com/auth/gmail.modify";
const STATE_LIFETIME_MS = 10 * 60 * 1000;

type GoogleTokens = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
};

export class GoogleConnectionService {
  constructor(
    private readonly db: Database = database(),
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** Ensures the singleton owner_binding row exists for this owner (FK target for gmail_connection). */
  async ensureOwnerBinding(ownerId: string): Promise<void> {
    const [existing] = await this.db
      .select({ authUserId: ownerBinding.authUserId })
      .from(ownerBinding)
      .limit(1);
    if (!existing) {
      await this.db.insert(ownerBinding).values({ authUserId: ownerId });
      return;
    }
    if (existing.authUserId !== ownerId) {
      throw new Error("Owner binding mismatch");
    }
  }

  async begin(ownerId: string): Promise<{ authorizationUrl: string }> {
    const config = getServerConfig();
    await this.ensureOwnerBinding(ownerId);
    const state = randomBase64Url();
    const verifier = randomBase64Url(48);
    await this.db.insert(oauthState).values({
      stateHash: sha256Base64Url(state),
      ownerAuthUserId: ownerId,
      pkceVerifierCiphertext: encryptSecret(
        verifier,
        config.tokenEncryptionKeyV1,
      ),
      expiresAt: new Date(Date.now() + STATE_LIFETIME_MS),
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: config.googleRedirectUri,
      response_type: "code",
      scope: SCOPE,
      state,
      code_challenge: sha256Base64Url(verifier),
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    }).toString();
    return { authorizationUrl: url.toString() };
  }

  async complete(ownerId: string, code: string, state: string): Promise<void> {
    if (!code || !state) throw new Error("Missing callback parameters");
    const config = getServerConfig();
    const stateHash = sha256Base64Url(state);
    const processingToken = randomBase64Url();
    const pkceVerifierCiphertext = await claimOAuthState(
      this.db,
      ownerId,
      stateHash,
      processingToken,
    );
    if (!pkceVerifierCiphertext) throw new Error("Invalid OAuth state");
    let connectionPersisted = false;
    try {
      const { decryptSecret } = await import("@/src/server/security/crypto");
      const response = await fetchWithRetry(
        this.fetcher,
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: config.googleClientId,
            client_secret: config.googleClientSecret,
            redirect_uri: config.googleRedirectUri,
            grant_type: "authorization_code",
            code_verifier: decryptSecret(
              pkceVerifierCiphertext,
              config.tokenEncryptionKeyV1,
            ),
          }),
        },
      );
      if (!response.ok) throw new Error("Token exchange failed");
      const tokens = (await response.json()) as GoogleTokens;
      if (!tokens.refresh_token || !tokens.access_token)
        throw new Error("Provider response incomplete");
      const identityResponse = await fetchWithRetry(
        this.fetcher,
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        },
      );
      if (!identityResponse.ok) throw new Error("Identity verification failed");
      const identity = (await identityResponse.json()) as { sub?: unknown };
      if (typeof identity.sub !== "string")
        throw new Error("Identity verification failed");
      const subject = identity.sub;
      const encrypted = encryptSecret(
        tokens.refresh_token,
        config.tokenEncryptionKeyV1,
      );
      await this.db
        .insert(gmailConnection)
        .values({
          ownerAuthUserId: ownerId,
          googleSubject: subject,
          encryptedRefreshToken: encrypted,
          keyVersion: 1,
          disconnectedAt: null,
        })
        .onConflictDoUpdate({
          target: gmailConnection.ownerAuthUserId,
          set: {
            encryptedRefreshToken: sql`CASE WHEN ${gmailConnection.googleSubject} = ${subject} THEN ${encrypted} ELSE ${gmailConnection.encryptedRefreshToken} END`,
            disconnectedAt: sql`CASE WHEN ${gmailConnection.googleSubject} = ${subject} THEN NULL ELSE ${gmailConnection.disconnectedAt} END`,
            updatedAt: sql`now()`,
          },
        });
      const [connected] = await this.db
        .select({ googleSubject: gmailConnection.googleSubject })
        .from(gmailConnection)
        .where(eq(gmailConnection.ownerAuthUserId, ownerId))
        .limit(1);
      if (connected?.googleSubject !== subject)
        throw new Error("Different Gmail account requires reset");
      connectionPersisted = true;
      if (!(await consumeOAuthState(this.db, stateHash, processingToken))) {
        throw new Error("OAuth state lease expired");
      }
    } catch (error) {
      // After the connection row is written, keep the lease so another callback
      // cannot reclaim unconsumed state. Transient pre-persist failures release.
      if (!connectionPersisted) {
        await releaseOAuthState(this.db, stateHash, processingToken);
      }
      throw error;
    }
  }
}
