import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { ownerDatabaseUrl, readPersonalEnvironment } from "./personal-operations";

let pool: Pool | undefined;
try {
  const args = process.argv.slice(2);
  if (args.includes("--remote")) throw new Error("Invalid arguments");
  const env = await readPersonalEnvironment(args);
  pool = new Pool({ connectionString: ownerDatabaseUrl(env), max: 1, connectionTimeoutMillis: 10000 });
  await migrate(drizzle(pool), { migrationsFolder: "db/migrations" });
  console.log(JSON.stringify({ migrationsApplied: true }));
} catch {
  console.error(JSON.stringify({ migrationsApplied: false }));
  process.exitCode = 1;
} finally { await pool?.end(); }
