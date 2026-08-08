import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED must be set for demo migrations");
}

/** Password for emailtriager_app (NOBYPASSRLS). Local Compose default; Neon public demo must set a strong secret. */
const appPassword = process.env.DEMO_APP_DB_PASSWORD?.trim() || "emailtriager";

const dir = path.join(process.cwd(), "db", "migrations-demo");
const files = (await readdir(dir))
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  throw new Error(`No demo migration SQL files in ${dir}`);
}

const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS demo_migration_journal (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    const { rows } = await client.query(
      "SELECT 1 FROM demo_migration_journal WHERE id = $1",
      [id],
    );
    if (rows.length > 0) {
      console.log(`skip demo migration ${id} (already applied)`);
      continue;
    }
    const sql = await readFile(path.join(dir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO demo_migration_journal (id) VALUES ($1)", [id]);
      await client.query("COMMIT");
      console.log(`applied demo migration ${id}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  // Always (re)assert role flags + password so Neon/public unlock can rotate DEMO_APP_DB_PASSWORD.
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'emailtriager_app') THEN
        CREATE ROLE emailtriager_app LOGIN NOSUPERUSER NOBYPASSRLS;
      END IF;
    END
    $$
  `);
  await client.query(`ALTER ROLE emailtriager_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD $1`, [
    appPassword,
  ]);
  await client.query(`
    GRANT USAGE ON SCHEMA public TO emailtriager_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO emailtriager_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO emailtriager_app;
  `);
  console.log("emailtriager_app role ready (NOBYPASSRLS); password from DEMO_APP_DB_PASSWORD");
} finally {
  client.release();
  await pool.end();
}
