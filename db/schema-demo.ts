/**
 * Demo-only tables. Present in TypeScript for the demo profile; created only by
 * `db/migrations-demo/` (never by production `db:migrate`).
 */
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ownerBinding } from "@/db/schema";

export const demoSession = pgTable(
  "demo_session",
  {
    tokenHash: text("token_hash").primaryKey(),
    ownerAuthUserId: text("owner_auth_user_id")
      .notNull()
      .references(() => ownerBinding.authUserId),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("demo_session_owner_idx").on(table.ownerAuthUserId),
    index("demo_session_expires_idx").on(table.expiresAt),
  ],
);
