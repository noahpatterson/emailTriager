import "server-only";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

/**
 * Bare `SET app.current_owner = …` (or `set_config(..., is_local => false)`)
 * without an enclosing transaction is forbidden on pooled Neon connections.
 * The setting persists on the server-side session and the next request that
 * reuses the connection inherits the previous visitor's identity — the exact
 * cross-tenant leak RLS was chosen to prevent (ADR-0006, R-1).
 *
 * Always use `SET LOCAL` / `set_config(name, value, true)` inside `BEGIN`…`COMMIT`.
 */
export const FORBIDDEN_BARE_SET_NOTE =
  "Bare SET of app.current_owner without a transaction is forbidden; use SET LOCAL inside BEGIN…COMMIT so pooled connections cannot leak the previous visitor's identity.";

export type SetLocalProbeResult = Readonly<{
  ownerARows: string[];
  ownerBRows: string[];
  /** Must be empty after COMMIT — proves SET LOCAL did not stick on the connection. */
  settingAfterCommit: string;
  /** True when bare SET survives COMMIT on the same connection (why bare SET is forbidden). */
  bareSetLeakedAfterCommit: boolean;
}>;

async function withClient<T>(
  connectionString: string,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Executable R-1 probe: on one pooled connection, `SET LOCAL` for owner A then
 * owner B must not cross-read policy-gated rows, and the GUC must clear after COMMIT.
 * Also proves bare `SET` (is_local=false) leaks across COMMIT on the same connection.
 *
 * Neon project owner roles inherit `neon_superuser` → `BYPASSRLS`, so policies never
 * fire on the Terraform `DATABASE_URL` role. The probe seeds as that role, then
 * `SET ROLE` to a temporary SQL-created `NOBYPASSRLS` role for the isolation asserts.
 */
export async function probeSetLocalOwnerScoping(
  connectionString: string,
): Promise<SetLocalProbeResult> {
  return withClient(connectionString, async (client) => {
    const suffix = randomUUID().replaceAll("-", "");
    const table = `rls_probe_${suffix}`;
    const probeRole = `rls_probe_role_${suffix.slice(0, 12)}`;

    try {
      await client.query(`
        CREATE TABLE ${table} (
          owner_id text NOT NULL,
          payload text NOT NULL
        )
      `);
      await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await client.query(`
        CREATE POLICY owner_isolation ON ${table}
        USING (owner_id = current_setting('app.current_owner', true))
      `);
      // Seed while still BYPASSRLS (Neon owner); inserts would otherwise need the GUC.
      await client.query(
        `INSERT INTO ${table} (owner_id, payload) VALUES ($1, $2)`,
        ["A", "a-only"],
      );
      await client.query(
        `INSERT INTO ${table} (owner_id, payload) VALUES ($1, $2)`,
        ["B", "b-only"],
      );

      // SQL-created roles do not inherit neon_superuser / BYPASSRLS.
      await client.query(`CREATE ROLE ${probeRole} NOBYPASSRLS`);
      await client.query(`GRANT ${probeRole} TO CURRENT_USER`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${probeRole}`);
      await client.query(`GRANT SELECT ON ${table} TO ${probeRole}`);
      await client.query(`SET ROLE ${probeRole}`);

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_owner', $1, true)", ["A"]);
      const ownerA = await client.query<{ payload: string }>(
        `SELECT payload FROM ${table} ORDER BY payload`,
      );
      await client.query("COMMIT");

      const afterLocalCommit = await client.query<{ value: string | null }>(
        "SELECT current_setting('app.current_owner', true) AS value",
      );

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_owner', $1, true)", ["B"]);
      const ownerB = await client.query<{ payload: string }>(
        `SELECT payload FROM ${table} ORDER BY payload`,
      );
      await client.query("COMMIT");

      await client.query("RESET ROLE");

      // Control case: bare SET (is_local=false) must leak past COMMIT — forbidden in app code.
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_owner', $1, false)", [
        "LEAK",
      ]);
      await client.query("COMMIT");
      const afterBareSet = await client.query<{ value: string | null }>(
        "SELECT current_setting('app.current_owner', true) AS value",
      );
      await client.query("SELECT set_config('app.current_owner', $1, false)", [""]);

      return {
        ownerARows: ownerA.rows.map((row) => row.payload),
        ownerBRows: ownerB.rows.map((row) => row.payload),
        settingAfterCommit: afterLocalCommit.rows[0]?.value ?? "",
        bareSetLeakedAfterCommit: afterBareSet.rows[0]?.value === "LEAK",
      };
    } finally {
      try {
        await client.query("RESET ROLE");
      } catch {
        // best-effort
      }
      try {
        await client.query(`DROP TABLE IF EXISTS ${table}`);
      } catch {
        // best-effort cleanup
      }
      try {
        await client.query(`DROP ROLE IF EXISTS ${probeRole}`);
      } catch {
        // best-effort cleanup
      }
    }
  });
}
