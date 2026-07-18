import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const syncStatusEnum = pgEnum("sync_status", [
  "running",
  "bounded_incomplete",
  "completed",
  "partial_failure",
  "failed",
]);

export const ownerBinding = pgTable(
  "owner_binding",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    authUserId: text("auth_user_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("owner_binding_singleton_check", sql`${table.singleton}`)],
);

export const gmailConnection = pgTable(
  "gmail_connection",
  {
    ownerAuthUserId: text("owner_auth_user_id")
      .primaryKey()
      .references(() => ownerBinding.authUserId),
    googleSubject: text("google_subject").notNull().unique(),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    keyVersion: integer("key_version").notNull(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("gmail_connection_key_version_check", sql`${table.keyVersion} > 0`),
  ],
);

export const triageConfig = pgTable(
  "triage_config",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ownerAuthUserId: text("owner_auth_user_id")
      .notNull()
      .references(() => ownerBinding.authUserId),
    version: integer("version").notNull(),
    sourceLabelId: text("source_label_id").notNull(),
    priorityLabelId: text("priority_label_id").notNull(),
    reviewLabelId: text("review_label_id").notNull(),
    contestLabelId: text("contest_label_id").notNull(),
    contestArchiveLabelId: text("contest_archive_label_id").notNull(),
    terms: jsonb("terms").notNull(),
    senderWhitelist: jsonb("sender_whitelist").notNull(),
    senderBlocklist: jsonb("sender_blocklist").notNull().default([]),
    bounds: jsonb("bounds").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("triage_config_version_check", sql`${table.version} > 0`),
    unique("triage_config_owner_auth_user_id_version_unique").on(
      table.ownerAuthUserId,
      table.version,
    ),
  ],
);

export const syncRun = pgTable(
  "sync_run",
  {
    id: uuid("id").primaryKey(),
    ownerAuthUserId: text("owner_auth_user_id")
      .notNull()
      .references(() => ownerBinding.authUserId),
    configVersion: integer("config_version").notNull(),
    status: syncStatusEnum("status").notNull(),
    trial: boolean("trial").notNull().default(false),
    nextPageToken: text("next_page_token"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    fenceToken: bigint("fence_token", { mode: "number" }).notNull().default(0),
    errorSummary: text("error_summary"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("sync_run_owner_started_idx").on(table.ownerAuthUserId, table.startedAt.desc()),
  ],
);

export const syncLease = pgTable("sync_lease", {
  ownerAuthUserId: text("owner_auth_user_id")
    .primaryKey()
    .references(() => ownerBinding.authUserId),
  leaseOwner: uuid("lease_owner").notNull(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  fenceToken: bigint("fence_token", { mode: "number" }).notNull().default(1),
});

export const messageProcessing = pgTable(
  "message_processing",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => syncRun.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id"),
    internalDate: timestamp("internal_date", { withTimezone: true }),
    senderAddress: text("sender_address"),
    subject: text("subject"),
    labelIds: jsonb("label_ids"),
    outcome: text("outcome"),
    errorCode: text("error_code"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.gmailMessageId] }),
    check(
      "message_processing_outcome_check",
      sql`${table.outcome} IN ('priority','review','new_contest','unmatched','protected','failed','blocked')`,
    ),
  ],
);

export const oauthState = pgTable("oauth_state", {
  stateHash: text("state_hash").primaryKey(),
  ownerAuthUserId: text("owner_auth_user_id").notNull(),
  pkceVerifierCiphertext: text("pkce_verifier_ciphertext"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});
