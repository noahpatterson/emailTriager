ALTER TABLE "triage_config" ADD COLUMN "contest_archive_label_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "triage_config" ALTER COLUMN "contest_archive_label_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "triage_config" ADD COLUMN "sender_blocklist" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "message_processing" DROP CONSTRAINT "message_processing_outcome_check";--> statement-breakpoint
ALTER TABLE "message_processing" ADD CONSTRAINT "message_processing_outcome_check" CHECK ("message_processing"."outcome" IN ('priority','review','new_contest','unmatched','protected','failed','blocked'));
