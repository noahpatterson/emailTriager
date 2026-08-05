CREATE TYPE "public"."golden_set_partition" AS ENUM('exemplar', 'holdout');--> statement-breakpoint
CREATE TYPE "public"."eval_run_type" AS ENUM('matching', 'judge');--> statement-breakpoint
CREATE TABLE "golden_set_message" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_auth_user_id" text NOT NULL,
	"source_gmail_message_id" text,
	"fixture_id" text,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"owner_label" text NOT NULL,
	"partition" "golden_set_partition" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "golden_set_message_owner_label_check" CHECK ("owner_label" IN ('priority','review','new','archive')),
	CONSTRAINT "golden_set_message_owner_fixture_unique" UNIQUE("owner_auth_user_id","fixture_id"),
	CONSTRAINT "golden_set_message_owner_auth_user_id_owner_binding_auth_user_id_fk" FOREIGN KEY ("owner_auth_user_id") REFERENCES "public"."owner_binding"("auth_user_id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "eval_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_auth_user_id" text NOT NULL,
	"type" "eval_run_type" NOT NULL,
	"candidate" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_run_owner_auth_user_id_owner_binding_auth_user_id_fk" FOREIGN KEY ("owner_auth_user_id") REFERENCES "public"."owner_binding"("auth_user_id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "golden_set_message_owner_partition_idx" ON "golden_set_message" USING btree ("owner_auth_user_id","partition");--> statement-breakpoint
CREATE INDEX "eval_run_owner_started_idx" ON "eval_run" USING btree ("owner_auth_user_id","started_at" DESC);
