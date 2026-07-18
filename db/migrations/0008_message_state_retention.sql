UPDATE "message_processing" SET "sender_address" = NULL;
--> statement-breakpoint
ALTER TABLE "message_processing" DROP COLUMN "subject";
--> statement-breakpoint
ALTER TABLE "message_processing" DROP COLUMN "label_ids";
--> statement-breakpoint
CREATE TABLE "gmail_message_state" (
	"google_subject" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"latest_run_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"processing_status" text NOT NULL,
	"processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_message_state_google_subject_gmail_message_id_pk" PRIMARY KEY("google_subject","gmail_message_id"),
	CONSTRAINT "gmail_message_state_latest_run_id_sync_run_id_fk" FOREIGN KEY ("latest_run_id") REFERENCES "public"."sync_run"("id") ON DELETE cascade,
	CONSTRAINT "gmail_message_state_outcome_check" CHECK ("outcome" IN ('priority','review','new_contest','unmatched','protected','failed','blocked')),
	CONSTRAINT "gmail_message_state_processing_status_check" CHECK ("processing_status" IN ('pending','processed','failed'))
);
--> statement-breakpoint
CREATE INDEX "gmail_message_state_updated_idx" ON "gmail_message_state" USING btree ("updated_at");
