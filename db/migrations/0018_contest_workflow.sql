CREATE TABLE "contest_settings" (
 "owner_auth_user_id" text PRIMARY KEY REFERENCES "owner_binding"("auth_user_id"),
 "google_subject" text NOT NULL,
 "labels" jsonb NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contest_scan_run" (
 "id" uuid PRIMARY KEY,
 "owner_auth_user_id" text NOT NULL REFERENCES "owner_binding"("auth_user_id"),
 "google_subject" text NOT NULL,
 "status" "sync_status" NOT NULL,
 "trial" boolean NOT NULL,
 "scanned" integer DEFAULT 0 NOT NULL,
 "candidates" integer DEFAULT 0 NOT NULL,
 "classified" integer DEFAULT 0 NOT NULL,
 "skipped" integer DEFAULT 0 NOT NULL,
 "failed" integer DEFAULT 0 NOT NULL,
 "input_tokens" integer DEFAULT 0 NOT NULL,
 "output_tokens" integer DEFAULT 0 NOT NULL,
 "estimated_cost_usd" double precision,
 "next_page_token" text,
 "error_code" text,
 "started_at" timestamp with time zone DEFAULT now() NOT NULL,
 "finished_at" timestamp with time zone,
 CONSTRAINT "contest_run_cost_check" CHECK ("estimated_cost_usd" IS NULL OR ("estimated_cost_usd" >= 0 AND "estimated_cost_usd" < 'Infinity'::double precision))
);
--> statement-breakpoint
CREATE TABLE "contest_message" (
 "owner_auth_user_id" text NOT NULL REFERENCES "owner_binding"("auth_user_id"),
 "google_subject" text NOT NULL,
 "gmail_message_id" text NOT NULL,
 "gmail_thread_id" text,
 "sender" text NOT NULL,
 "subject" text NOT NULL,
 "category" text NOT NULL,
 "manual_category" text,
 "explicit_win_probability" double precision NOT NULL,
 "claim_action_probability" double precision NOT NULL,
 "confidence" double precision NOT NULL,
 "claim_deadline" text,
 "model" text NOT NULL,
 "prompt_version" text NOT NULL,
 "input_tokens" integer NOT NULL,
 "output_tokens" integer NOT NULL,
 "label_status" text DEFAULT 'pending' NOT NULL,
 "label_snapshot" jsonb NOT NULL,
 "notification_status" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 PRIMARY KEY ("google_subject","gmail_message_id"),
 CONSTRAINT "contest_category_check" CHECK ("category" IN ('winner','new_contest','entry_confirmation','notification_update','irrelevant')),
 CONSTRAINT "contest_manual_category_check" CHECK ("manual_category" IS NULL OR "manual_category" IN ('winner','new_contest','entry_confirmation','notification_update','irrelevant')),
 CONSTRAINT "contest_label_status_check" CHECK ("label_status" IN ('pending','applied','protected')),
 CONSTRAINT "contest_notification_status_check" CHECK ("notification_status" IS NULL OR "notification_status" IN ('reserved','sent','failed','uncertain')),
 CONSTRAINT "contest_probability_check" CHECK ("explicit_win_probability" >= 0 AND "explicit_win_probability" <= 1 AND "claim_action_probability" >= 0 AND "claim_action_probability" <= 1 AND "confidence" >= 0 AND "confidence" <= 1),
 CONSTRAINT "contest_claim_deadline_check" CHECK ("claim_deadline" IS NULL OR char_length("claim_deadline") <= 120),
 CONSTRAINT "contest_usage_check" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0)
);
--> statement-breakpoint
CREATE INDEX "contest_run_owner_started_idx" ON "contest_scan_run" ("owner_auth_user_id","started_at" DESC);
--> statement-breakpoint
CREATE INDEX "contest_message_owner_updated_idx" ON "contest_message" ("owner_auth_user_id","updated_at" DESC);
