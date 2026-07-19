ALTER TABLE "triage_config" RENAME COLUMN "contest_label_id" TO "new_label_id";--> statement-breakpoint
ALTER TABLE "message_processing" DROP CONSTRAINT "message_processing_outcome_check";--> statement-breakpoint
ALTER TABLE "gmail_message_state" DROP CONSTRAINT "gmail_message_state_outcome_check";--> statement-breakpoint
UPDATE "message_processing" SET "outcome" = 'new' WHERE "outcome" = 'new_contest';--> statement-breakpoint
UPDATE "gmail_message_state" SET "outcome" = 'new' WHERE "outcome" = 'new_contest';--> statement-breakpoint
ALTER TABLE "message_processing" ADD CONSTRAINT "message_processing_outcome_check" CHECK ("message_processing"."outcome" IN ('priority','review','new','unmatched','protected','failed','blocked')) NOT VALID;--> statement-breakpoint
ALTER TABLE "gmail_message_state" ADD CONSTRAINT "gmail_message_state_outcome_check" CHECK ("outcome" IN ('priority','review','new','unmatched','protected','failed','blocked')) NOT VALID;--> statement-breakpoint
UPDATE "triage_config"
SET "terms" = ("terms" - 'newContest') || jsonb_build_object('new', COALESCE("terms"->'newContest', '[]'::jsonb))
WHERE "terms" ? 'newContest';
