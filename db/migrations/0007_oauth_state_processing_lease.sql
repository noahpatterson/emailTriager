ALTER TABLE "oauth_state" ADD COLUMN "processing_token" text;
--> statement-breakpoint
ALTER TABLE "oauth_state" ADD COLUMN "processing_expires_at" timestamp with time zone;
