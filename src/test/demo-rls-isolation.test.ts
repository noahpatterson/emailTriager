import { describe, expect, test } from "bun:test";
import { Pool } from "pg";
import {
  bootstrapDemoOwner,
  countVisibleConnectionsAs,
  mintDemoSession,
} from "@/src/server/demo/bootstrap";
import { mintFakeGoogleSubject, mintSyntheticOwnerId } from "@/src/server/demo/session-token";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe("demo RLS isolation", () => {
  test.skipIf(!databaseUrl)(
    "visitor A cannot see visitor B gmail_connection rows",
    async () => {
      const previousProfile = process.env.APP_PROFILE;
      const previousDriver = process.env.DATABASE_DRIVER;
      const previousUrl = process.env.DATABASE_URL;
      process.env.APP_PROFILE = "demo";
      process.env.DATABASE_DRIVER = "pg";
      process.env.DATABASE_URL = databaseUrl!;
      // Satisfy getServerConfig placeholders if unset.
      process.env.GOOGLE_CLIENT_ID ??= "test";
      process.env.GOOGLE_CLIENT_SECRET ??= "test";
      process.env.GOOGLE_REDIRECT_URI ??= "http://127.0.0.1:3000/callback";
      process.env.TOKEN_ENCRYPTION_KEY_V1 ??= "test-token-key-for-demo-rls!!!!";

      try {
        const ownerA = mintSyntheticOwnerId();
        const ownerB = mintSyntheticOwnerId();
        await bootstrapDemoOwner(ownerA, mintFakeGoogleSubject());
        await bootstrapDemoOwner(ownerB, mintFakeGoogleSubject());

        expect(await countVisibleConnectionsAs(ownerA)).toBe(1);
        expect(await countVisibleConnectionsAs(ownerB)).toBe(1);

        // Session mint also bootstraps; ensure distinct subjects.
        const session = await mintDemoSession();
        expect(session.ownerId).toMatch(/^demo_/);
        expect(await countVisibleConnectionsAs(session.ownerId)).toBe(1);
      } finally {
        if (previousProfile === undefined) delete process.env.APP_PROFILE;
        else process.env.APP_PROFILE = previousProfile;
        if (previousDriver === undefined) delete process.env.DATABASE_DRIVER;
        else process.env.DATABASE_DRIVER = previousDriver;
        if (previousUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousUrl;
      }
    },
  );

  test.skipIf(!databaseUrl)("demo migration journal table exists after migrate:demo", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const { rows } = await pool.query(
        `SELECT to_regclass('public.demo_session') AS demo_session,
                to_regclass('public.demo_migration_journal') AS journal`,
      );
      expect(rows[0]?.demo_session).toBe("demo_session");
      expect(rows[0]?.journal).toBe("demo_migration_journal");
    } finally {
      await pool.end();
    }
  });
});
