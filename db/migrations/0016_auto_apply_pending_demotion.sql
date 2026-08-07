ALTER TABLE "triage_config" ADD COLUMN "auto_apply_promotions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "pending_demotion" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_auth_user_id" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"verdict_id" bigint NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_demotion" ADD CONSTRAINT "pending_demotion_owner_auth_user_id_owner_binding_auth_user_id_fk" FOREIGN KEY ("owner_auth_user_id") REFERENCES "public"."owner_binding"("auth_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_demotion" ADD CONSTRAINT "pending_demotion_verdict_id_verdict_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."verdict"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_demotion" ADD CONSTRAINT "pending_demotion_verdict_id_unique" UNIQUE("verdict_id");--> statement-breakpoint
CREATE INDEX "pending_demotion_owner_pending_idx" ON "pending_demotion" USING btree ("owner_auth_user_id","confirmed_at");--> statement-breakpoint
CREATE INDEX "pending_demotion_owner_message_idx" ON "pending_demotion" USING btree ("owner_auth_user_id","gmail_message_id");
