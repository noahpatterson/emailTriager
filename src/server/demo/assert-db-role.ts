import "server-only";
import { withPgClient } from "@/src/server/db";

let asserted = false;

const DEMO_RLS_TABLES = [
  "owner_binding",
  "gmail_connection",
  "triage_config",
  "sync_run",
  "message_snapshot",
  "sync_lease",
  "oauth_state",
  "audit_run",
  "pending_demotion",
] as const;

/**
 * Public demo must not use a Neon/Postgres owner role (BYPASSRLS / superuser).
 * Isolation depends on FORCE RLS + emailtriager_app (NOBYPASSRLS).
 */
export async function assertDemoDatabaseRoleSafe(): Promise<void> {
  if (asserted) return;
  await withPgClient(async (client) => {
    const { rows } = await client.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls
       FROM pg_roles
       WHERE rolname = current_user`,
    );
    const role = rows[0];
    if (!role) throw new Error("Unable to resolve current database role");
    if (role.rolsuper || role.rolbypassrls) {
      throw new Error(
        `APP_PROFILE=demo refuses database role "${role.rolname}" because it bypasses RLS ` +
          `(super=${role.rolsuper}, bypassrls=${role.rolbypassrls}). ` +
          `Set DATABASE_URL to emailtriager_app (NOBYPASSRLS) after bun run db:migrate:demo. ` +
          `See README “Unlock public demo on Vercel”.`,
      );
    }
    if (role.rolname !== "emailtriager_app") {
      console.warn(
        `demo DB role is "${role.rolname}" (expected emailtriager_app); continuing because NOBYPASSRLS`,
      );
    }

    const { rows: tables } = await client.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      [DEMO_RLS_TABLES],
    );
    const byName = new Map(tables.map((row) => [row.relname, row]));
    for (const name of DEMO_RLS_TABLES) {
      const row = byName.get(name);
      if (!row) {
        throw new Error(
          `APP_PROFILE=demo requires table "${name}" after bun run db:migrate:demo (missing).`,
        );
      }
      if (!row.relrowsecurity || !row.relforcerowsecurity) {
        throw new Error(
          `APP_PROFILE=demo requires FORCE ROW LEVEL SECURITY on "${name}" ` +
            `(rowsecurity=${row.relrowsecurity}, force=${row.relforcerowsecurity}). ` +
            `Run bun run db:migrate:demo before opening the public demo.`,
        );
      }
    }

    const { rows: sessionTable } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'demo_session'
       ) AS exists`,
    );
    if (!sessionTable[0]?.exists) {
      throw new Error(
        "APP_PROFILE=demo requires demo_session (run bun run db:migrate:demo).",
      );
    }
  });
  asserted = true;
}

/** Test helper — reset memoization between cases. */
export function resetDemoDatabaseRoleAssertForTests(): void {
  asserted = false;
}
