import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";
import { getServerConfig } from "@/src/config/server";

export type Database = ReturnType<typeof createDatabase>;

function createDatabase(url: string) {
  return drizzle(neon(url), { schema });
}

export function database(): Database {
  return createDatabase(getServerConfig().databaseUrl);
}
