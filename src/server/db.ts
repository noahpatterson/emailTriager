import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { getServerConfig } from "@/src/config/server";

function createNeonDatabase(url: string) {
  return drizzleNeon(neon(url), { schema });
}

function createPgDatabase(url: string) {
  return drizzlePg(new Pool({ connectionString: url }), { schema });
}

/** Neon HTTP is the narrower surface; pg is cast to this shared call-site type. */
export type Database = ReturnType<typeof createNeonDatabase>;

export function database(): Database {
  const config = getServerConfig();
  if (config.databaseDriver === "pg") {
    return createPgDatabase(config.databaseUrl) as unknown as Database;
  }
  return createNeonDatabase(config.databaseUrl);
}
