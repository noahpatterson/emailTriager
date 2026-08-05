CREATE TYPE "public"."audit_status" AS ENUM('running', 'bounded_incomplete', 'completed', 'partial_failure', 'failed');--> statement-breakpoint
CREATE TABLE "prompt_version" (
	"id" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_auth_user_id" text NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"status" "audit_status" NOT NULL,
	"prompt_version_id" text NOT NULL,
	"model_provider" text NOT NULL,
	"model_name" text NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"total_eligible" integer DEFAULT 0 NOT NULL,
	"next_cursor" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"fence_token" bigint DEFAULT 0 NOT NULL,
	"error_summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "audit_run_owner_auth_user_id_owner_binding_auth_user_id_fk" FOREIGN KEY ("owner_auth_user_id") REFERENCES "public"."owner_binding"("auth_user_id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "audit_run_sync_run_id_sync_run_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_run"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "audit_run_prompt_version_id_prompt_version_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_version"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "verdict" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"audit_run_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"agrees_with_filing" boolean,
	"recommended_category" text,
	"rationale" text,
	"malformed" boolean DEFAULT false NOT NULL,
	"model_name" text NOT NULL,
	"model_provider" text NOT NULL,
	"prompt_version_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verdict_audit_run_id_gmail_message_id_unique" UNIQUE("audit_run_id","gmail_message_id"),
	CONSTRAINT "verdict_recommended_category_check" CHECK ("recommended_category" IS NULL OR "recommended_category" IN ('priority','review','new','archive')),
	CONSTRAINT "verdict_rationale_length_check" CHECK ("rationale" IS NULL OR char_length("rationale") <= 500),
	CONSTRAINT "verdict_audit_run_id_audit_run_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "public"."audit_run"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "verdict_prompt_version_id_prompt_version_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_version"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "audit_run_owner_started_idx" ON "audit_run" USING btree ("owner_auth_user_id","started_at" DESC);--> statement-breakpoint
CREATE INDEX "audit_run_sync_run_idx" ON "audit_run" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "verdict_audit_run_idx" ON "verdict" USING btree ("audit_run_id");
