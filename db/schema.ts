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
    gmailMessageLinkRoot: text("gmail_message_link_root")
      .notNull()
      .default("https://mail.google.com/mail/u/0/"),
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
    newLabelId: text("new_label_id").notNull(),
    archiveLabelId: text("archive_label_id").notNull(),
    terms: jsonb("terms").notNull(),
    senderWhitelist: jsonb("sender_whitelist").notNull(),
    senderBlocklist: jsonb("sender_blocklist").notNull().default([]),
    // No DB/schema default after migration backfill — writers must supply categoryIntent.
    categoryIntent: jsonb("category_intent").notNull(),
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
    // Retained for expand/contract rollback compatibility; new writes omit labelIds.
    labelIds: jsonb("label_ids"),
    outcome: text("outcome"),
    outcomeReason: text("outcome_reason"),
    errorCode: text("error_code"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.gmailMessageId] }),
    check(
      "message_processing_outcome_check",
      sql`${table.outcome} IN ('priority','review','new','unmatched','protected','failed','blocked')`,
    ),
  ],
);

export const gmailMessageState = pgTable(
  "gmail_message_state",
  {
    googleSubject: text("google_subject").notNull(),
    gmailMessageId: text("gmail_message_id").notNull(),
    latestRunId: uuid("latest_run_id")
      .references(() => syncRun.id, { onDelete: "set null" }),
    configVersion: integer("config_version").notNull(),
    outcome: text("outcome").notNull(),
    processingStatus: text("processing_status").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.googleSubject, table.gmailMessageId] }),
    check(
      "gmail_message_state_outcome_check",
      sql`${table.outcome} IN ('priority','review','new','unmatched','protected','failed','blocked')`,
    ),
    check(
      "gmail_message_state_processing_status_check",
      sql`${table.processingStatus} IN ('pending','processed','failed')`,
    ),
    index("gmail_message_state_updated_idx").on(table.updatedAt),
  ],
);

export const oauthState = pgTable("oauth_state", {
  stateHash: text("state_hash").primaryKey(),
  ownerAuthUserId: text("owner_auth_user_id").notNull(),
  pkceVerifierCiphertext: text("pkce_verifier_ciphertext"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  processingToken: text("processing_token"),
  processingExpiresAt: timestamp("processing_expires_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

/** Encrypted parsed message text for audit/eval replay. Never stores the match corpus. */
export const messageSnapshot = pgTable(
  "message_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ownerAuthUserId: text("owner_auth_user_id")
      .notNull()
      .references(() => ownerBinding.authUserId),
    runId: uuid("run_id")
      .notNull()
      .references(() => syncRun.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    keyVersion: integer("key_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("message_snapshot_key_version_check", sql`${table.keyVersion} > 0`),
    unique("message_snapshot_run_id_gmail_message_id_unique").on(
      table.runId,
      table.gmailMessageId,
    ),
    index("message_snapshot_created_idx").on(table.createdAt),
    index("message_snapshot_owner_created_idx").on(
      table.ownerAuthUserId,
      table.createdAt,
    ),
  ],
);

export const goldenSetPartitionEnum = pgEnum("golden_set_partition", [
  "exemplar",
  "holdout",
]);

export const evalRunTypeEnum = pgEnum("eval_run_type", ["matching", "judge"]);

/**
 * Frozen owner-labeled message text for eval. Owns its evidence (ADR-0012);
 * not subject to snapshot retention.
 */
export const goldenSetMessage = pgTable(
  "golden_set_message",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ownerAuthUserId: text("owner_auth_user_id")
      .notNull()
      .references(() => ownerBinding.authUserId),
    /** Nullable: corpus fixtures have no live Gmail id; production labels may. */
    sourceGmailMessageId: text("source_gmail_message_id"),
    /** Stable fixture id when seeded from the adversarial corpus. */
    fixtureId: text("fixture_id"),
    fromAddress: text("from_address").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    ownerLabel: text("owner_label").notNull(),
    partition: goldenSetPartitionEnum("partition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "golden_set_message_owner_label_check",
      sql`${table.ownerLabel} IN ('priority','review','new','archive')`,
    ),
    unique("golden_set_message_owner_fixture_unique").on(
      table.ownerAuthUserId,
      table.fixtureId,
    ),
    index("golden_set_message_owner_partition_idx").on(
      table.ownerAuthUserId,
      table.partition,
    ),
  ],
);

/** One scoring pass over holdout for a candidate (matching terms or judge config). */
export const evalRun = pgTable(
  "eval_run",
  {
    id: uuid("id").primaryKey(),
    ownerAuthUserId: text("owner_auth_user_id")
      .notNull()
      .references(() => ownerBinding.authUserId),
    type: evalRunTypeEnum("type").notNull(),
    /** Candidate under test — e.g. term lists for matching. */
    candidate: jsonb("candidate").notNull(),
    metrics: jsonb("metrics").notNull(),
    tags: jsonb("tags").notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("eval_run_owner_started_idx").on(table.ownerAuthUserId, table.startedAt.desc()),
  ],
);
