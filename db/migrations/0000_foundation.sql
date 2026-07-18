CREATE TYPE "public"."sync_status" AS ENUM('running', 'bounded_incomplete', 'completed', 'partial_failure', 'failed');--> statement-breakpoint
CREATE TABLE "gmail_connection" (
	"owner_auth_user_id" text PRIMARY KEY NOT NULL,
	"google_subject" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"key_version" integer NOT NULL,
	"disconnected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_connection_google_subject_unique" UNIQUE("google_subject"),
	CONSTRAINT "gmail_connection_key_version_check" CHECK ("gmail_connection"."key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "message_processing" (
	"run_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text,
	"internal_date" timestamp with time zone,
	"sender_address" text,
	"subject" text,
	"label_ids" jsonb,
	"outcome" text,
	"error_code" text,
	"processed_at" timestamp with time zone,
	CONSTRAINT "message_processing_run_id_gmail_message_id_pk" PRIMARY KEY("run_id","gmail_message_id"),
	CONSTRAINT "message_processing_outcome_check" CHECK ("message_processing"."outcome" IN ('priority','review','new_contest','unmatched','protected','failed'))
);
--> statement-breakpoint
CREATE TABLE "oauth_state" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"owner_auth_user_id" text NOT NULL,
	"pkce_verifier_ciphertext" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "owner_binding" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"auth_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_binding_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "owner_binding_singleton_check" CHECK ("owner_binding"."singleton")
);
--> statement-breakpoint
CREATE TABLE "sync_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_auth_user_id" text NOT NULL,
	"config_version" integer NOT NULL,
	"status" "sync_status" NOT NULL,
	"next_page_token" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"fence_token" bigint DEFAULT 0 NOT NULL,
	"error_summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "triage_config" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_auth_user_id" text NOT NULL,
	"version" integer NOT NULL,
	"source_label_id" text NOT NULL,
	"priority_label_id" text NOT NULL,
	"review_label_id" text NOT NULL,
	"contest_label_id" text NOT NULL,
	"terms" jsonb NOT NULL,
	"sender_whitelist" jsonb NOT NULL,
	"bounds" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_config_owner_auth_user_id_version_unique" UNIQUE("owner_auth_user_id","version"),
	CONSTRAINT "triage_config_version_check" CHECK ("triage_config"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "gmail_connection" ADD CONSTRAINT "gmail_connection_owner_auth_user_id_owner_binding_auth_user_id_fk" FOREIGN KEY ("owner_auth_user_id") REFERENCES "public"."owner_binding"("auth_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_processing" ADD CONSTRAINT "message_processing_run_id_sync_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sync_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_owner_auth_user_id_owner_binding_auth_user_id_fk" FOREIGN KEY ("owner_auth_user_id") REFERENCES "public"."owner_binding"("auth_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_config" ADD CONSTRAINT "triage_config_owner_auth_user_id_owner_binding_auth_user_id_fk" FOREIGN KEY ("owner_auth_user_id") REFERENCES "public"."owner_binding"("auth_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_run_owner_started_idx" ON "sync_run" USING btree ("owner_auth_user_id","started_at" DESC NULLS LAST);