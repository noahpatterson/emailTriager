/**
 * Wipe expired demo visitors (sessions + tenant rows) and prune rate-limit hits.
 *
 * Use the Neon **owner / migrate** connection (BYPASSRLS) via DATABASE_URL_UNPOOLED
 * so cleanup is reliable. Safe on demo DBs only — do not point at a real single-owner prod DB.
 *
 *   DATABASE_URL_UNPOOLED=postgresql://email_triager_owner:…@…/email_triager?sslmode=require
 *   bun run demo:cleanup
 */
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set for demo cleanup");
}

const pool = new Pool({ connectionString: url });
const client = await pool.connect();
const now = new Date();

try {
  const { rows: expired } = await client.query<{ owner_auth_user_id: string }>(
    `SELECT DISTINCT owner_auth_user_id FROM demo_session WHERE expires_at < $1`,
    [now.toISOString()],
  );

  let ownersCleared = 0;
  for (const { owner_auth_user_id: ownerId } of expired) {
    await client.query("BEGIN");
    try {
      await client.query(`DELETE FROM demo_session WHERE owner_auth_user_id = $1`, [ownerId]);
      await client.query(`DELETE FROM pending_demotion WHERE owner_auth_user_id = $1`, [ownerId]);
      await client.query(`DELETE FROM verdict WHERE audit_run_id IN (SELECT id FROM audit_run WHERE owner_auth_user_id = $1)`, [
        ownerId,
      ]);
      await client.query(`DELETE FROM audit_run WHERE owner_auth_user_id = $1`, [ownerId]);
      await client.query(`DELETE FROM eval_run WHERE owner_auth_user_id = $1`, [ownerId]);
      await client.query(`DELETE FROM golden_set_message WHERE owner_auth_user_id = $1`, [ownerId]);
      await client.query(
        `DELETE FROM message_processing WHERE run_id IN (SELECT id FROM sync_run WHERE owner_auth_user_id = $1)`,
        [ownerId],
      );
      await client.query(`DELETE FROM message_snapshot WHERE owner_auth_user_id = $1`, [ownerId]);
      await client.query(`DELETE FROM oauth_state WHERE owner_auth_user_id = $1`, [ownerId]);
      await client.query(`DELETE FROM sync_lease WHERE owner_auth_user_id = $1`, [ownerId]);
      await client.query(`DELETE FROM sync_run WHERE owner_auth_user_id = $1`, [ownerId]);
      await client.query(
        `DELETE FROM gmail_message_state WHERE google_subject IN (
           SELECT google_subject FROM gmail_connection WHERE owner_auth_user_id = $1
         )`,
        [ownerId],
      );
      await client.query(`DELETE FROM gmail_connection WHERE owner_auth_user_id = $1`, [ownerId]);
      await client.query(`DELETE FROM triage_config WHERE owner_auth_user_id = $1`, [ownerId]);
      await client.query(`DELETE FROM owner_binding WHERE auth_user_id = $1`, [ownerId]);
      await client.query("COMMIT");
      ownersCleared += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  await client.query(`DELETE FROM demo_rate_limit_hit WHERE hit_at < $1`, [
    new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
  ]);

  console.log(
    JSON.stringify({
      sessionsDeleted: expired.length,
      ownersCleared,
    }),
  );
} finally {
  client.release();
  await pool.end();
}
