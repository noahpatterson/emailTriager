import { describe, expect, mock, test } from "bun:test";
import { encryptSecret } from "../server/security/crypto";

mock.module("server-only", () => ({}));

const { GoogleConnectionService } = await import("../server/oauth/google");

for (const [name, value] of Object.entries({
  DATABASE_URL: "postgresql://localhost/test",
  NEON_AUTH_BASE_URL: "https://auth.example.test",
  NEON_AUTH_COOKIE_SECRET: "cookie-secret",
  OWNER_NEON_AUTH_USER_ID: "owner",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_REDIRECT_URI: "http://localhost:3000/api/oauth/google/callback",
  TOKEN_ENCRYPTION_KEY_V1: "test-encryption-key",
}))
  process.env[name] = value;
delete process.env.INSECURE_LOCAL_DEV;

function createOAuthDatabase() {
  const state = {
    verifier: encryptSecret("verifier", process.env.TOKEN_ENCRYPTION_KEY_V1!),
    processingToken: null as string | null,
    consumed: false,
    googleSubject: null as string | null,
  };

  const db = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          const execute = (): unknown[] => {
            if (typeof values.processingToken === "string") {
              if (state.consumed || state.processingToken) return [];
              state.processingToken = values.processingToken;
              return [{ pkceVerifierCiphertext: state.verifier }];
            }
            if ("consumedAt" in values) {
              if (state.consumed || !state.processingToken) return [];
              state.consumed = true;
              state.processingToken = null;
              return [{ stateHash: "state-hash" }];
            }
            if (!state.consumed) state.processingToken = null;
            return [];
          };
          return {
            returning: async () => execute(),
            then: (resolve: (value: unknown[]) => unknown) =>
              Promise.resolve(execute()).then(resolve),
          };
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          state.googleSubject ??= String(values.googleSubject);
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            state.googleSubject ? [{ googleSubject: state.googleSubject }] : [],
        }),
      }),
    }),
  };

  return { db, state };
}

const tokenResponse = (): Response =>
  Response.json({
    access_token: "access-token",
    refresh_token: "refresh-token",
  });
const identityResponse = (): Response =>
  Response.json({ sub: "google-subject" });

describe("Google OAuth state lifecycle", () => {
  test("releases a claim after a transient provider failure so the callback can retry", async () => {
    const { db, state } = createOAuthDatabase();
    let tokenAttempts = 0;
    const fetcher = mock(async (input: RequestInfo | URL) => {
      if (String(input).includes("/token")) {
        tokenAttempts += 1;
        return tokenAttempts === 1
          ? new Response(null, { status: 503 })
          : tokenResponse();
      }
      return identityResponse();
    });
    const service = new GoogleConnectionService(
      db as never,
      fetcher as unknown as typeof fetch,
    );

    await expect(service.complete("owner", "code", "state")).rejects.toThrow(
      "Token exchange failed",
    );
    expect(state.processingToken).toBeNull();
    expect(state.consumed).toBe(false);

    await service.complete("owner", "code", "state");
    expect(state.consumed).toBe(true);
  });

  test("allows only one simultaneous callback to claim the state", async () => {
    const { db, state } = createOAuthDatabase();
    let releaseTokenResponse!: () => void;
    const tokenPending = new Promise<void>((resolve) => {
      releaseTokenResponse = resolve;
    });
    const fetcher = mock(async (input: RequestInfo | URL) => {
      if (String(input).includes("/token")) {
        await tokenPending;
        return tokenResponse();
      }
      return identityResponse();
    });
    const service = new GoogleConnectionService(
      db as never,
      fetcher as unknown as typeof fetch,
    );

    const first = service.complete("owner", "code", "state");
    while (!state.processingToken) await Bun.sleep(1);
    await expect(service.complete("owner", "code", "state")).rejects.toThrow(
      "Invalid OAuth state",
    );
    releaseTokenResponse();
    await first;
    expect(state.consumed).toBe(true);
  });

  test("consumes state only after successful persistence and rejects replay", async () => {
    const { db, state } = createOAuthDatabase();
    const fetcher = mock(async (input: RequestInfo | URL) =>
      String(input).includes("/token") ? tokenResponse() : identityResponse(),
    );
    const service = new GoogleConnectionService(
      db as never,
      fetcher as unknown as typeof fetch,
    );

    await service.complete("owner", "code", "state");
    expect(state.googleSubject).toBe("google-subject");
    expect(state.consumed).toBe(true);
    await expect(service.complete("owner", "code", "state")).rejects.toThrow(
      "Invalid OAuth state",
    );
  });
});
