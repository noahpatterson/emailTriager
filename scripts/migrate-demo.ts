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
} finally {
  client.release();
  await pool.end();
}
