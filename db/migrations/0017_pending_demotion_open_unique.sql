ALTER TABLE "pending_demotion" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_demotion_one_open_per_message"
  ON "pending_demotion" ("owner_auth_user_id", "gmail_message_id")
  WHERE "confirmed_at" IS NULL AND "cancelled_at" IS NULL;
