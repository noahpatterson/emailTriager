import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "@/db/schema";
import * as demoSchema from "@/db/schema-demo";
import { getServerConfig } from "@/src/config/server";
import { isDemoProfile } from "@/src/server/demo/ai-gate";

function createNeonDatabase(url: string) {
  return drizzleNeon(neon(url), { schema });
}

const pgSchema = { ...schema, ...demoSchema };

function createPgDatabase(poolOrClient: Pool | PoolClient) {
  return drizzlePg(poolOrClient, { schema: pgSchema });
}

/** Neon HTTP is the narrower surface; pg is cast to this shared call-site type. */
export type Database = ReturnType<typeof createNeonDatabase>;

export type PgDatabase = ReturnType<typeof createPgDatabase>;

type DemoDbStore = Readonly<{ ownerId: string; db: PgDatabase; client: PoolClient }>;

const demoDbAls = new AsyncLocalStorage<DemoDbStore>();

let sharedPgPool: Pool | undefined;

export function getPgPool(connectionString?: string): Pool {
  const url = connectionString ?? getServerConfig().databaseUrl;
  if (!sharedPgPool) {
    sharedPgPool = new Pool({ connectionString: url });
  }
  return sharedPgPool;
}

export function database(): Database {
  if (isDemoProfile()) {
    const store = demoDbAls.getStore();
    if (!store) {
      throw new Error("demo database() requires withDemoOwnerScope");
    }
    return store.db as unknown as Database;
  }
  const config = getServerConfig();
  if (config.databaseDriver === "pg") {
    return createPgDatabase(getPgPool(config.databaseUrl)) as unknown as Database;
  }
  return createNeonDatabase(config.databaseUrl);
}

export function pgDatabase(): PgDatabase {
  const config = getServerConfig();
  if (config.databaseDriver !== "pg") {
    throw new Error("pgDatabase requires DATABASE_DRIVER=pg");
  }
  const store = demoDbAls.getStore();
  if (store) return store.db;
  return createPgDatabase(getPgPool(config.databaseUrl));
}

/**
 * Run work inside BEGIN…SET LOCAL app.current_owner…COMMIT.
 * Required for demo RLS (ADR-0006). Forbidden bare SET is documented on the probe.
 */
export async function withOwnerTransaction<T>(
  ownerId: string,
  run: (db: PgDatabase, client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPgPool();
  const client = await pool.connect();
  const db = createPgDatabase(client);
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_owner', $1, true)", [ownerId]);
    const result = await run(db, client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Demo request scope: nested `database()` calls reuse this transaction + SET LOCAL. */
export async function withDemoOwnerScope<T>(ownerId: string, run: () => Promise<T>): Promise<T> {
  if (!isDemoProfile()) return run();
  const { assertDemoDatabaseRoleSafe } = await import("@/src/server/demo/assert-db-role");
  await assertDemoDatabaseRoleSafe();
  return withOwnerTransaction(ownerId, async (db, client) => {
    return demoDbAls.run({ ownerId, db, client }, run);
  });
}

/** Session lookup / mint before owner GUC is known — no SET LOCAL. */
export async function withPgClient<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPgPool().connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

export async function setLocalOwner(client: PoolClient, ownerId: string): Promise<void> {
  await client.query("SELECT set_config('app.current_owner', $1, true)", [ownerId]);
}

export { sql };
