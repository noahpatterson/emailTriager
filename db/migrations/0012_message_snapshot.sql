CREATE TABLE "message_snapshot" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_auth_user_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_snapshot_key_version_check" CHECK ("key_version" > 0),
	CONSTRAINT "message_snapshot_run_id_gmail_message_id_unique" UNIQUE("run_id","gmail_message_id"),
	CONSTRAINT "message_snapshot_owner_auth_user_id_owner_binding_auth_user_id_fk" FOREIGN KEY ("owner_auth_user_id") REFERENCES "public"."owner_binding"("auth_user_id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "message_snapshot_run_id_sync_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sync_run"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "message_snapshot_created_idx" ON "message_snapshot" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "message_snapshot_owner_created_idx" ON "message_snapshot" USING btree ("owner_auth_user_id","created_at");
